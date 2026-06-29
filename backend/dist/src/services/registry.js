import { encodePacked, getAddress, keccak256 } from "viem";
export function seriesId(strike, maturity) {
    return keccak256(encodePacked(["uint256", "uint64"], [BigInt(strike), BigInt(maturity)]));
}
export function seriesKey(chainId, factory, strike, maturity) {
    return `${chainId}:${getAddress(factory)}:${BigInt(strike).toString()}:${BigInt(maturity).toString()}`;
}
export function parseSeriesKey(key) {
    const [chainIdRaw, factoryRaw, strike, maturity] = key.split(":");
    const chainId = Number(chainIdRaw);
    if (!Number.isSafeInteger(chainId) || !factoryRaw || !strike || !maturity)
        throw new Error("Invalid series key");
    return { chainId, factory: getAddress(factoryRaw), strike, maturity };
}
export function modeForFactory(registry, chainId, factory) {
    const pub = registry.publicFactory(chainId, factory);
    if (pub)
        return pub.mode;
    const conf = registry.confidentialFactory(chainId, factory);
    return conf?.mode;
}
export function chainOrThrow(registry, chainId) {
    const chain = registry.chain(chainId);
    if (!chain)
        throw Object.assign(new Error(`Unknown chain ${chainId}`), { statusCode: 404 });
    return chain;
}
export function factoryOrThrow(registry, chainId, factory) {
    const deployment = registry.factory(chainId, factory);
    if (!deployment)
        throw Object.assign(new Error(`Unknown factory ${factory} on ${chainId}`), { statusCode: 404 });
    return deployment;
}
export function findSeries(db, key) {
    const row = db.prepare("SELECT * FROM series WHERE series_key=?").get(key);
    if (!row)
        return undefined;
    return rowToSeries(row);
}
export function rowToSeries(row) {
    return {
        key: row.series_key,
        chainId: Number(row.chain_id),
        factoryAddress: getAddress(row.factory_address),
        seriesId: row.series_id,
        strike: row.strike,
        maturity: row.maturity,
        mode: row.mode,
        collateralToken: row.collateral_token ? getAddress(row.collateral_token) : undefined,
        stableToken: row.stable_token ? getAddress(row.stable_token) : undefined,
        upToken: row.up_token ? getAddress(row.up_token) : undefined,
        settled: Boolean(row.settled),
        stablePayout: row.stable_payout ?? undefined,
        upPayout: row.up_payout ?? undefined,
        createdBlock: row.created_block == null ? undefined : String(row.created_block)
    };
}
export function upsertSeries(db, record) {
    db.prepare("INSERT INTO series (series_key,chain_id,factory_address,series_id,strike,maturity,mode,collateral_token,stable_token,up_token,settled,stable_payout,up_payout,created_block,updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) " +
        "ON CONFLICT(series_key) DO UPDATE SET stable_token=COALESCE(excluded.stable_token,series.stable_token),up_token=COALESCE(excluded.up_token,series.up_token),settled=excluded.settled,stable_payout=COALESCE(excluded.stable_payout,series.stable_payout),up_payout=COALESCE(excluded.up_payout,series.up_payout),updated_at=CURRENT_TIMESTAMP").run(record.key, record.chainId, record.factoryAddress, record.seriesId, record.strike, record.maturity, record.mode, record.collateralToken ?? null, record.stableToken ?? null, record.upToken ?? null, record.settled ? 1 : 0, record.stablePayout ?? null, record.upPayout ?? null, record.createdBlock ? Number(record.createdBlock) : null);
}
export function seedKnownSeries(db, registry) {
    for (const chain of registry.chains) {
        for (const known of chain.series ?? []) {
            const key = seriesKey(chain.chainId, known.factory, known.strike, known.maturity);
            const mode = known.mode ?? modeForFactory(registry, chain.chainId, known.factory) ?? "ETH";
            const deployment = registry.factory(chain.chainId, known.factory);
            upsertSeries(db, {
                key,
                chainId: chain.chainId,
                factoryAddress: getAddress(known.factory),
                seriesId: seriesId(known.strike, known.maturity),
                strike: BigInt(known.strike).toString(),
                maturity: BigInt(known.maturity).toString(),
                mode,
                collateralToken: "collateralToken" in (deployment ?? {}) ? deployment.collateralToken : deployment?.cWETH,
                stableToken: known.stableToken,
                upToken: known.upToken,
                settled: false
            });
        }
    }
}
