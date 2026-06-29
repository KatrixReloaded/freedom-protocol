import { bodySeries, bodyString, encode, txResponse } from "./common.js";
export function buildOracleSettle(ctx, body) {
    const { series } = bodySeries(ctx, body);
    const oraclePrice = BigInt(bodyString(body, "oraclePrice"));
    const chain = ctx.registry.chain(series.chainId);
    return txResponse({
        chainId: series.chainId,
        to: series.factoryAddress,
        data: encode(ctx.abis, series.mode === "cWETH" ? "OptionFactory" : "PublicOptionFactory", "settle", [
            BigInt(series.strike),
            BigInt(series.maturity),
            oraclePrice
        ]),
        functionName: "settle",
        args: [series.strike, series.maturity, oraclePrice],
        summary: "Unsigned oracle settlement transaction",
        preconditions: [{ kind: "sender", status: "unknown", spender: chain?.oracle, message: "Sender must be configured oracle." }],
        warnings: ["Server does not sign oracle transactions in default mode."]
    });
}
