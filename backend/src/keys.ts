import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";

export function normalizeAddress(address: Address): Address {
  return address.toLowerCase() as Address;
}

export function seriesPrimaryKey(chainId: number, factoryAddress: Address, seriesId: Hex): string {
  return `${chainId}:${normalizeAddress(factoryAddress)}:${seriesId.toLowerCase()}`;
}

export function factoryPrimaryKey(chainId: number, factoryAddress: Address): string {
  return `${chainId}:${normalizeAddress(factoryAddress)}`;
}

export function enginePrimaryKey(chainId: number, engineAddress: Address): string {
  return `${chainId}:${normalizeAddress(engineAddress)}`;
}

export function bridgePrimaryKey(chainId: number, bridgeAddress: Address): string {
  return `${chainId}:${normalizeAddress(bridgeAddress)}`;
}

export function bridgeRequestPrimaryKey(chainId: number, bridgeAddress: Address, requestId: bigint | string): string {
  return `${chainId}:${normalizeAddress(bridgeAddress)}:${requestId.toString()}`;
}

export function listingPrimaryKey(chainId: number, engineAddress: Address, listingId: bigint | string): string {
  return `${chainId}:${normalizeAddress(engineAddress)}:${listingId.toString()}`;
}

export function positionActivityPrimaryKey(
  chainId: number,
  factoryAddress: Address,
  userAddress: Address,
  seriesId: Hex,
): string {
  return `${chainId}:${normalizeAddress(factoryAddress)}:${normalizeAddress(userAddress)}:${seriesId.toLowerCase()}`;
}

export function deriveSeriesId(strikePrice: bigint, maturityTimestamp: bigint): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256 strikePrice, uint64 maturityTimestamp"), [
      strikePrice,
      maturityTimestamp,
    ]),
  );
}
