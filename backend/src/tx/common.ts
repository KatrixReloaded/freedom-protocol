import { encodeFunctionData, getAddress, type Address, type Abi, type Hex, zeroAddress } from "viem";
import type { AbiBundle, AbiName } from "../config/abis.js";
import type { DeploymentRegistry } from "../config/deployments.js";
import type { Db } from "../db/client.js";
import type { TxResponse } from "../types/api.js";
import { findSeries, parseSeriesKey } from "../services/registry.js";

export interface BuilderContext {
  db: Db;
  registry: DeploymentRegistry;
  abis: AbiBundle;
}

export function bodyString(body: any, name: string): string {
  const value = body?.[name];
  if (value == null || value === "") throw Object.assign(new Error(`Missing ${name}`), { statusCode: 400 });
  return String(value);
}

export function bodyBool(body: any, name: string): boolean {
  const value = body?.[name];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw Object.assign(new Error(`Missing or invalid ${name}`), { statusCode: 400 });
}

export function bodyAddress(body: any, name: string): Address {
  return getAddress(bodyString(body, name));
}

export function bodyChainId(body: any): number {
  const value = Number(body?.chainId);
  if (!Number.isSafeInteger(value)) throw Object.assign(new Error("Missing or invalid chainId"), { statusCode: 400 });
  return value;
}

export function bodySeries(ctx: BuilderContext, body: any) {
  const key = bodyString(body, "seriesKey");
  const parsed = parseSeriesKey(key);
  const series = findSeries(ctx.db, key);
  if (!series) throw Object.assign(new Error(`Unknown series ${key}`), { statusCode: 404 });
  return { key, parsed, series };
}

export function encode(abis: AbiBundle, abiName: AbiName, functionName: string, args: unknown[]): Hex {
  return encodeFunctionData({ abi: abis.get(abiName) as Abi, functionName, args });
}

export function txResponse(input: {
  chainId: number;
  to: Address;
  data: Hex;
  value?: string | bigint;
  functionName: string;
  args: unknown[];
  summary: string;
  preconditions?: TxResponse["preconditions"];
  warnings?: string[];
}): TxResponse {
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

export function isNative(token?: string): boolean {
  return !token || getAddress(token) === zeroAddress;
}

