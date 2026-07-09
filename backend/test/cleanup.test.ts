import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { MemoryRepository } from "../src/db/memory.js";
import { loadConfig } from "../src/config/env.js";
import { bridgeRequestPrimaryKey } from "../src/keys.js";
import {
  bridgeAddress,
  bridgeConfig,
  burnedAmountHandle,
  confidentialEngine,
  factoryAddress,
  publicFactory,
  quoteToken,
  stableToken,
  testConfig,
  upToken,
  userAddress,
} from "./helpers.js";

const dayMs = 24 * 60 * 60 * 1000;

function testAddress(value: number): Address {
  return `0x${value.toString(16).padStart(40, "0")}` as Address;
}

function testHash(value: number): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function testSeriesId(value: number): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

describe("cleanup retention", () => {
  it("defaults cleanup off and preserves a safe indexed log retention floor", () => {
    const config = loadConfig({
      CHAINS_JSON: '{"chains":[]}',
      INDEXER_REWIND_BLOCKS: "800",
      INDEXED_LOG_RETENTION_BLOCKS: "900",
    });

    expect(config.cleanupEnabled).toBe(false);
    expect(config.cleanupRetentionDays).toBe(14);
    expect(config.cleanupPollIntervalMs).toBe(3_600_000);
    expect(config.indexedLogRetentionBlocks).toBe(1_300n);
  });

  it("deletes only finalized or failed old bridge requests", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);

    for (const requestId of [1n, 2n, 3n]) {
      await repo.upsertUnshieldRequested({
        chainId: 31337,
        contractAddress: bridgeAddress,
        blockNumber: 10n + requestId,
        transactionHash: testHash(Number(requestId)),
        logIndex: Number(requestId),
        requestId,
        userAddress,
        strikePrice: 3000n,
        maturityTimestamp: 1_796_083_200n,
        isStable: true,
        requestedAmount: 1_000_000n,
        burnedAmountHandle,
      });
    }

    await repo.markUnshieldFinalized({
      chainId: 31337,
      contractAddress: bridgeAddress,
      blockNumber: 20n,
      transactionHash: testHash(20),
      logIndex: 0,
      requestId: 1n,
      userAddress,
      strikePrice: 3000n,
      maturityTimestamp: 1_796_083_200n,
      isStable: true,
      amount: 1_000_000n,
    });
    await repo.updateBridgeRequestStatus({
      id: bridgeRequestPrimaryKey(31337, bridgeConfig.address, 2n),
      status: "failed",
      error: "old decrypt failure",
    });

    const result = await repo.cleanupAncientData({
      retentionDays: 14,
      indexedLogRetentionBlocks: 1_000n,
      now: new Date(Date.now() + 15 * dayMs),
    });

    expect(result.bridgeRequestsDeleted).toBe(2);
    expect((await repo.listBridgeRequests({})).map((row) => row.requestId)).toEqual(["3"]);
  });

  it("deletes old closed listings but preserves active listings", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);

    for (const listingId of [1n, 2n, 3n]) {
      await repo.upsertListingCreated({
        chainId: 31337,
        contractAddress: confidentialEngine.address,
        blockNumber: 10n + listingId,
        transactionHash: testHash(Number(listingId)),
        logIndex: Number(listingId),
        listingId,
        seller: userAddress,
        token: stableToken,
        quoteToken,
        strikePrice: 3000n,
        maturityTimestamp: 1_796_083_200n,
        engine: confidentialEngine,
        seriesId: null,
        factoryAddress: null,
        tokenSide: "P",
      });
    }

    await repo.markListingFilled({
      chainId: 31337,
      contractAddress: confidentialEngine.address,
      blockNumber: 20n,
      transactionHash: testHash(20),
      logIndex: 0,
      listingId: 2n,
      buyer: testAddress(30),
    });
    await repo.markListingCancelled({
      chainId: 31337,
      contractAddress: confidentialEngine.address,
      blockNumber: 21n,
      transactionHash: testHash(21),
      logIndex: 1,
      listingId: 3n,
    });

    const result = await repo.cleanupAncientData({
      retentionDays: 14,
      indexedLogRetentionBlocks: 1_000n,
      now: new Date(Date.now() + 15 * dayMs),
    });

    expect(result.marketListingsDeleted).toBe(2);
    expect((await repo.listListings({})).map((row) => row.listingId)).toEqual(["1"]);
  });

  it("deletes old settled series only when no active listing references it", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const deletedSeriesId = testSeriesId(1);
    const unsettledSeriesId = testSeriesId(2);
    const referencedSeriesId = testSeriesId(3);
    const referencedStable = testAddress(101);
    const referencedUp = testAddress(102);

    async function upsertSeries(seriesId: Hex, tokenA: Address, tokenB: Address) {
      await repo.upsertSeriesCreated({
        chainId: 31337,
        contractAddress: factoryAddress,
        blockNumber: 10n,
        transactionHash: testHash(Number(BigInt(seriesId) % 1000n)),
        logIndex: Number(BigInt(seriesId) % 100n),
        seriesId,
        strikePrice: 3000n,
        maturityTimestamp: 1_796_083_200n,
        stableToken: tokenA,
        upToken: tokenB,
        factory: publicFactory,
      });
    }

    await upsertSeries(deletedSeriesId, stableToken, upToken);
    await upsertSeries(unsettledSeriesId, testAddress(91), testAddress(92));
    await upsertSeries(referencedSeriesId, referencedStable, referencedUp);

    for (const seriesId of [deletedSeriesId, referencedSeriesId]) {
      await repo.upsertSeriesSettled({
        chainId: 31337,
        contractAddress: factoryAddress,
        blockNumber: 30n,
        transactionHash: testHash(30 + Number(BigInt(seriesId) % 100n)),
        logIndex: Number(BigInt(seriesId) % 100n),
        seriesId,
        oraclePrice: 3000n,
        stablePayout: 1_000_000n,
        upPayout: 0n,
      });
    }

    await repo.upsertListingCreated({
      chainId: 31337,
      contractAddress: confidentialEngine.address,
      blockNumber: 40n,
      transactionHash: testHash(40),
      logIndex: 0,
      listingId: 10n,
      seller: userAddress,
      token: referencedStable,
      quoteToken,
      strikePrice: 3000n,
      maturityTimestamp: 1_796_083_200n,
      engine: confidentialEngine,
      seriesId: referencedSeriesId,
      factoryAddress,
      tokenSide: "P",
    });

    const result = await repo.cleanupAncientData({
      retentionDays: 14,
      indexedLogRetentionBlocks: 1_000n,
      now: new Date(Date.now() + 15 * dayMs),
    });

    expect(result.seriesDeleted).toBe(1);
    expect((await repo.listSeries({})).map((row) => row.seriesId).sort()).toEqual(
      [referencedSeriesId, unsettledSeriesId].sort(),
    );
  });

  it("deletes indexed logs below the safe block cutoff", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    await repo.updateChainHead(31337, 2_000n);

    for (const blockNumber of [100n, 999n, 1_000n, 1_500n]) {
      await repo.recordLogOnce(
        {
          chainId: 31337,
          contractAddress: factoryAddress,
          blockNumber,
          transactionHash: testHash(Number(blockNumber)),
          logIndex: 0,
        },
        "Test",
      );
    }

    const result = await repo.cleanupAncientData({
      retentionDays: 14,
      indexedLogRetentionBlocks: 1_000n,
      now: new Date(),
    });

    expect(result.indexedLogsDeleted).toBe(2);
    await expect(
      repo.recordLogOnce(
        {
          chainId: 31337,
          contractAddress: factoryAddress,
          blockNumber: 100n,
          transactionHash: testHash(100),
          logIndex: 0,
        },
        "Test",
      ),
    ).resolves.toBe(true);
    await expect(
      repo.recordLogOnce(
        {
          chainId: 31337,
          contractAddress: factoryAddress,
          blockNumber: 1_000n,
          transactionHash: testHash(1_000),
          logIndex: 0,
        },
        "Test",
      ),
    ).resolves.toBe(false);
  });
});
