import { getAddress } from "viem";
import { rowToSeries } from "./registry.js";
export function listSeries(db, filters) {
    const where = [];
    const args = [];
    if (filters.chainId != null) {
        where.push("chain_id=?");
        args.push(filters.chainId);
    }
    if (filters.factory) {
        where.push("factory_address=?");
        args.push(getAddress(filters.factory));
    }
    if (filters.mode) {
        where.push("mode=?");
        args.push(filters.mode);
    }
    const sql = `SELECT * FROM series ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY maturity,strike`;
    return db.prepare(sql).all(...args).map(rowToSeries);
}
export function reserveFor(db, chainId, seriesKey) {
    return (db.prepare("SELECT reserve,bridge_capacity,updated_block FROM public_reserves WHERE chain_id=? AND series_key=?").get(chainId, seriesKey) ?? { reserve: "0", bridge_capacity: "0", updated_block: null });
}
export function upsertReserve(db, chainId, seriesKey, deltaReserve, deltaBridgeCapacity = 0n, block) {
    const current = reserveFor(db, chainId, seriesKey);
    const reserve = BigInt(current.reserve) + deltaReserve;
    const capacity = BigInt(current.bridge_capacity) + deltaBridgeCapacity;
    db.prepare("INSERT INTO public_reserves (chain_id,series_key,reserve,bridge_capacity,updated_block) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(chain_id,series_key) DO UPDATE SET reserve=excluded.reserve,bridge_capacity=excluded.bridge_capacity,updated_block=excluded.updated_block").run(chainId, seriesKey, reserve.toString(), capacity.toString(), block == null ? current.updated_block : Number(block));
}
export function requestKey(chainId, bridge, requestId) {
    return `${chainId}:${getAddress(bridge)}:${BigInt(requestId).toString()}`;
}
export function listBridgeRequests(db, filters) {
    const where = [];
    const args = [];
    if (filters.chainId != null) {
        where.push("chain_id=?");
        args.push(filters.chainId);
    }
    if (filters.user) {
        where.push("user_address=?");
        args.push(getAddress(filters.user));
    }
    if (filters.seriesKey) {
        where.push("series_key=?");
        args.push(filters.seriesKey);
    }
    if (filters.status) {
        where.push("status=?");
        args.push(filters.status);
    }
    const sql = `SELECT * FROM bridge_requests ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_block DESC, request_id DESC`;
    return db.prepare(sql).all(...args);
}
export function markBridgeRetryability(db, key, capacity) {
    const row = db.prepare("SELECT actual_burned_amount,status FROM bridge_requests WHERE request_key=?").get(key);
    if (!row || row.status === "finalized")
        return;
    if (row.actual_burned_amount != null && capacity < BigInt(row.actual_burned_amount)) {
        db.prepare("UPDATE bridge_requests SET status='retryable',failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE request_key=?").run("insufficient_bridge_capacity", key);
    }
}
export function insertEvent(db, event) {
    db.prepare("INSERT OR IGNORE INTO events (chain_id,block_number,block_hash,tx_hash,log_index,address,event_name,args,finalized) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(event.chainId, Number(event.blockNumber), event.blockHash ?? null, event.txHash, event.logIndex, getAddress(event.address), event.eventName, JSON.stringify(event.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), event.finalized ? 1 : 0);
}
