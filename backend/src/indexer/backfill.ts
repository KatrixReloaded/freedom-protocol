import { createPublicClient, http, type Address } from "viem";
import { loadConfig } from "../config/env.js";
import { PgRepository } from "../db/pg.js";
import type { EventGroup } from "../types.js";
import { normalizeAddress } from "../keys.js";
import { chunkBlockRanges } from "./cursor.js";
import { EventProcessor, type IndexableLog } from "./eventProcessor.js";

interface BackfillArgs {
  chainId: number;
  address: Address;
  eventGroup: EventGroup;
  fromBlock: bigint;
  toBlock: bigint;
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  npm run backfill -- --chainId 11155111 --address 0x... --eventGroup factory --fromBlock 11220823 --toBlock 11221312",
      "",
      "eventGroup must be one of: factory, matching-engine, bridge",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): BackfillArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) usage();
    values.set(key.slice(2), value);
  }

  const eventGroup = values.get("eventGroup") as EventGroup | undefined;
  if (eventGroup !== "factory" && eventGroup !== "matching-engine" && eventGroup !== "bridge") usage();

  const chainId = Number(values.get("chainId"));
  const address = values.get("address");
  const fromBlock = values.get("fromBlock");
  const toBlock = values.get("toBlock");
  if (!Number.isInteger(chainId) || !address || !fromBlock || !toBlock) usage();

  return {
    chainId,
    address: normalizeAddress(address as Address),
    eventGroup,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
  };
}

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const chain = config.chains.find((candidate) => candidate.chainId === args.chainId);
if (!chain) throw new Error(`chain ${args.chainId} not configured`);

const factory = chain.factories.find((candidate) => normalizeAddress(candidate.address) === args.address);
const engine = chain.matchingEngines.find((candidate) => normalizeAddress(candidate.address) === args.address);
const bridge = chain.bridges.find((candidate) => normalizeAddress(candidate.address) === args.address);

if (args.eventGroup === "factory" && !factory) throw new Error(`factory ${args.address} not configured`);
if (args.eventGroup === "matching-engine" && !engine) throw new Error(`matching engine ${args.address} not configured`);
if (args.eventGroup === "bridge" && !bridge) throw new Error(`bridge ${args.address} not configured`);

const repository = new PgRepository(config);
await repository.migrate();
await repository.initializeConfig(config);

const processor = new EventProcessor(repository);
const client = createPublicClient({ transport: http(chain.rpcUrl) });
let rawLogCount = 0;

try {
  for (const [fromBlock, toBlock] of chunkBlockRanges(args.fromBlock, args.toBlock, config.maxBlockRange)) {
    const logs = (await client.getLogs({
      address: args.address,
      fromBlock,
      toBlock,
    })) as IndexableLog[];
    rawLogCount += logs.length;
    for (const log of logs) {
      if (args.eventGroup === "factory") await processor.processFactoryLog(args.chainId, factory!, log);
      if (args.eventGroup === "matching-engine") await processor.processMatchingEngineLog(args.chainId, engine!, log);
      if (args.eventGroup === "bridge") await processor.processBridgeLog(args.chainId, bridge!, log);
    }
    await repository.setCursor(args.chainId, args.address, args.eventGroup, toBlock);
    console.info(`backfilled ${args.chainId}:${args.address}:${args.eventGroup} blocks ${fromBlock}-${toBlock}, rawLogs=${logs.length}`);
  }
  console.info(
    `backfill complete ${args.chainId}:${args.address}:${args.eventGroup} blocks ${args.fromBlock}-${args.toBlock}, rawLogs=${rawLogCount}`,
  );
} finally {
  await repository.close();
}
