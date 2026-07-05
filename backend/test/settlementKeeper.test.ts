import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/db/memory.js";
import { EventProcessor } from "../src/indexer/eventProcessor.js";
import { SettlementKeeper } from "../src/keeper/settlementKeeper.js";
import type {
  FactorySeriesState,
  LatestBlockInfo,
  SettlementClient,
  SettleSeriesInput,
} from "../src/keeper/settlementClient.js";
import {
  confidentialFactory,
  confidentialFactoryAddress,
  confidentialSeriesCreatedLog,
  factoryAddress,
  keeperPrivateKey,
  oracleAdapterAddress,
  publicFactory,
  seriesCreatedLog,
  settledLog,
  testConfig,
} from "./helpers.js";

class MockSettlementClient implements SettlementClient {
  latest: LatestBlockInfo = { number: 100n, timestamp: 1_000n };
  readCalls: Array<{ factoryAddress: Address; strikePrice: bigint; maturityTimestamp: bigint }> = [];
  settleCalls: SettleSeriesInput[] = [];
  state: FactorySeriesState = { exists: true, settled: false, maturityTimestamp: 900n };
  settleError: Error | null = null;

  async getLatestBlock() {
    return this.latest;
  }

  async readFactorySeries(args: {
    chainId: number;
    factoryAddress: Address;
    strikePrice: bigint;
    maturityTimestamp: bigint;
  }) {
    this.readCalls.push(args);
    return this.state;
  }

  async settleSeries(input: SettleSeriesInput) {
    this.settleCalls.push(input);
    if (this.settleError) throw this.settleError;
    return `0x${"bb".repeat(32)}` as Hex;
  }
}

function settlementConfig(overrides: Partial<(typeof testConfig.chains)[number]> = {}) {
  return {
    ...testConfig,
    chains: [
      {
        ...testConfig.chains[0],
        settlementKeeperEnabled: true,
        settlementKeeperPrivateKey: keeperPrivateKey,
        oracleAdapter: oracleAdapterAddress,
        ...overrides,
      },
    ],
  };
}

async function repoWithPublicSeries(maturityTimestamp = 900n) {
  const repo = new MemoryRepository();
  await repo.initializeConfig(testConfig);
  const processor = new EventProcessor(repo);
  await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog(0, maturityTimestamp));
  return { repo, processor };
}

describe("SettlementKeeper", () => {
  it("uses stored series rows as settlement candidates", async () => {
    const config = settlementConfig();
    const repo = new MemoryRepository();
    await repo.initializeConfig(config);
    const client = new MockSettlementClient();
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();
    expect(client.readCalls).toHaveLength(0);

    const processor = new EventProcessor(repo);
    await processor.processFactoryLog(31337, publicFactory, seriesCreatedLog(0, 900n));
    await keeper.tick();
    expect(client.readCalls).toHaveLength(1);
  });

  it("settles matured public series through the adapter", async () => {
    const config = settlementConfig();
    const { repo } = await repoWithPublicSeries(900n);
    const client = new MockSettlementClient();
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();

    expect(client.settleCalls).toHaveLength(1);
    expect(client.settleCalls[0]).toMatchObject({
      chainId: 31337,
      mode: "public",
      oracleAdapter: oracleAdapterAddress,
      factoryAddress,
      strikePrice: 3000n,
      maturityTimestamp: 900n,
      privateKey: keeperPrivateKey,
    });
  });

  it("settles matured confidential series through the adapter", async () => {
    const config = settlementConfig();
    const repo = new MemoryRepository();
    await repo.initializeConfig(config);
    const processor = new EventProcessor(repo);
    await processor.processFactoryLog(31337, confidentialFactory, confidentialSeriesCreatedLog(0, 900n));
    const client = new MockSettlementClient();
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();

    expect(client.settleCalls).toHaveLength(1);
    expect(client.settleCalls[0]).toMatchObject({
      mode: "confidential",
      factoryAddress: confidentialFactoryAddress,
      strikePrice: 3500n,
      maturityTimestamp: 900n,
    });
  });

  it("skips not-matured series using latest chain block timestamp", async () => {
    const config = settlementConfig();
    const { repo } = await repoWithPublicSeries(2_000n);
    const client = new MockSettlementClient();
    client.latest = { number: 100n, timestamp: 1_000n };
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();

    expect(client.readCalls).toHaveLength(0);
    expect(client.settleCalls).toHaveLength(0);
  });

  it("skips already-settled cached series", async () => {
    const config = settlementConfig();
    const { repo, processor } = await repoWithPublicSeries(900n);
    await processor.processFactoryLog(31337, publicFactory, settledLog());
    const client = new MockSettlementClient();
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();

    expect(client.readCalls).toHaveLength(0);
    expect(client.settleCalls).toHaveLength(0);
  });

  it("skips when on-chain factory state is missing, settled, or not matured", async () => {
    const config = settlementConfig();
    const { repo } = await repoWithPublicSeries(900n);
    const client = new MockSettlementClient();
    client.state = { exists: false, settled: false, maturityTimestamp: 900n };
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();
    expect(client.settleCalls).toHaveLength(0);

    client.state = { exists: true, settled: true, maturityTimestamp: 900n };
    await keeper.tick();
    expect(client.settleCalls).toHaveLength(0);

    client.state = { exists: true, settled: false, maturityTimestamp: 2_000n };
    await keeper.tick();
    expect(client.settleCalls).toHaveLength(0);
  });

  it("adapter revert does not crash and is retried later", async () => {
    const config = settlementConfig();
    const { repo } = await repoWithPublicSeries(900n);
    const client = new MockSettlementClient();
    client.settleError = new Error("stale Chainlink price");
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();
    expect(client.settleCalls).toHaveLength(1);

    client.settleError = null;
    await keeper.tick();
    expect(client.settleCalls).toHaveLength(2);
  });

  it("missing adapter or private key disables settlement safely", async () => {
    const config = settlementConfig({ oracleAdapter: undefined, settlementKeeperPrivateKey: undefined });
    const { repo } = await repoWithPublicSeries(900n);
    const client = new MockSettlementClient();
    const keeper = new SettlementKeeper(config, repo, client);

    await keeper.tick();

    expect(client.readCalls).toHaveLength(0);
    expect(client.settleCalls).toHaveLength(0);
  });
});
