import type { Address, Hex } from "viem";

export type MarketMode = "public" | "confidential";
export type TokenSide = "P" | "N" | "unknown";
export type EventGroup = "factory" | "matching-engine" | "bridge";
export type BridgeRequestStatus = "requested" | "decrypting" | "finalize_submitted" | "finalized" | "failed";
export type MarketStatus = "live" | "settled";

export interface SourceRef {
  chainId: number;
  contractAddress: Address;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  confirmationDepth: number;
  cWethAddress?: Address;
  oracleAdapter?: Address;
  settlementKeeperEnabled: boolean;
  settlementKeeperPrivateKey?: Hex;
  settlementKeeperMinConfirmations?: number;
  factories: FactoryConfig[];
  matchingEngines: MatchingEngineConfig[];
  bridges: BridgeConfig[];
  fheConfig?: FheConfig;
}

export interface FactoryConfig {
  address: Address;
  mode: MarketMode;
  collateralSymbol: "ETH" | "WETH" | "cWETH" | string;
  collateralAddress?: Address;
  oracleAdapter?: Address;
  startBlock?: bigint;
}

export interface MatchingEngineConfig {
  address: Address;
  mode: MarketMode;
  factoryAddress?: Address;
  cWethAddress?: Address;
  startBlock?: bigint;
}

export interface BridgeConfig {
  address: Address;
  publicFactory: Address;
  confidentialFactory: Address;
  startBlock?: bigint;
  keeperEnabled: boolean;
  keeperPrivateKey?: Hex;
  minConfirmationsBeforeFinalize?: number;
}

export interface FheConfig {
  publicDecryptUrl?: string;
  relayerUrl?: string;
  gatewayUrl?: string;
}

export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  pollIntervalMs: number;
  rewindBlocks: bigint;
  maxBlockRange: bigint;
  keeperPollIntervalMs: number;
  settlementKeeperPollIntervalMs: number;
  cleanupEnabled: boolean;
  cleanupRetentionDays: number;
  cleanupPollIntervalMs: number;
  indexedLogRetentionBlocks: bigint;
  chains: ChainConfig[];
}

export interface SeriesRow {
  id: string;
  chainId: number;
  factoryAddress: Address;
  seriesId: Hex;
  strikePrice: string;
  maturityTimestamp: string;
  stableToken: Address;
  upToken: Address;
  mode: MarketMode;
  collateralSymbol: string;
  collateralAddress: Address | null;
  createdBlock: string;
  createdTx: Hex;
  createdLogIndex: number;
  settled: boolean;
  oraclePrice: string | null;
  stablePayout: string | null;
  upPayout: string | null;
  settledBlock: string | null;
  settledTx: Hex | null;
  settledLogIndex: number | null;
}

export interface PublicPositionActivityRow {
  id: string;
  chainId: number;
  factoryAddress: Address;
  userAddress: Address;
  seriesId: Hex;
  splitAmount: string;
  mergeAmount: string;
  redeemedClaim: string;
  splitCount: number;
  mergeCount: number;
  redeemedCount: number;
  lastBlock: string;
  lastTx: Hex;
  lastLogIndex: number;
}

export interface ListingRow {
  id: string;
  chainId: number;
  engineAddress: Address;
  listingId: string;
  mode: MarketMode;
  seriesId: Hex | null;
  factoryAddress: Address | null;
  seller: Address;
  token: Address;
  tokenSide: TokenSide;
  quoteToken: Address;
  strikePrice: string;
  maturityTimestamp: string;
  active: boolean;
  fillAttemptCount: number;
  lastBuyer: Address | null;
  createdBlock: string;
  createdTx: Hex;
  createdLogIndex: number;
  cancelledBlock: string | null;
  cancelledTx: Hex | null;
  cancelledLogIndex: number | null;
  filledBlock: string | null;
  filledTx: Hex | null;
  filledLogIndex: number | null;
  isMatured: boolean | null;
  settled: boolean | null;
  marketStatus: MarketStatus | null;
  settlementPending: boolean | null;
  oraclePrice: string | null;
  stablePayout: string | null;
  upPayout: string | null;
  settledBlock: string | null;
  settledTx: Hex | null;
}

export interface BridgeRequestRow {
  id: string;
  chainId: number;
  bridgeAddress: Address;
  requestId: string;
  userAddress: Address;
  strikePrice: string;
  maturityTimestamp: string;
  isStable: boolean;
  requestedAmount: string;
  burnedAmountHandle: Hex;
  status: BridgeRequestStatus;
  finalizedAmount: string | null;
  requestBlock: string;
  requestTx: Hex;
  requestLogIndex: number;
  finalizeBlock: string | null;
  finalizeTx: Hex | null;
  finalizeLogIndex: number | null;
  finalizeTxHash: Hex | null;
  error: string | null;
}

export interface ChainStatusRow {
  chainId: number;
  name: string;
  rpcUrl: string;
  confirmationDepth: number;
  cWethAddress: Address | null;
  lastSeenBlock: string | null;
}

export interface CursorRow {
  chainId: number;
  contractAddress: Address;
  eventGroup: EventGroup;
  lastIndexedBlock: string;
}

export interface SeriesFilters {
  chainId?: number;
  factory?: Address;
  mode?: MarketMode;
  strike?: string;
  maturityTimestamp?: string;
  settled?: boolean;
  status?: "active";
}

export interface ListingFilters {
  chainId?: number;
  seriesId?: Hex;
  side?: TokenSide;
  mode?: MarketMode;
  active?: boolean;
  seller?: Address;
  settled?: boolean;
  engineAddress?: Address;
  engineAddresses?: Address[];
}

export interface BridgeRequestFilters {
  chainId?: number;
  bridge?: Address;
  user?: Address;
  status?: BridgeRequestStatus;
}

export interface CleanupOptions {
  retentionDays: number;
  indexedLogRetentionBlocks: bigint;
  now?: Date;
}

export interface CleanupResult {
  bridgeRequestsDeleted: number;
  marketListingsDeleted: number;
  seriesDeleted: number;
  indexedLogsDeleted: number;
}
