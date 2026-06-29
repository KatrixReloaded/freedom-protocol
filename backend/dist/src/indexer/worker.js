import { getCheckpoint, saveCheckpoint } from "../db/client.js";
import { processBridgeLog } from "./bridge.js";
import { processConfidentialLog } from "./confidential.js";
import { processMatchingLog } from "./matching.js";
import { processPoolLog } from "./pools.js";
import { processPublicLog } from "./public.js";
function addressesFor(ctx, chainId) {
    const chain = ctx.registry.chain(chainId);
    if (!chain)
        return [];
    const addresses = [];
    for (const factory of chain.publicFactories)
        addresses.push(factory.factory, factory.vault);
    for (const factory of chain.confidentialFactories)
        addresses.push(factory.factory, factory.vault);
    if (chain.bridge)
        addresses.push(chain.bridge);
    if (chain.matchingEngine)
        addresses.push(chain.matchingEngine);
    const pools = ctx.db.prepare("SELECT pool_address FROM pools WHERE chain_id=?").all(chainId);
    for (const pool of pools)
        addresses.push(pool.pool_address);
    return [...new Set(addresses)];
}
export async function indexRange(ctx, chainId, fromBlock, toBlock) {
    const client = ctx.chains.get(chainId);
    if (!client)
        return 0;
    const addresses = addressesFor(ctx, chainId);
    if (addresses.length === 0 || fromBlock > toBlock)
        return 0;
    const logs = await client.getLogs({ address: addresses, fromBlock, toBlock });
    let processed = 0;
    for (const log of logs) {
        try {
            if (processPublicLog(ctx.db, ctx.registry, ctx.abis, chainId, log) ||
                processConfidentialLog(ctx.db, ctx.registry, ctx.abis, chainId, log) ||
                processBridgeLog(ctx.db, ctx.registry, ctx.abis, chainId, log) ||
                processMatchingLog(ctx.db, ctx.registry, ctx.abis, chainId, log) ||
                processPoolLog(ctx.db, ctx.abis, chainId, log)) {
                processed++;
            }
        }
        catch (error) {
            console.warn("Failed to process log", chainId, log.transactionHash, log.logIndex, error);
        }
    }
    return processed;
}
export function createWorker(ctx) {
    let timer;
    let running = false;
    return {
        async start() {
            if (running)
                return;
            running = true;
            await this.tick();
            timer = setInterval(() => void this.tick(), ctx.env.indexerPollMs);
        },
        async stop() {
            running = false;
            if (timer)
                clearInterval(timer);
        },
        async tick() {
            for (const chain of ctx.registry.chains) {
                const client = ctx.chains.get(chain.chainId);
                if (!client)
                    continue;
                const head = await client.getBlockNumber();
                const confirmations = BigInt(chain.confirmations ?? 3);
                const finalized = head > confirmations ? head - confirmations : 0n;
                const startBlock = BigInt(chain.startBlock ?? 0);
                const checkpoint = getCheckpoint(ctx.db, chain.chainId, "events", startBlock);
                const from = checkpoint.lastIndexedBlock + 1n;
                const to = from + ctx.env.indexerBlockRange - 1n < finalized ? from + ctx.env.indexerBlockRange - 1n : finalized;
                if (from <= to) {
                    await indexRange(ctx, chain.chainId, from, to);
                    saveCheckpoint(ctx.db, chain.chainId, "events", to, finalized);
                }
            }
        }
    };
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const { createContext } = await import("../server.js");
    const worker = createWorker(createContext());
    await worker.start();
}
