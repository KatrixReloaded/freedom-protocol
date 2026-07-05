import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/db/memory.js";
import { EventProcessor } from "../src/indexer/eventProcessor.js";
import { listingPrimaryKey, seriesPrimaryKey } from "../src/keys.js";
import {
  confidentialEngine,
  confidentialFactory,
  confidentialFactoryAddress,
  confidentialSeriesCreatedLog,
  confidentialSeriesId,
  bridgeAddress,
  bridgeConfig,
  engineAddress,
  factoryAddress,
  listingCreatedLog,
  maturityTimestamp,
  publicFactory,
  seriesCreatedLog,
  seriesId,
  settledLog,
  splitLog,
  testConfig,
  unshieldFinalizedLog,
  unshieldRequestedLog,
  userAddress,
} from "./helpers.js";

describe("EventProcessor", () => {
  it("decodes factory events and upserts series plus public activity", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);

    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog());
    await processor.processFactoryLog(31337, publicFactory, splitLog());

    const series = await repo.getSeries(seriesPrimaryKey(31337, factoryAddress, seriesId));
    expect(series?.strikePrice).toBe("3000");
    expect(series?.maturityTimestamp).toBe(maturityTimestamp.toString());
    expect(series?.createdBlock).toBe("20");

    const activity = await repo.listPublicPositionActivity(userAddress, 31337, factoryAddress);
    expect(activity).toHaveLength(1);
    expect(activity[0].splitAmount).toBe("1000000");
    expect(activity[0].splitCount).toBe(1);
  });

  it("decodes confidential SeriesCreated events and stores series cache rows", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);

    await processor.processFactoryLog(31337, confidentialFactory, confidentialSeriesCreatedLog());

    const series = await repo.getSeries(seriesPrimaryKey(31337, confidentialFactoryAddress, confidentialSeriesId));
    expect(series?.mode).toBe("confidential");
    expect(series?.strikePrice).toBe("3500");
    expect(series?.settled).toBe(false);
  });

  it("does not duplicate rows or deltas when the same log is processed twice", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);

    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog());
    await processor.processFactoryLog(31337, publicFactory, splitLog());
    await processor.processFactoryLog(31337, publicFactory, splitLog());

    const activity = await repo.listPublicPositionActivity(userAddress, 31337, factoryAddress);
    expect(activity[0].splitAmount).toBe("1000000");
    expect(activity[0].splitCount).toBe(1);
  });

  it("updates indexed series state from Settled events", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);

    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog());
    await processor.processFactoryLog(31337, publicFactory, settledLog());

    const series = await repo.getSeries(seriesPrimaryKey(31337, factoryAddress, seriesId));
    expect(series?.settled).toBe(true);
    expect(series?.oraclePrice).toBe("3000");
    expect(series?.stablePayout).toBe("1000000");
    expect(series?.settledBlock).toBe("26");
  });


  it("indexes confidential listing metadata and fill status without plaintext amounts", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);

    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog());
    await processor.processMatchingEngineLog(31337, confidentialEngine, listingCreatedLog());

    const listing = await repo.getListing(listingPrimaryKey(31337, engineAddress, 7n));
    expect(listing?.seller).toBe(userAddress);
    expect(listing?.tokenSide).toBe("P");
    expect(listing?.active).toBe(true);
    expect(Object.keys(listing ?? {})).not.toContain("amount");
    expect(Object.keys(listing ?? {})).not.toContain("minReceive");
  });

  it("indexes unshield requests and finalization from bridge logs", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);

    await processor.processBridgeLog(31337, bridgeConfig, unshieldRequestedLog());

    const requestId = `31337:${bridgeAddress}:9`;
    const request = await repo.getBridgeRequest(requestId);
    expect(request?.status).toBe("requested");
    expect(request?.requestedAmount).toBe("1000000");
    expect(request?.burnedAmountHandle).toMatch(/^0x22/);

    await processor.processBridgeLog(31337, bridgeConfig, unshieldFinalizedLog());
    const finalized = await repo.getBridgeRequest(requestId);
    expect(finalized?.status).toBe("finalized");
    expect(finalized?.finalizedAmount).toBe("900000");
  });

  it("does not duplicate bridge request processing for duplicate logs", async () => {
    const repo = new MemoryRepository();
    await repo.initializeConfig(testConfig);
    const processor = new EventProcessor(repo);

    await processor.processBridgeLog(31337, bridgeConfig, unshieldRequestedLog());
    await processor.processBridgeLog(31337, bridgeConfig, unshieldRequestedLog());

    const requests = await repo.listBridgeRequests({ chainId: 31337 });
    expect(requests).toHaveLength(1);
    expect(requests[0].requestId).toBe("9");
  });
});
