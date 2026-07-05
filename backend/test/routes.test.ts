import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/db/memory.js";
import { EventProcessor } from "../src/indexer/eventProcessor.js";
import { createServer } from "../src/http/server.js";
import { listingPrimaryKey, seriesPrimaryKey } from "../src/keys.js";
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
  oracleAdapterAddress,
  unshieldRequestedLog,
  userAddress,
} from "./helpers.js";

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
