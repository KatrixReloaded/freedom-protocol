import { getAddress } from "viem";
import { bodyAddress, bodyString, encode, txResponse } from "./common.js";
export function buildPoolDeposit(ctx, body) {
    const chainId = Number(body.chainId);
    const pool = bodyAddress(body, "pool");
    const args = [bodyString(body, "encAmount"), bodyString(body, "proof")];
    return txResponse({
        chainId,
        to: pool,
        data: encode(ctx.abis, "SeriesPool", "deposit", args),
        functionName: "deposit",
        args,
        summary: "Deposit encrypted option tokens into a series pool"
    });
}
export function buildPoolFill(ctx, body) {
    const chainId = Number(body.chainId);
    const pool = bodyAddress(body, "pool");
    const args = [bodyString(body, "encPayment"), bodyString(body, "encExpected"), bodyString(body, "paymentProof"), bodyString(body, "expectedProof")];
    return txResponse({
        chainId,
        to: pool,
        data: encode(ctx.abis, "SeriesPool", "fill", args),
        functionName: "fill",
        args,
        summary: "Fill encrypted liquidity from a series pool"
    });
}
export function buildPoolWithdraw(ctx, body) {
    const chainId = Number(body.chainId);
    const pool = getAddress(bodyString(body, "pool"));
    return txResponse({
        chainId,
        to: pool,
        data: encode(ctx.abis, "SeriesPool", "withdraw", []),
        functionName: "withdraw",
        args: [],
        summary: "Withdraw remaining option tokens and earned quote from a series pool"
    });
}
