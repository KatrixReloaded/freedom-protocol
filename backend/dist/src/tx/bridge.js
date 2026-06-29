import { decodeActualBurned } from "../services/kms.js";
import { bodyBool, bodyChainId, bodyString, encode, txResponse } from "./common.js";
export function buildBridgeUnshield(ctx, body) {
    const chainId = bodyChainId(body);
    const chain = ctx.registry.chain(chainId);
    if (!chain?.bridge)
        throw Object.assign(new Error("Bridge not configured"), { statusCode: 404 });
    const strike = BigInt(bodyString(body, "strike"));
    const maturity = BigInt(bodyString(body, "maturity"));
    const isStable = bodyBool(body, "isStable");
    const amount = BigInt(bodyString(body, "amount"));
    if (amount > 18446744073709551615n)
        throw Object.assign(new Error("Amount exceeds uint64.max"), { statusCode: 400 });
    return txResponse({
        chainId,
        to: chain.bridge,
        data: encode(ctx.abis, "UnshieldBridge", "unshield", [strike, maturity, isStable, amount]),
        functionName: "unshield",
        args: [strike, maturity, isStable, amount],
        summary: "Request async unshield by burning confidential tokens",
        warnings: ["This only creates the burn request. Final public mint requires KMS proof finalization."]
    });
}
export function buildBridgeFinalize(ctx, body) {
    const chainId = bodyChainId(body);
    const chain = ctx.registry.chain(chainId);
    if (!chain?.bridge)
        throw Object.assign(new Error("Bridge not configured"), { statusCode: 404 });
    const requestId = BigInt(bodyString(body, "requestId"));
    const abiEncodedCleartexts = bodyString(body, "abiEncodedCleartexts");
    const decryptionProof = bodyString(body, "decryptionProof");
    const actualBurned = decodeActualBurned({ abiEncodedCleartexts: abiEncodedCleartexts, decryptionProof: decryptionProof });
    return txResponse({
        chainId,
        to: chain.bridge,
        data: encode(ctx.abis, "UnshieldBridge", "finalizeUnshield", [requestId, abiEncodedCleartexts, decryptionProof]),
        functionName: "finalizeUnshield",
        args: [requestId, abiEncodedCleartexts, decryptionProof],
        summary: `Finalize unshield minting exactly verified burned amount ${actualBurned}`,
        warnings: ["Mint amount is the KMS-verified actual burned amount, not the requested amount."]
    });
}
