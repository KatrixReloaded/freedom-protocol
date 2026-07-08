import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { MemoryRepository } from "../src/db/memory.js";
import { EventProcessor } from "../src/indexer/eventProcessor.js";
import { createServer } from "../src/http/server.js";
import { deriveSeriesId, listingPrimaryKey, seriesPrimaryKey } from "../src/keys.js";
import {
  confidentialEngine,
  engineAddress,
  factoryAddress,
  listingCreatedLog,
  publicFactory,
  seriesCreatedLog,
  seriesId,
  settledLog,
  splitLog,
  testConfig,
  bridgeConfig,
  keeperPrivateKey,
  maturityTimestamp,
  oracleAdapterAddress,
  quoteToken,
  stableToken,
  unshieldRequestedLog,
  userAddress,
} from "./helpers.js";

function testAddress(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

describe("routes", () => {
  it("serves series, listings, user listings, and public position activity", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);
    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog());
    await processor.processFactoryLog(31337, publicFactory, splitLog());
    await processor.processMatchingEngineLog(31337, confidentialEngine, listingCreatedLog());
    await processor.processBridgeLog(31337, bridgeConfig, unshieldRequestedLog());

    const app = createServer(
      { ...testConfig, chains: [{ ...testConfig.chains[0], rpcUrl: "http://127.0.0.1:1" }] },
      repo,
    );

    const seriesResponse = await app.inject({ method: "GET", url: "/series?chainId=31337&mode=public" });
    expect(seriesResponse.statusCode).toBe(200);
    expect(seriesResponse.json()).toHaveLength(1);

    const oneSeries = await app.inject({
      method: "GET",
      url: `/series/${seriesPrimaryKey(31337, factoryAddress, seriesId)}`,
    });
    expect(oneSeries.statusCode).toBe(200);
    expect(oneSeries.json().seriesId).toBe(seriesId);

    const listingResponse = await app.inject({ method: "GET", url: "/markets/listings?active=true" });
    expect(listingResponse.statusCode).toBe(200);
    expect(listingResponse.json()[0].id).toBe(listingPrimaryKey(31337, engineAddress, 7n));

    const userListings = await app.inject({
      method: "GET",
      url: `/markets/user/${userAddress}/listings?chainId=31337&mode=confidential`,
    });
    expect(userListings.statusCode).toBe(200);
    expect(userListings.json()).toHaveLength(1);

    const positions = await app.inject({
      method: "GET",
      url: `/positions/public/${userAddress}?chainId=31337&factory=${factoryAddress}`,
    });
    expect(positions.statusCode).toBe(200);
    expect(positions.json().eventDerivedActivity[0].splitAmount).toBe("1000000");
    expect(positions.json().limitations.confidential).toContain("not tracked");

    const bridgeRequests = await app.inject({ method: "GET", url: "/bridges/requests?chainId=31337&status=requested" });
    expect(bridgeRequests.statusCode).toBe(200);
    expect(bridgeRequests.json()).toHaveLength(1);

    const bridgeRequest = await app.inject({
      method: "GET",
      url: `/bridges/requests/${bridgeRequests.json()[0].id}`,
    });
    expect(bridgeRequest.statusCode).toBe(200);
    expect(bridgeRequest.json().burnedAmountHandle).toMatch(/^0x22/);

    await app.close();
  });

  it("scopes market listing discovery to configured matching engines", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);
    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog());
    await processor.processMatchingEngineLog(31337, confidentialEngine, listingCreatedLog());

    const oldEngine = testAddress(22);
    await repo.upsertListingCreated({
      chainId: 31337,
      contractAddress: oldEngine,
      blockNumber: 21n,
      transactionHash: `0x${"09".repeat(32)}` as Hex,
      logIndex: 0,
      listingId: 99n,
      seller: userAddress,
      token: stableToken,
      quoteToken,
      strikePrice: 3000n,
      maturityTimestamp,
      engine: { ...confidentialEngine, address: oldEngine },
      seriesId,
      factoryAddress,
      tokenSide: "P",
    });

    const app = createServer(
      { ...testConfig, chains: [{ ...testConfig.chains[0], rpcUrl: "http://127.0.0.1:1" }] },
      repo,
    );

    const activeListings = await app.inject({
      method: "GET",
      url: "/markets/listings?chainId=31337&mode=confidential&active=true",
    });
    expect(activeListings.statusCode).toBe(200);
    expect(activeListings.json().map((listing: { engineAddress: Address }) => listing.engineAddress)).toEqual([
      engineAddress,
    ]);

    const oldListing = await app.inject({
      method: "GET",
      url: `/markets/listings?chainId=31337&mode=confidential&active=true&engineAddress=${oldEngine}`,
    });
    expect(oldListing.json().map((listing: { engineAddress: Address }) => listing.engineAddress)).toEqual([oldEngine]);

    const userListings = await app.inject({
      method: "GET",
      url: `/markets/user/${userAddress}/listings?chainId=31337&mode=confidential`,
    });
    expect(userListings.json()).toHaveLength(2);

    await app.close();
  });

  it("keeps matured and settled token listings visible by default", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);
    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog(0, 1n));
    await processor.processMatchingEngineLog(31337, confidentialEngine, listingCreatedLog());

    const app = createServer(
      { ...testConfig, chains: [{ ...testConfig.chains[0], rpcUrl: "http://127.0.0.1:1" }] },
      repo,
    );

    const activeMatured = await app.inject({ method: "GET", url: "/markets/listings?active=true" });
    expect(activeMatured.statusCode).toBe(200);
    expect(activeMatured.json()).toHaveLength(1);
    expect(activeMatured.json()[0]).toMatchObject({
      active: true,
      maturityTimestamp: "1",
      isMatured: true,
      settled: false,
      marketStatus: "live",
      settlementPending: true,
    });

    const liveFilter = await app.inject({ method: "GET", url: "/markets/listings?settled=false" });
    expect(liveFilter.json()).toHaveLength(1);

    await processor.processFactoryLog(31337, publicFactory, settledLog());

    const activeSettled = await app.inject({ method: "GET", url: "/markets/listings?active=true" });
    expect(activeSettled.statusCode).toBe(200);
    expect(activeSettled.json()).toHaveLength(1);
    expect(activeSettled.json()[0]).toMatchObject({
      active: true,
      isMatured: true,
      settled: true,
      marketStatus: "settled",
      settlementPending: false,
      stablePayout: "1000000",
    });

    const settledFilter = await app.inject({ method: "GET", url: "/markets/listings?settled=true" });
    expect(settledFilter.json()).toHaveLength(1);

    await app.close();
  });

  it("filters active series by timestamp and settlement state, then sorts by maturity and strike", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const now = BigInt(Math.floor(Date.now() / 1000));
    let logIndex = 0;

    async function upsertSeries(strikePrice: bigint, maturityTimestamp: bigint) {
      const currentLogIndex = logIndex++;
      const currentSeriesId = deriveSeriesId(strikePrice, maturityTimestamp);
      await repo.upsertSeriesCreated({
        chainId: 31337,
        contractAddress: factoryAddress,
        blockNumber: 100n + BigInt(currentLogIndex),
        transactionHash: `0x${(currentLogIndex + 1).toString(16).padStart(64, "0")}` as Hex,
        logIndex: currentLogIndex,
        seriesId: currentSeriesId,
        strikePrice,
        maturityTimestamp,
        stableToken: testAddress(100 + currentLogIndex),
        upToken: testAddress(200 + currentLogIndex),
        factory: publicFactory,
      });
      return currentSeriesId;
    }

    await upsertSeries(4_000n, now + 2_000n);
    await upsertSeries(4_000n, now + 1_000n);
    await upsertSeries(3_000n, now + 1_000n);
    const settledFuture = await upsertSeries(2_500n, now + 500n);
    await upsertSeries(1_000n, now - 1n);
    await repo.upsertSeriesSettled({
      chainId: 31337,
      contractAddress: factoryAddress,
      blockNumber: 200n,
      transactionHash: `0x${"ff".repeat(32)}` as Hex,
      logIndex: 99,
      seriesId: settledFuture,
      oraclePrice: 3_000n,
      stablePayout: 1_000_000n,
      upPayout: 0n,
    });

    const app = createServer(
      { ...testConfig, chains: [{ ...testConfig.chains[0], rpcUrl: "http://127.0.0.1:1" }] },
      repo,
    );

    const response = await app.inject({ method: "GET", url: "/series?status=active&chainId=31337&mode=public" });
    expect(response.statusCode).toBe(200);
    const activeSeries = response.json();

    expect(activeSeries).toHaveLength(3);
    expect(activeSeries.map((row: { strikePrice: string }) => row.strikePrice)).toEqual(["3000", "4000", "4000"]);
    expect(activeSeries.map((row: { maturityTimestamp: string }) => row.maturityTimestamp)).toEqual([
      (now + 1_000n).toString(),
      (now + 1_000n).toString(),
      (now + 2_000n).toString(),
    ]);
    expect(activeSeries.every((row: { active: boolean; settled: boolean }) => row.active && !row.settled)).toBe(true);
    expect(activeSeries[0]).toMatchObject({
      chainId: 31337,
      mode: "public",
      factoryAddress,
      marketStatus: "active",
    });
    expect(activeSeries[0].stableToken).toMatch(/^0x/);
    expect(activeSeries[0].upToken).toMatch(/^0x/);

    await app.close();
  });

  it("exposes oracle adapter deployment metadata without keeper private keys", async () => {
    const repo = new MemoryRepository();
    const config = {
      ...testConfig,
      chains: [
        {
          ...testConfig.chains[0],
          settlementKeeperEnabled: true,
          settlementKeeperPrivateKey: keeperPrivateKey,
          oracleAdapter: oracleAdapterAddress,
        },
      ],
    };
    await repo.initializeConfig(config);
    const app = createServer(config, repo);

    const response = await app.inject({ method: "GET", url: "/deployments" });
    expect(response.statusCode).toBe(200);
    const deployments = response.json();
    expect(deployments.chains[0].oracleAdapter).toBe(oracleAdapterAddress);
    expect(deployments.chains[0].settlementKeeperPrivateKey).toBeUndefined();
    expect(deployments.chains[0].factories[0].oracleAdapter).toBe(oracleAdapterAddress);
    expect(JSON.stringify(deployments)).not.toContain(keeperPrivateKey);

    await app.close();
  });
});
