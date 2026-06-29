import { bodySeries, bodyString, encode, txResponse } from "./common.js";
export function buildConfidentialSplit(ctx, body) {
    const { series } = bodySeries(ctx, body);
    const encAmount = bodyString(body, "encAmount");
    const proof = bodyString(body, "proof");
    return txResponse({
        chainId: series.chainId,
        to: series.factoryAddress,
        data: encode(ctx.abis, "OptionFactory", "split", [BigInt(series.strike), BigInt(series.maturity), encAmount, proof]),
        functionName: "split",
        args: [series.strike, series.maturity, encAmount, proof],
        summary: "Split encrypted cWETH into confidential P and N",
        warnings: ["Encryption and input proof generation must happen client-side."]
    });
}
export function buildConfidentialMerge(ctx, body) {
    const { series } = bodySeries(ctx, body);
    const amountHandle = bodyString(body, "amountHandle");
    return txResponse({
        chainId: series.chainId,
        to: series.factoryAddress,
        data: encode(ctx.abis, "OptionFactory", "merge", [BigInt(series.strike), BigInt(series.maturity), amountHandle]),
        functionName: "merge",
        args: [series.strike, series.maturity, amountHandle],
        summary: "Merge confidential P and N using an ACL-allowed encrypted amount handle",
        warnings: ["Caller must grant factory ACL access to amountHandle before signing."]
    });
}
export function buildConfidentialRedeem(ctx, body) {
    const { series } = bodySeries(ctx, body);
    return txResponse({
        chainId: series.chainId,
        to: series.factoryAddress,
        data: encode(ctx.abis, "OptionFactory", "redeem", [BigInt(series.strike), BigInt(series.maturity)]),
        functionName: "redeem",
        args: [series.strike, series.maturity],
        summary: "Redeem confidential P/N balances after settlement"
    });
}
