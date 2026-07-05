import { createPublicClient, http, type Address, type PublicClient } from "viem";
import type { AppConfig, ChainConfig, EventGroup } from "../types.js";
import type { Repository } from "../db/repository.js";
import { EventProcessor, type IndexableLog } from "./eventProcessor.js";
import { chunkBlockRanges, planCursorRange } from "./cursor.js";

function makeClient(chain: ChainConfig): PublicClient {
  return createPublicClient({ transport: http(chain.rpcUrl) });
}

export class MarketIndexer {
  private readonly processor: EventProcessor;
  private readonly clients = new Map<number, PublicClient>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly repository: Repository,
  ) {
    this.processor = new EventProcessor(repository);
    for (const chain of config.chains) {
      this.clients.set(chain.chainId, makeClient(chain));
    }
  }

  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const chain of this.config.chains) {
        await this.indexChain(chain);
      }
    } finally {
      this.running = false;
    }
  }

  private async indexChain(chain: ChainConfig): Promise<void> {
    const client = this.clients.get(chain.chainId);
    if (!client) return;
    const head = await client.getBlockNumber();
    await this.repository.updateChainHead(chain.chainId, head);
    const safeHead = head > BigInt(chain.confirmationDepth) ? head - BigInt(chain.confirmationDepth) : 0n;

    for (const factory of chain.factories) {
      await this.indexContract({
        chain,
        client,
        address: factory.address,
        eventGroup: "factory",
        startBlock: factory.startBlock ?? 0n,
        safeHead,
        getLogs: (fromBlock, toBlock) =>
          client.getLogs({
            address: factory.address,
            fromBlock,
            toBlock,
          }),
        processLog: (log) => this.processor.processFactoryLog(chain.chainId, factory, log),
      });
    }

    for (const engine of chain.matchingEngines) {
      await this.indexContract({
        chain,
        client,
        address: engine.address,
        eventGroup: "matching-engine",
        startBlock: engine.startBlock ?? 0n,
        safeHead,
        getLogs: (fromBlock, toBlock) =>
          client.getLogs({
            address: engine.address,
            fromBlock,
            toBlock,
          }),
        processLog: (log) => this.processor.processMatchingEngineLog(chain.chainId, engine, log),
      });
    }

    for (const bridge of chain.bridges) {
      await this.indexContract({
        chain,
        client,
        address: bridge.address,
        eventGroup: "bridge",
        startBlock: bridge.startBlock ?? 0n,
        safeHead,
        getLogs: (fromBlock, toBlock) =>
          client.getLogs({
            address: bridge.address,
            fromBlock,
            toBlock,
          }),
        processLog: (log) => this.processor.processBridgeLog(chain.chainId, bridge, log),
      });
    }
  }

  private async indexContract(args: {
    chain: ChainConfig;
    client: PublicClient;
    address: Address;
    eventGroup: EventGroup;
    startBlock: bigint;
    safeHead: bigint;
    getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<IndexableLog[]>;
    processLog: (log: IndexableLog) => Promise<void>;
  }): Promise<void> {
    const cursor = await this.repository.getCursor(args.chain.chainId, args.address, args.eventGroup);
    const plan = planCursorRange({
      lastIndexedBlock: cursor,
      startBlock: args.startBlock,
      safeHead: args.safeHead,
      rewindBlocks: this.config.rewindBlocks,
    });
    if (!plan.shouldIndex) return;

    for (const [fromBlock, toBlock] of chunkBlockRanges(plan.fromBlock, plan.toBlock, this.config.maxBlockRange)) {
      const logs = await args.getLogs(fromBlock, toBlock);
      for (const log of logs) {
        await args.processLog(log);
      }
      await this.repository.setCursor(args.chain.chainId, args.address, args.eventGroup, toBlock);
    }
  }
}
