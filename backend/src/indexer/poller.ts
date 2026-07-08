import { createPublicClient, http, type Address, type PublicClient } from "viem";
import type { AppConfig, ChainConfig, EventGroup } from "../types.js";
import type { Repository } from "../db/repository.js";
import { EventProcessor, type IndexableLog } from "./eventProcessor.js";
import { chunkBlockRanges, planCursorRange } from "./cursor.js";
import { errorMessage } from "../errors.js";

function makeClient(chain: ChainConfig): PublicClient {
  return createPublicClient({ transport: http(chain.rpcUrl) });
}

export function isSplittableGetLogsError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("block range") ||
    message.includes("range limit") ||
    message.includes("range too") ||
    message.includes("response size") ||
    message.includes("too many results") ||
    message.includes("query returned more")
  );
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
        try {
          await this.indexChain(chain);
        } catch (error) {
          console.warn(`indexer failed for chain ${chain.chainId}: ${errorMessage(error)}`);
        }
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
    if (cursor === null) {
      console.info(
        `indexer starting ${args.chain.chainId}:${args.address}:${args.eventGroup} from configured startBlock ${args.startBlock}`,
      );
    }
    const plan = planCursorRange({
      lastIndexedBlock: cursor,
      startBlock: args.startBlock,
      safeHead: args.safeHead,
      rewindBlocks: this.config.rewindBlocks,
    });
    if (!plan.shouldIndex) return;

    for (const [fromBlock, toBlock] of chunkBlockRanges(plan.fromBlock, plan.toBlock, this.config.maxBlockRange)) {
      const indexed = await this.indexBlockRange(args, fromBlock, toBlock);
      if (!indexed) return;
    }
  }

  private async indexBlockRange(
    args: {
      chain: ChainConfig;
      client: PublicClient;
      address: Address;
      eventGroup: EventGroup;
      startBlock: bigint;
      safeHead: bigint;
      getLogs: (fromBlock: bigint, toBlock: bigint) => Promise<IndexableLog[]>;
      processLog: (log: IndexableLog) => Promise<void>;
    },
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<boolean> {
    let logs: IndexableLog[];
    try {
      logs = await args.getLogs(fromBlock, toBlock);
    } catch (error) {
      if (fromBlock < toBlock && isSplittableGetLogsError(error)) {
        const midBlock = fromBlock + (toBlock - fromBlock) / 2n;
        console.warn(
          `indexer splitting ${args.chain.chainId}:${args.address}:${args.eventGroup} blocks ${fromBlock}-${toBlock}: ${errorMessage(error)}`,
        );
        const leftIndexed = await this.indexBlockRange(args, fromBlock, midBlock);
        if (!leftIndexed) return false;
        return this.indexBlockRange(args, midBlock + 1n, toBlock);
      }

      console.warn(
        `indexer failed for ${args.chain.chainId}:${args.address}:${args.eventGroup} blocks ${fromBlock}-${toBlock}: ${errorMessage(error)}`,
      );
      return false;
    }

    for (const log of logs) {
      await args.processLog(log);
    }
    await this.repository.setCursor(args.chain.chainId, args.address, args.eventGroup, toBlock);
    return true;
  }
}
