import { decodeEventLog, getAddress } from "viem";
import { insertEvent, upsertReserve } from "../services/readModels.js";
import { modeForFactory, seriesId, seriesKey, upsertSeries } from "../services/registry.js";
export function processPublicLog(db, registry, abis, chainId, log) {
    const address = getAddress(log.address);
    const factory = registry.chain(chainId)?.publicFactories.find((f) => f.factory === address);
    const vault = registry.chain(chainId)?.publicFactories.find((f) => f.vault === address);
    const abi = factory ? abis.get("PublicOptionFactory") : vault ? abis.get("CentralCollateralVault") : undefined;
    if (!abi)
        return false;
    const decoded = decodeEventLog({ abi: abi, data: log.data, topics: log.topics, strict: false });
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
    if (factory && decoded.eventName === "SeriesCreated") {
        const key = seriesKey(chainId, factory.factory, args.strike, args.maturity);
        upsertSeries(db, {
            key,
            chainId,
            factoryAddress: factory.factory,
            seriesId: seriesId(args.strike, args.maturity),
            strike: args.strike.toString(),
            maturity: args.maturity.toString(),
            mode: modeForFactory(registry, chainId, factory.factory) ?? factory.mode,
            collateralToken: factory.collateralToken,
            stableToken: args.stableToken,
            upToken: args.upToken,
            settled: false,
            createdBlock: (log.blockNumber ?? 0n).toString()
        });
    }
    if (factory && decoded.eventName === "Settled") {
        db.prepare("UPDATE series SET settled=1,stable_payout=?,up_payout=?,updated_at=CURRENT_TIMESTAMP WHERE chain_id=? AND factory_address=? AND series_id=?").run(args.stablePayout.toString(), args.upPayout.toString(), chainId, factory.factory, args.seriesId);
    }
    if (factory && decoded.eventName === "BridgeReserveFunded") {
        const row = db
            .prepare("SELECT series_key FROM series WHERE chain_id=? AND factory_address=? AND series_id=?")
            .get(chainId, factory.factory, args.seriesId);
        if (row)
            upsertReserve(db, chainId, row.series_key, BigInt(args.amount), BigInt(args.amount), log.blockNumber ?? undefined);
    }
    if (factory && decoded.eventName === "BridgeMinted") {
        const row = db
            .prepare("SELECT series_key FROM series WHERE chain_id=? AND factory_address=? AND series_id=?")
            .get(chainId, factory.factory, args.seriesId);
        if (row)
            upsertReserve(db, chainId, row.series_key, 0n, -BigInt(args.amount), log.blockNumber ?? undefined);
    }
    if (vault && decoded.eventName === "ReserveDeposited") {
        const row = db
            .prepare("SELECT series_key FROM series WHERE chain_id=? AND factory_address=? AND series_id=?")
            .get(chainId, vault.factory, args.seriesId);
        if (row)
            upsertReserve(db, chainId, row.series_key, BigInt(args.amount), 0n, log.blockNumber ?? undefined);
    }
    if (vault && decoded.eventName === "ReserveWithdrawn") {
        const row = db
            .prepare("SELECT series_key FROM series WHERE chain_id=? AND factory_address=? AND series_id=?")
            .get(chainId, vault.factory, args.seriesId);
        if (row)
            upsertReserve(db, chainId, row.series_key, -BigInt(args.amount), 0n, log.blockNumber ?? undefined);
    }
    return true;
}
