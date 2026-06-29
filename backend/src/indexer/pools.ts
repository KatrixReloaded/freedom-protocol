import { decodeEventLog, getAddress, type Abi, type Log } from "viem";
import type { AbiBundle } from "../config/abis.js";
import type { Db } from "../db/client.js";
import { insertEvent } from "../services/readModels.js";

export function processPoolLog(db: Db, abis: AbiBundle, chainId: number, log: Log): boolean {
  const pool = db.prepare("SELECT pool_address FROM pools WHERE chain_id=? AND pool_address=?").get(chainId, getAddress(log.address!));
  if (!pool) return false;
  const decoded = decodeEventLog({ abi: abis.get("SeriesPool") as Abi, data: log.data, topics: log.topics, strict: false });
  const args: any = decoded.args ?? {};
  insertEvent(db, {
    chainId,
    blockNumber: log.blockNumber ?? 0n,
    blockHash: log.blockHash,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
    address: getAddress(log.address!),
    eventName: String(decoded.eventName),
    args
  });
  if (decoded.eventName === "Deposited") {
    db.prepare("INSERT OR IGNORE INTO pool_sellers (chain_id,pool_address,seller,first_seen_block) VALUES (?, ?, ?, ?)").run(
      chainId,
      getAddress(log.address!),
      getAddress(args.seller),
      Number(log.blockNumber ?? 0n)
    );
  }
  return true;
}
