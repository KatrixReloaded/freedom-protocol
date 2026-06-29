import { decodeEventLog, getAddress } from "viem";
import { insertEvent, requestKey } from "../services/readModels.js";
import { seriesKey } from "../services/registry.js";
export function processBridgeLog(db, registry, abis, chainId, log) {
    const chain = registry.chain(chainId);
    if (!chain?.bridge || getAddress(log.address) !== chain.bridge)
        return false;
    const decoded = decodeEventLog({ abi: abis.get("UnshieldBridge"), data: log.data, topics: log.topics, strict: false });
    const args = decoded.args ?? {};
    insertEvent(db, {
        chainId,
        blockNumber: log.blockNumber ?? 0n,
        blockHash: log.blockHash,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        address: chain.bridge,
        eventName: String(decoded.eventName),
        args
    });
    const confFactory = chain.confidentialFactories[0]?.factory;
    if (decoded.eventName === "UnshieldRequested") {
        const key = requestKey(chainId, chain.bridge, args.requestId);
        const sKey = confFactory ? seriesKey(chainId, confFactory, args.strike, args.maturity) : null;
        db.prepare("INSERT INTO bridge_requests (request_key,chain_id,bridge_address,request_id,user_address,factory_address,series_key,strike,maturity,is_stable,requested_amount,burned_amount_handle,status,request_tx_hash,created_block) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) " +
            "ON CONFLICT(request_key) DO UPDATE SET burned_amount_handle=excluded.burned_amount_handle,requested_amount=excluded.requested_amount").run(key, chainId, chain.bridge, args.requestId.toString(), getAddress(args.user), confFactory ?? null, sKey, args.strike.toString(), args.maturity.toString(), args.isStable ? 1 : 0, args.requestedAmount.toString(), args.burnedAmountHandle, log.transactionHash, Number(log.blockNumber ?? 0n));
    }
    if (decoded.eventName === "UnshieldFinalized") {
        const key = requestKey(chainId, chain.bridge, args.requestId);
        db.prepare("UPDATE bridge_requests SET actual_burned_amount=?,finalized=1,status='finalized',finalize_tx_hash=?,finalized_block=?,updated_at=CURRENT_TIMESTAMP WHERE request_key=?").run(args.amount.toString(), log.transactionHash, Number(log.blockNumber ?? 0n), key);
    }
    return true;
}
