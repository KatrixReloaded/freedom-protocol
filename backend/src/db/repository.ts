import type { Address, Hex } from "viem";
import type {
  AppConfig,
  BridgeConfig,
  BridgeRequestFilters,
  BridgeRequestRow,
  BridgeRequestStatus,
  ChainStatusRow,
  CursorRow,
  EventGroup,
  FactoryConfig,
  ListingFilters,
  ListingRow,
  MatchingEngineConfig,
  PublicPositionActivityRow,
  SeriesFilters,
  SeriesRow,
  SourceRef,
  TokenSide,
} from "../types.js";

export interface SeriesCreatedInput extends SourceRef {
  seriesId: Hex;
  strikePrice: bigint;
  maturityTimestamp: bigint;
  stableToken: Address;
  upToken: Address;
  factory: FactoryConfig;
}

export interface SeriesSettledInput extends SourceRef {
  seriesId: Hex;
  oraclePrice: bigint;
  stablePayout: bigint;
  upPayout: bigint;
}

export interface PublicPositionDeltaInput extends SourceRef {
  userAddress: Address;
  seriesId: Hex;
  splitAmount?: bigint;
  mergeAmount?: bigint;
  redeemedClaim?: bigint;
}

export interface ListingCreatedInput extends SourceRef {
  listingId: bigint;
  seller: Address;
  token: Address;
  quoteToken: Address;
  strikePrice: bigint;
  maturityTimestamp: bigint;
  engine: MatchingEngineConfig;
  seriesId: Hex | null;
  factoryAddress: Address | null;
  tokenSide: TokenSide;
}

export interface ListingFillInput extends SourceRef {
  listingId: bigint;
  buyer: Address;
}

export interface ListingCancelInput extends SourceRef {
  listingId: bigint;
}

export interface UnshieldRequestedInput extends SourceRef {
  requestId: bigint;
  userAddress: Address;
  strikePrice: bigint;
  maturityTimestamp: bigint;
  isStable: boolean;
  requestedAmount: bigint;
  burnedAmountHandle: Hex;
}

export interface UnshieldFinalizedInput extends SourceRef {
  requestId: bigint;
  userAddress: Address;
  strikePrice: bigint;
  maturityTimestamp: bigint;
  isStable: boolean;
  amount: bigint;
}

export interface BridgeRequestStatusInput {
  id: string;
  status: BridgeRequestStatus;
  finalizeTxHash?: Hex | null;
  error?: string | null;
}

export interface KeeperBridgeRequest extends BridgeRequestRow {
  bridge: BridgeConfig;
}

export interface Repository {
  close(): Promise<void>;
  migrate?(): Promise<void>;
  initializeConfig(config: AppConfig): Promise<void>;
  recordLogOnce(source: SourceRef, eventName: string): Promise<boolean>;
  upsertSeriesCreated(input: SeriesCreatedInput): Promise<void>;
  upsertSeriesSettled(input: SeriesSettledInput): Promise<void>;
  applyPublicPositionDelta(input: PublicPositionDeltaInput): Promise<void>;
  upsertListingCreated(input: ListingCreatedInput): Promise<void>;
  markListingFilled(input: ListingFillInput): Promise<void>;
  markListingCancelled(input: ListingCancelInput): Promise<void>;
  upsertUnshieldRequested(input: UnshieldRequestedInput): Promise<void>;
  markUnshieldFinalized(input: UnshieldFinalizedInput): Promise<void>;
  updateBridgeRequestStatus(input: BridgeRequestStatusInput): Promise<void>;
  listBridgeRequests(filters: BridgeRequestFilters): Promise<BridgeRequestRow[]>;
  getBridgeRequest(id: string): Promise<BridgeRequestRow | null>;
  listKeeperReadyBridgeRequests(args: {
    chains: AppConfig["chains"];
    headByChain: Map<number, bigint>;
  }): Promise<KeeperBridgeRequest[]>;
  getCursor(chainId: number, contractAddress: Address, eventGroup: EventGroup): Promise<bigint | null>;
  setCursor(chainId: number, contractAddress: Address, eventGroup: EventGroup, blockNumber: bigint): Promise<void>;
  getChains(): Promise<ChainStatusRow[]>;
  updateChainHead(chainId: number, blockNumber: bigint): Promise<void>;
  getDeployments(): Promise<unknown>;
  listSeries(filters: SeriesFilters): Promise<SeriesRow[]>;
  getSeries(id: string): Promise<SeriesRow | null>;
  listSettlementCandidates(chainId: number, latestBlockTimestamp: bigint): Promise<SeriesRow[]>;
  findSeriesByToken(chainId: number, token: Address): Promise<SeriesRow | null>;
  listListings(filters: ListingFilters): Promise<ListingRow[]>;
  getListing(id: string): Promise<ListingRow | null>;
  listUserListings(address: Address, chainId?: number, mode?: "public" | "confidential", settled?: boolean): Promise<ListingRow[]>;
  listPublicPositionActivity(address: Address, chainId?: number, factory?: Address): Promise<PublicPositionActivityRow[]>;
  marketSummary(chainId?: number, seriesId?: Hex): Promise<{
    seriesCount: number;
    listingCount: number;
    activeListingCount: number;
    fillAttemptCount: number;
  }>;
}
