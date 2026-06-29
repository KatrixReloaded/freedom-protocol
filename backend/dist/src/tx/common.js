import { encodeFunctionData, getAddress, zeroAddress } from "viem";
import { findSeries, parseSeriesKey } from "../services/registry.js";
export function bodyString(body, name) {
    const value = body?.[name];
    if (value == null || value === "")
        throw Object.assign(new Error(`Missing ${name}`), { statusCode: 400 });
    return String(value);
}
export function bodyBool(body, name) {
    const value = body?.[name];
    if (typeof value === "boolean")
        return value;
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    throw Object.assign(new Error(`Missing or invalid ${name}`), { statusCode: 400 });
}
export function bodyAddress(body, name) {
    return getAddress(bodyString(body, name));
}
export function bodyChainId(body) {
    const value = Number(body?.chainId);
    if (!Number.isSafeInteger(value))
        throw Object.assign(new Error("Missing or invalid chainId"), { statusCode: 400 });
    return value;
}
export function bodySeries(ctx, body) {
    const key = bodyString(body, "seriesKey");
    const parsed = parseSeriesKey(key);
    const series = findSeries(ctx.db, key);
    if (!series)
        throw Object.assign(new Error(`Unknown series ${key}`), { statusCode: 404 });
    return { key, parsed, series };
}
export function encode(abis, abiName, functionName, args) {
    return encodeFunctionData({ abi: abis.get(abiName), functionName, args });
}
export function txResponse(input) {
    return {
        chainId: input.chainId,
        to: getAddress(input.to),
        data: input.data,
        value: typeof input.value === "bigint" ? input.value.toString() : input.value ?? "0",
        functionName: input.functionName,
        args: input.args.map((arg) => (typeof arg === "bigint" ? arg.toString() : arg)),
        summary: input.summary,
        preconditions: input.preconditions ?? [],
        warnings: input.warnings ?? []
    };
}
export function isNative(token) {
    return !token || getAddress(token) === zeroAddress;
}
