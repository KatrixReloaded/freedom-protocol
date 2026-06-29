import { decodeEventLog, getAddress } from "viem";
import { insertEvent } from "../services/readModels.js";
import { modeForFactory, seriesId, seriesKey, upsertSeries } from "../services/registry.js";
export function processConfidentialLog(db, registry, abis, chainId, log) {
    const address = getAddress(log.address);
    const factory = registry.chain(chainId)?.confidentialFactories.find((f) => f.factory === address);
    if (!factory)
        return false;
    const decoded = decodeEventLog({ abi: abis.get("OptionFactory"), data: log.data, topics: log.topics, strict: false });
    const args = decoded.args ?? {};
    insertEvent(db, {
        chainId,
        blockNumber: log.blockNumber ?? 0n,
        blockHash: log.blockHash,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        address,
        eventName: String(decoded.eventName),
        args
    });
    if (decoded.eventName === "SeriesCreated") {
        const key = seriesKey(chainId, factory.factory, args.strike, args.maturity);
        upsertSeries(db, {
            key,
            chainId,
            factoryAddress: factory.factory,
            seriesId: seriesId(args.strike, args.maturity),
            strike: args.strike.toString(),
            maturity: args.maturity.toString(),
            mode: modeForFactory(registry, chainId, factory.factory) ?? "cWETH",
            collateralToken: factory.cWETH,
            stableToken: args.stableToken,
            upToken: args.upToken,
            settled: false,
            createdBlock: (log.blockNumber ?? 0n).toString()
        });
    }
    if (decoded.eventName === "Settled") {
        db.prepare("UPDATE series SET settled=1,updated_at=CURRENT_TIMESTAMP WHERE chain_id=? AND factory_address=? AND series_id=?").run(chainId, factory.factory, args.seriesId);
    }
    if (decoded.eventName === "PoolCreated") {
        const key = seriesKey(chainId, factory.factory, args.strike, args.maturity);
        db.prepare("INSERT INTO pools (chain_id,pool_address,factory_address,series_key,strike,maturity,is_stable,created_block) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(pool_address) DO UPDATE SET series_key=excluded.series_key").run(chainId, getAddress(args.pool), factory.factory, key, args.strike.toString(), args.maturity.toString(), args.isStable ? 1 : 0, Number(log.blockNumber ?? 0n));
    }
    return true;
}
