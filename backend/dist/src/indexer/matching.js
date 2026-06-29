import { decodeEventLog, getAddress } from "viem";
import { insertEvent } from "../services/readModels.js";
export function listingKey(chainId, engine, listingId) {
    return `${chainId}:${getAddress(engine)}:${BigInt(listingId).toString()}`;
}
export function processMatchingLog(db, registry, abis, chainId, log) {
    const chain = registry.chain(chainId);
    if (!chain?.matchingEngine || getAddress(log.address) !== chain.matchingEngine)
        return false;
    const decoded = decodeEventLog({ abi: abis.get("ConfidentialMatchingEngine"), data: log.data, topics: log.topics, strict: false });
    const args = decoded.args ?? {};
    insertEvent(db, {
        chainId,
        blockNumber: log.blockNumber ?? 0n,
        blockHash: log.blockHash,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        address: chain.matchingEngine,
        eventName: String(decoded.eventName),
        args
    });
    if (decoded.eventName === "ListingCreated") {
        db.prepare("INSERT INTO matching_listings (listing_key,chain_id,engine_address,listing_id,seller,token,quote_token,strike,maturity,active,created_block,updated_block) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) " +
            "ON CONFLICT(listing_key) DO UPDATE SET active=1,updated_block=excluded.updated_block").run(listingKey(chainId, chain.matchingEngine, args.listingId), chainId, chain.matchingEngine, args.listingId.toString(), getAddress(args.seller), getAddress(args.token), getAddress(args.quoteToken), args.strike.toString(), args.maturity.toString(), Number(log.blockNumber ?? 0n), Number(log.blockNumber ?? 0n));
    }
    if (decoded.eventName === "FillAttempted" || decoded.eventName === "ListingCancelled") {
        db.prepare("UPDATE matching_listings SET active=0,updated_block=? WHERE listing_key=?").run(Number(log.blockNumber ?? 0n), listingKey(chainId, chain.matchingEngine, args.listingId));
    }
    return true;
}
