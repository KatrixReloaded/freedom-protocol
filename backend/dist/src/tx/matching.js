import { bodyAddress, bodyString, encode, txResponse } from "./common.js";
export function buildCreateListing(ctx, body) {
    const chainId = Number(body.chainId);
    const engine = ctx.registry.chain(chainId)?.matchingEngine;
    if (!engine)
        throw Object.assign(new Error("Matching engine not configured"), { statusCode: 404 });
    const args = [
        bodyAddress(body, "token"),
        bodyAddress(body, "quoteToken"),
        BigInt(bodyString(body, "strike")),
        BigInt(bodyString(body, "maturity")),
        bodyString(body, "encAmount"),
        bodyString(body, "encMinReceive"),
        bodyString(body, "amountProof"),
        bodyString(body, "minProof")
    ];
    return txResponse({
        chainId,
        to: engine,
        data: encode(ctx.abis, "ConfidentialMatchingEngine", "createListing", args),
        functionName: "createListing",
        args,
        summary: "Create encrypted all-or-nothing OTC listing"
    });
}
export function buildFillListing(ctx, body) {
    const chainId = Number(body.chainId);
    const engine = ctx.registry.chain(chainId)?.matchingEngine;
    if (!engine)
        throw Object.assign(new Error("Matching engine not configured"), { statusCode: 404 });
    const args = [
        BigInt(bodyString(body, "listingId")),
        bodyString(body, "encPayment"),
        bodyString(body, "encExpected"),
        bodyString(body, "paymentProof"),
        bodyString(body, "expectedProof")
    ];
    return txResponse({
        chainId,
        to: engine,
        data: encode(ctx.abis, "ConfidentialMatchingEngine", "fill", args),
        functionName: "fill",
        args,
        summary: "Fill encrypted OTC listing"
    });
}
export function buildCancelListing(ctx, body) {
    const chainId = Number(body.chainId);
    const engine = ctx.registry.chain(chainId)?.matchingEngine;
    if (!engine)
        throw Object.assign(new Error("Matching engine not configured"), { statusCode: 404 });
    const args = [BigInt(bodyString(body, "listingId"))];
    return txResponse({
        chainId,
        to: engine,
        data: encode(ctx.abis, "ConfidentialMatchingEngine", "cancelListing", args),
        functionName: "cancelListing",
        args,
        summary: "Cancel encrypted OTC listing"
    });
}
