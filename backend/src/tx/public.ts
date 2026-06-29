import { getAddress, zeroAddress } from "viem";
import type { TxResponse } from "../types/api.js";
import { bodyAddress, bodyChainId, bodySeries, bodyString, encode, isNative, txResponse, type BuilderContext } from "./common.js";

export function buildApproveCollateral(ctx: BuilderContext, body: any): TxResponse {
  const chainId = bodyChainId(body);
  const factory = bodyAddress(body, "factory");
  const amount = BigInt(bodyString(body, "amount"));
  const deployment = ctx.registry.publicFactory(chainId, factory);
  if (!deployment) throw Object.assign(new Error("Unknown public factory"), { statusCode: 404 });
  if (isNative(deployment.collateralToken)) {
    throw Object.assign(new Error("Native ETH does not use ERC20 approval"), { statusCode: 400 });
  }
  return txResponse({
    chainId,
    to: deployment.collateralToken,
    data: encode(ctx.abis, "IERC20", "approve", [deployment.vault, amount]),
    functionName: "approve",
    args: [deployment.vault, amount],
    summary: `Approve vault to spend ${amount.toString()} collateral units`,
    preconditions: [{ kind: "spender", status: "satisfied", spender: deployment.vault }],
    warnings: ["Approval spender is the public vault, not the factory."]
  });
}

export function buildPublicSplit(ctx: BuilderContext, body: any): TxResponse {
  const { series } = bodySeries(ctx, body);
  const amount = BigInt(bodyString(body, "amount"));
  const deployment = ctx.registry.publicFactory(series.chainId, series.factoryAddress);
  if (!deployment) throw Object.assign(new Error("Series is not public"), { statusCode: 400 });
  const native = isNative(deployment.collateralToken);
  return txResponse({
    chainId: series.chainId,
    to: series.factoryAddress,
    data: encode(ctx.abis, "PublicOptionFactory", "split", [BigInt(series.strike), BigInt(series.maturity), amount]),
    value: native ? amount : 0n,
    functionName: "split",
    args: [series.strike, series.maturity, amount],
    summary: `Split ${amount.toString()} collateral units into P and N`,
    preconditions: native
      ? []
      : [{ kind: "allowance", status: "unknown", spender: deployment.vault, required: amount.toString() }],
    warnings: native ? [] : ["ERC20/WETH collateral must approve the public vault as spender."]
  });
}

export function buildPublicMerge(ctx: BuilderContext, body: any): TxResponse {
  const { series } = bodySeries(ctx, body);
  const amount = BigInt(bodyString(body, "amount"));
  return txResponse({
    chainId: series.chainId,
    to: series.factoryAddress,
    data: encode(ctx.abis, "PublicOptionFactory", "merge", [BigInt(series.strike), BigInt(series.maturity), amount]),
    functionName: "merge",
    args: [series.strike, series.maturity, amount],
    summary: `Merge ${amount.toString()} P and N back into collateral`
  });
}

export function buildPublicRedeem(ctx: BuilderContext, body: any): TxResponse {
  const { series } = bodySeries(ctx, body);
  return txResponse({
    chainId: series.chainId,
    to: series.factoryAddress,
    data: encode(ctx.abis, "PublicOptionFactory", "redeem", [BigInt(series.strike), BigInt(series.maturity)]),
    functionName: "redeem",
    args: [series.strike, series.maturity],
    summary: "Redeem full public P/N balances after settlement"
  });
}

export function buildFundBridgeReserve(ctx: BuilderContext, body: any): TxResponse {
  const { series } = bodySeries(ctx, body);
  const amount = BigInt(bodyString(body, "amount"));
  const deployment = ctx.registry.publicFactory(series.chainId, series.factoryAddress);
  if (!deployment) throw Object.assign(new Error("Series is not public"), { statusCode: 400 });
  const native = getAddress(deployment.collateralToken) === zeroAddress;
  return txResponse({
    chainId: series.chainId,
    to: series.factoryAddress,
    data: encode(ctx.abis, "PublicOptionFactory", "fundBridgeReserve", [
      BigInt(series.strike),
      BigInt(series.maturity),
      amount
    ]),
    value: native ? amount : 0n,
    functionName: "fundBridgeReserve",
    args: [series.strike, series.maturity, amount],
    summary: `Fund public bridge capacity with ${amount.toString()} collateral units`,
    preconditions: native
      ? []
      : [{ kind: "allowance", status: "unknown", spender: deployment.vault, required: amount.toString() }],
    warnings: native ? [] : ["ERC20/WETH bridge reserve funding must approve the public vault as spender."]
  });
}

