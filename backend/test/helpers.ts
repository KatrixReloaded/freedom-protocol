import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Abi, type Address, type Hex } from "viem";
import { confidentialFactoryAbi, confidentialMatchingEngineAbi, publicFactoryAbi, shieldBridgeAbi } from "../src/abi/contracts.js";
import type { AppConfig, BridgeConfig, FactoryConfig, MatchingEngineConfig } from "../src/types.js";

export const factoryAddress = "0x1000000000000000000000000000000000000001" as Address;
export const confidentialFactoryAddress = "0x9000000000000000000000000000000000000009" as Address;
export const engineAddress = "0x2000000000000000000000000000000000000002" as Address;
export const userAddress = "0x3000000000000000000000000000000000000003" as Address;
export const buyerAddress = "0x4000000000000000000000000000000000000004" as Address;
export const stableToken = "0x5000000000000000000000000000000000000005" as Address;
export const upToken = "0x6000000000000000000000000000000000000006" as Address;
export const quoteToken = "0x7000000000000000000000000000000000000007" as Address;
export const bridgeAddress = "0x8000000000000000000000000000000000000008" as Address;
export const oracleAdapterAddress = "0xa00000000000000000000000000000000000000a" as Address;
export const seriesId = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
export const confidentialSeriesId = "0x3333333333333333333333333333333333333333333333333333333333333333" as Hex;
export const burnedAmountHandle = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex;
export const keeperPrivateKey = `0x${"11".repeat(32)}` as Hex;
export const maturityTimestamp = 1_796_083_200n;
export const confidentialMaturityTimestamp = 1_793_404_800n;

export const publicFactory: FactoryConfig = {
  address: factoryAddress,
  mode: "public",
  collateralSymbol: "ETH",
  startBlock: 10n,
};

export const confidentialFactory: FactoryConfig = {
  address: confidentialFactoryAddress,
  mode: "confidential",
  collateralSymbol: "cWETH",
  startBlock: 10n,
};

export const confidentialEngine: MatchingEngineConfig = {
  address: engineAddress,
  mode: "confidential",
  factoryAddress,
  startBlock: 10n,
};

export const bridgeConfig: BridgeConfig = {
  address: bridgeAddress,
  publicFactory: factoryAddress,
  confidentialFactory: confidentialFactoryAddress,
  startBlock: 10n,
  keeperEnabled: false,
  minConfirmationsBeforeFinalize: 1,
};

export const testConfig: AppConfig = {
  port: 0,
  host: "127.0.0.1",
  databaseUrl: "postgres://unused",
  pollIntervalMs: 10_000,
  keeperPollIntervalMs: 10_000,
  settlementKeeperPollIntervalMs: 10_000,
  rewindBlocks: 5n,
  maxBlockRange: 1_000n,
  chains: [
    {
      chainId: 31337,
      name: "local",
      rpcUrl: "http://127.0.0.1:8545",
      confirmationDepth: 1,
      oracleAdapter: oracleAdapterAddress,
      settlementKeeperEnabled: false,
      factories: [publicFactory, confidentialFactory],
      matchingEngines: [confidentialEngine],
      bridges: [bridgeConfig],
    },
  ],
};

function eventAbi(abi: Abi, name: string) {
  const item = abi.find((entry) => entry.type === "event" && entry.name === name);
  if (!item) throw new Error(`missing event ${name}`);
  return item;
}

export function seriesCreatedLog(logIndex = 0, maturity = maturityTimestamp) {
  return {
    address: factoryAddress,
    blockNumber: 20n,
    transactionHash: `0x${"01".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: publicFactoryAbi,
      eventName: "SeriesCreated",
      args: { seriesId, strikePrice: 3000n, maturityTimestamp: maturity },
    }),
    data: encodeAbiParameters(parseAbiParameters("address stableToken, address upToken"), [stableToken, upToken]),
    removed: false,
  } as const;
}

export function confidentialSeriesCreatedLog(logIndex = 0, maturity = confidentialMaturityTimestamp) {
  return {
    address: confidentialFactoryAddress,
    blockNumber: 20n,
    transactionHash: `0x${"07".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: confidentialFactoryAbi,
      eventName: "SeriesCreated",
      args: { seriesId: confidentialSeriesId, strikePrice: 3500n, maturityTimestamp: maturity },
    }),
    data: encodeAbiParameters(parseAbiParameters("address stableToken, address upToken"), [
      "0xb00000000000000000000000000000000000000b" as Address,
      "0xc00000000000000000000000000000000000000c" as Address,
    ]),
    removed: false,
  } as const;
}

export function settledLog(logIndex = 2) {
  return {
    address: factoryAddress,
    blockNumber: 26n,
    transactionHash: `0x${"08".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: publicFactoryAbi,
      eventName: "Settled",
      args: { seriesId },
    }),
    data: encodeAbiParameters(parseAbiParameters("uint256 oraclePrice, uint256 stablePayout, uint256 upPayout"), [
      3000n,
      1_000_000n,
      0n,
    ]),
    removed: false,
  } as const;
}

export function splitLog(logIndex = 1) {
  return {
    address: factoryAddress,
    blockNumber: 21n,
    transactionHash: `0x${"02".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: publicFactoryAbi,
      eventName: "Split",
      args: { user: userAddress, seriesId },
    }),
    data: encodeAbiParameters(parseAbiParameters("uint256 amount"), [1_000_000n]),
    removed: false,
  } as const;
}

export function listingCreatedLog(logIndex = 0) {
  return {
    address: engineAddress,
    blockNumber: 22n,
    transactionHash: `0x${"03".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: confidentialMatchingEngineAbi,
      eventName: "ListingCreated",
      args: { listingId: 7n, seller: userAddress },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("address token, address quoteToken, uint256 strikePrice, uint64 maturityTimestamp"),
      [stableToken, quoteToken, 3000n, maturityTimestamp],
    ),
    removed: false,
  } as const;
}

export function fillAttemptedLog(logIndex = 1) {
  return {
    address: engineAddress,
    blockNumber: 23n,
    transactionHash: `0x${"04".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: confidentialMatchingEngineAbi,
      eventName: "FillAttempted",
      args: { listingId: 7n, buyer: buyerAddress },
    }),
    data: "0x",
    removed: false,
  } as const;
}

export function unshieldRequestedLog(logIndex = 0) {
  return {
    address: bridgeAddress,
    blockNumber: 24n,
    transactionHash: `0x${"05".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: shieldBridgeAbi,
      eventName: "UnshieldRequested",
      args: { requestId: 9n, user: userAddress, strikePrice: 3000n },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("uint64 maturityTimestamp, bool isStable, uint64 requestedAmount, bytes32 burnedAmountHandle"),
      [maturityTimestamp, true, 1_000_000n, burnedAmountHandle],
    ),
    removed: false,
  } as const;
}

export function unshieldFinalizedLog(logIndex = 1) {
  return {
    address: bridgeAddress,
    blockNumber: 25n,
    transactionHash: `0x${"06".repeat(32)}` as Hex,
    logIndex,
    topics: encodeEventTopics({
      abi: shieldBridgeAbi,
      eventName: "UnshieldFinalized",
      args: { requestId: 9n, user: userAddress, strikePrice: 3000n },
    }),
    data: encodeAbiParameters(parseAbiParameters("uint64 maturityTimestamp, bool isStable, uint64 amount"), [
      maturityTimestamp,
      true,
      900_000n,
    ]),
    removed: false,
  } as const;
}
