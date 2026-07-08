import type { Address, Hex } from "viem";
import {
  bridgeRequestPrimaryKey,
  enginePrimaryKey,
  factoryPrimaryKey,
  listingPrimaryKey,
  normalizeAddress,
  positionActivityPrimaryKey,
  seriesPrimaryKey,
} from "../keys.js";
import type {
  AppConfig,
  BridgeRequestFilters,
  BridgeRequestRow,
  BridgeRequestStatus,
  ChainStatusRow,
  EventGroup,
  ListingFilters,
  ListingRow,
  MarketMode,
  PublicPositionActivityRow,
  SeriesFilters,
  SeriesRow,
  SourceRef,
} from "../types.js";
import type {
  BridgeRequestStatusInput,
  KeeperBridgeRequest,
  ListingCancelInput,
  ListingCreatedInput,
  ListingFillInput,
  PublicPositionDeltaInput,
  Repository,
  SeriesCreatedInput,
  SeriesSettledInput,
  UnshieldFinalizedInput,
  UnshieldRequestedInput,
} from "./repository.js";

function sourceKey(source: SourceRef): string {
  return `${source.chainId}:${source.transactionHash.toLowerCase()}:${source.logIndex}`;
}

function blockText(value: bigint): string {
  return value.toString();
}

function deploymentContract<T extends { startBlock?: bigint; oracleAdapter?: Address }>(
  contract: T,
  oracleAdapter?: Address,
): Omit<T, "startBlock"> & { startBlock: string | null; oracleAdapter?: Address | null } {
  return {
    ...contract,
    startBlock: contract.startBlock == null ? null : contract.startBlock.toString(),
    oracleAdapter: contract.oracleAdapter ?? oracleAdapter ?? null,
  };
}

function deploymentStartBlock<T extends { startBlock?: bigint }>(value: T): Omit<T, "startBlock"> & { startBlock: string | null } {
  return {
    ...value,
    startBlock: value.startBlock == null ? null : value.startBlock.toString(),
  };
}

export class MemoryRepository implements Repository {
  private deployments: unknown = { chains: [] };
  private chains = new Map<number, ChainStatusRow>();
  private series = new Map<string, SeriesRow>();
  private listings = new Map<string, ListingRow>();
  private bridgeRequests = new Map<string, BridgeRequestRow>();
  private activity = new Map<string, PublicPositionActivityRow>();
  private cursors = new Map<string, bigint>();
  private logs = new Set<string>();

  private enrichListing(row: ListingRow): ListingRow {
    const series =
      [...this.series.values()].find(
        (candidate) =>
          candidate.chainId === row.chainId &&
          row.factoryAddress != null &&
          candidate.factoryAddress === row.factoryAddress &&
          candidate.seriesId === row.seriesId,
      ) ??
      [...this.series.values()].find(
        (candidate) =>
          candidate.chainId === row.chainId &&
          (candidate.stableToken === row.token || candidate.upToken === row.token),
      );
    if (!series) {
      return {
        ...row,
        isMatured: null,
        settled: null,
        marketStatus: null,
        settlementPending: null,
        oraclePrice: null,
        stablePayout: null,
        upPayout: null,
        settledBlock: null,
        settledTx: null,
      };
    }
    const isMatured = BigInt(series.maturityTimestamp) <= BigInt(Math.floor(Date.now() / 1000));
    return {
      ...row,
      maturityTimestamp: series.maturityTimestamp,
      isMatured,
      settled: series.settled,
      marketStatus: series.settled ? "settled" : "live",
      settlementPending: isMatured && !series.settled,
      oraclePrice: series.oraclePrice,
      stablePayout: series.stablePayout,
      upPayout: series.upPayout,
      settledBlock: series.settledBlock,
      settledTx: series.settledTx,
    };
  }

  async close(): Promise<void> {}

  async initializeConfig(config: AppConfig): Promise<void> {
    this.deployments = {
      chains: config.chains.map((chain) => ({
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.rpcUrl,
        confirmationDepth: chain.confirmationDepth,
        cWethAddress: chain.cWethAddress ?? null,
        oracleAdapter: chain.oracleAdapter ?? null,
        settlementKeeperEnabled: chain.settlementKeeperEnabled,
        settlementKeeperMinConfirmations: chain.settlementKeeperMinConfirmations ?? null,
        factories: chain.factories.map((factory) => deploymentContract(factory, chain.oracleAdapter)),
        matchingEngines: chain.matchingEngines.map((engine) => deploymentStartBlock(engine)),
        bridges: chain.bridges.map(({ keeperPrivateKey: _keeperPrivateKey, ...bridge }) => deploymentStartBlock(bridge)),
        fheConfig: chain.fheConfig ?? null,
      })),
    };
    for (const chain of config.chains) {
      this.chains.set(chain.chainId, {
        chainId: chain.chainId,
        name: chain.name,
        rpcUrl: chain.rpcUrl,
        confirmationDepth: chain.confirmationDepth,
        cWethAddress: chain.cWethAddress ?? null,
        lastSeenBlock: this.chains.get(chain.chainId)?.lastSeenBlock ?? null,
      });
    }
  }

  async recordLogOnce(source: SourceRef): Promise<boolean> {
    const key = sourceKey(source);
    if (this.logs.has(key)) return false;
    this.logs.add(key);
    return true;
  }

  async upsertSeriesCreated(input: SeriesCreatedInput): Promise<void> {
    const id = seriesPrimaryKey(input.chainId, input.contractAddress, input.seriesId);
    const existing = this.series.get(id);
    this.series.set(id, {
      id,
      chainId: input.chainId,
      factoryAddress: normalizeAddress(input.contractAddress),
      seriesId: input.seriesId.toLowerCase() as Hex,
      strikePrice: input.strikePrice.toString(),
      maturityTimestamp: input.maturityTimestamp.toString(),
      stableToken: normalizeAddress(input.stableToken),
      upToken: normalizeAddress(input.upToken),
      mode: input.factory.mode,
      collateralSymbol: input.factory.collateralSymbol,
      collateralAddress: input.factory.collateralAddress ? normalizeAddress(input.factory.collateralAddress) : null,
      createdBlock: blockText(input.blockNumber),
      createdTx: input.transactionHash.toLowerCase() as Hex,
      createdLogIndex: input.logIndex,
      settled: existing?.settled ?? false,
      oraclePrice: existing?.oraclePrice ?? null,
      stablePayout: existing?.stablePayout ?? null,
      upPayout: existing?.upPayout ?? null,
      settledBlock: existing?.settledBlock ?? null,
      settledTx: existing?.settledTx ?? null,
      settledLogIndex: existing?.settledLogIndex ?? null,
    });
  }

  async upsertSeriesSettled(input: SeriesSettledInput): Promise<void> {
    const id = seriesPrimaryKey(input.chainId, input.contractAddress, input.seriesId);
    const row = this.series.get(id);
    if (!row) return;
    this.series.set(id, {
      ...row,
      settled: true,
      oraclePrice: input.oraclePrice.toString(),
      stablePayout: input.stablePayout.toString(),
      upPayout: input.upPayout.toString(),
      settledBlock: blockText(input.blockNumber),
      settledTx: input.transactionHash.toLowerCase() as Hex,
      settledLogIndex: input.logIndex,
    });
  }

  async applyPublicPositionDelta(input: PublicPositionDeltaInput): Promise<void> {
    const id = positionActivityPrimaryKey(input.chainId, input.contractAddress, input.userAddress, input.seriesId);
    const row = this.activity.get(id);
    const split = input.splitAmount ?? 0n;
    const merge = input.mergeAmount ?? 0n;
    const redeemed = input.redeemedClaim ?? 0n;
    this.activity.set(id, {
      id,
      chainId: input.chainId,
      factoryAddress: normalizeAddress(input.contractAddress),
      userAddress: normalizeAddress(input.userAddress),
      seriesId: input.seriesId.toLowerCase() as Hex,
      splitAmount: ((row ? BigInt(row.splitAmount) : 0n) + split).toString(),
      mergeAmount: ((row ? BigInt(row.mergeAmount) : 0n) + merge).toString(),
      redeemedClaim: ((row ? BigInt(row.redeemedClaim) : 0n) + redeemed).toString(),
      splitCount: (row?.splitCount ?? 0) + (split > 0n ? 1 : 0),
      mergeCount: (row?.mergeCount ?? 0) + (merge > 0n ? 1 : 0),
      redeemedCount: (row?.redeemedCount ?? 0) + (redeemed > 0n ? 1 : 0),
      lastBlock: blockText(input.blockNumber),
      lastTx: input.transactionHash.toLowerCase() as Hex,
      lastLogIndex: input.logIndex,
    });
  }

  async upsertListingCreated(input: ListingCreatedInput): Promise<void> {
    const id = listingPrimaryKey(input.chainId, input.contractAddress, input.listingId);
    const existing = this.listings.get(id);
    this.listings.set(id, {
      id,
      chainId: input.chainId,
      engineAddress: normalizeAddress(input.contractAddress),
      listingId: input.listingId.toString(),
      mode: input.engine.mode,
      seriesId: input.seriesId ? (input.seriesId.toLowerCase() as Hex) : null,
      factoryAddress: input.factoryAddress ? normalizeAddress(input.factoryAddress) : null,
      seller: normalizeAddress(input.seller),
      token: normalizeAddress(input.token),
      tokenSide: input.tokenSide,
      quoteToken: normalizeAddress(input.quoteToken),
      strikePrice: input.strikePrice.toString(),
      maturityTimestamp: input.maturityTimestamp.toString(),
      active: existing?.active ?? true,
      fillAttemptCount: existing?.fillAttemptCount ?? 0,
      lastBuyer: existing?.lastBuyer ?? null,
      createdBlock: blockText(input.blockNumber),
      createdTx: input.transactionHash.toLowerCase() as Hex,
      createdLogIndex: input.logIndex,
      cancelledBlock: existing?.cancelledBlock ?? null,
      cancelledTx: existing?.cancelledTx ?? null,
      cancelledLogIndex: existing?.cancelledLogIndex ?? null,
      filledBlock: existing?.filledBlock ?? null,
      filledTx: existing?.filledTx ?? null,
      filledLogIndex: existing?.filledLogIndex ?? null,
      isMatured: existing?.isMatured ?? null,
      settled: existing?.settled ?? null,
      marketStatus: existing?.marketStatus ?? null,
      settlementPending: existing?.settlementPending ?? null,
      oraclePrice: existing?.oraclePrice ?? null,
      stablePayout: existing?.stablePayout ?? null,
      upPayout: existing?.upPayout ?? null,
      settledBlock: existing?.settledBlock ?? null,
      settledTx: existing?.settledTx ?? null,
    });
  }

  async markListingFilled(input: ListingFillInput): Promise<void> {
    const id = listingPrimaryKey(input.chainId, input.contractAddress, input.listingId);
    const row = this.listings.get(id);
    if (!row) return;
    this.listings.set(id, {
      ...row,
      active: false,
      fillAttemptCount: row.fillAttemptCount + 1,
      lastBuyer: normalizeAddress(input.buyer),
      filledBlock: blockText(input.blockNumber),
      filledTx: input.transactionHash.toLowerCase() as Hex,
      filledLogIndex: input.logIndex,
    });
  }

  async markListingCancelled(input: ListingCancelInput): Promise<void> {
    const id = listingPrimaryKey(input.chainId, input.contractAddress, input.listingId);
    const row = this.listings.get(id);
    if (!row) return;
    this.listings.set(id, {
      ...row,
      active: false,
      cancelledBlock: blockText(input.blockNumber),
      cancelledTx: input.transactionHash.toLowerCase() as Hex,
      cancelledLogIndex: input.logIndex,
    });
  }

  async upsertUnshieldRequested(input: UnshieldRequestedInput): Promise<void> {
    const id = bridgeRequestPrimaryKey(input.chainId, input.contractAddress, input.requestId);
    const existing = this.bridgeRequests.get(id);
    this.bridgeRequests.set(id, {
      id,
      chainId: input.chainId,
      bridgeAddress: normalizeAddress(input.contractAddress),
      requestId: input.requestId.toString(),
      userAddress: normalizeAddress(input.userAddress),
      strikePrice: input.strikePrice.toString(),
      maturityTimestamp: input.maturityTimestamp.toString(),
      isStable: input.isStable,
      requestedAmount: input.requestedAmount.toString(),
      burnedAmountHandle: input.burnedAmountHandle.toLowerCase() as Hex,
      status: existing?.status === "finalized" ? "finalized" : "requested",
      finalizedAmount: existing?.finalizedAmount ?? null,
      requestBlock: blockText(input.blockNumber),
      requestTx: input.transactionHash.toLowerCase() as Hex,
      requestLogIndex: input.logIndex,
      finalizeBlock: existing?.finalizeBlock ?? null,
      finalizeTx: existing?.finalizeTx ?? null,
      finalizeLogIndex: existing?.finalizeLogIndex ?? null,
      finalizeTxHash: existing?.finalizeTxHash ?? null,
      error: null,
    });
  }

  async markUnshieldFinalized(input: UnshieldFinalizedInput): Promise<void> {
    const id = bridgeRequestPrimaryKey(input.chainId, input.contractAddress, input.requestId);
    const row = this.bridgeRequests.get(id);
    if (!row) return;
    this.bridgeRequests.set(id, {
      ...row,
      status: "finalized",
      finalizedAmount: input.amount.toString(),
      finalizeBlock: blockText(input.blockNumber),
      finalizeTx: input.transactionHash.toLowerCase() as Hex,
      finalizeLogIndex: input.logIndex,
      error: null,
    });
  }

  async updateBridgeRequestStatus(input: BridgeRequestStatusInput): Promise<void> {
    const row = this.bridgeRequests.get(input.id);
    if (!row || row.status === "finalized") return;
    this.bridgeRequests.set(input.id, {
      ...row,
      status: input.status,
      finalizeTxHash: input.finalizeTxHash ? (input.finalizeTxHash.toLowerCase() as Hex) : row.finalizeTxHash,
      error: input.error ?? null,
    });
  }

  async getCursor(chainId: number, contractAddress: Address, eventGroup: EventGroup): Promise<bigint | null> {
    return this.cursors.get(`${chainId}:${normalizeAddress(contractAddress)}:${eventGroup}`) ?? null;
  }

  async setCursor(chainId: number, contractAddress: Address, eventGroup: EventGroup, blockNumber: bigint): Promise<void> {
    this.cursors.set(`${chainId}:${normalizeAddress(contractAddress)}:${eventGroup}`, blockNumber);
  }

  async getChains(): Promise<ChainStatusRow[]> {
    return [...this.chains.values()].sort((a, b) => a.chainId - b.chainId);
  }

  async updateChainHead(chainId: number, blockNumber: bigint): Promise<void> {
    const row = this.chains.get(chainId);
    if (row) this.chains.set(chainId, { ...row, lastSeenBlock: blockNumber.toString() });
  }

  async getDeployments(): Promise<unknown> {
    return this.deployments;
  }

  async listSeries(filters: SeriesFilters): Promise<SeriesRow[]> {
    const now = BigInt(Math.floor(Date.now() / 1000));
    return [...this.series.values()].filter((row) => {
      if (filters.chainId && row.chainId !== filters.chainId) return false;
      if (filters.factory && row.factoryAddress !== normalizeAddress(filters.factory)) return false;
      if (filters.mode && row.mode !== filters.mode) return false;
      if (filters.strike && row.strikePrice !== filters.strike) return false;
      if (filters.maturityTimestamp && row.maturityTimestamp !== filters.maturityTimestamp) return false;
      if (filters.settled !== undefined && row.settled !== filters.settled) return false;
      if (filters.status === "active" && (BigInt(row.maturityTimestamp) <= now || row.settled)) return false;
      return true;
    }).sort((left, right) => {
      const maturity = BigInt(left.maturityTimestamp) - BigInt(right.maturityTimestamp);
      if (maturity !== 0n) return maturity < 0n ? -1 : 1;
      const strike = BigInt(left.strikePrice) - BigInt(right.strikePrice);
      if (strike !== 0n) return strike < 0n ? -1 : 1;
      return left.factoryAddress.localeCompare(right.factoryAddress);
    });
  }

  async getSeries(id: string): Promise<SeriesRow | null> {
    return this.series.get(id) ?? null;
  }

  async listSettlementCandidates(chainId: number, latestBlockTimestamp: bigint): Promise<SeriesRow[]> {
    return [...this.series.values()].filter(
      (row) => row.chainId === chainId && !row.settled && BigInt(row.maturityTimestamp) <= latestBlockTimestamp,
    );
  }

  async findSeriesByToken(chainId: number, token: Address): Promise<SeriesRow | null> {
    const normalized = normalizeAddress(token);
    return [...this.series.values()].find((row) => row.chainId === chainId && (row.stableToken === normalized || row.upToken === normalized)) ?? null;
  }

  async listListings(filters: ListingFilters): Promise<ListingRow[]> {
    const engineAddresses =
      filters.engineAddresses === undefined
        ? undefined
        : new Set(filters.engineAddresses.map((address) => normalizeAddress(address)));
    return [...this.listings.values()].map((row) => this.enrichListing(row)).filter((row) => {
      if (filters.chainId && row.chainId !== filters.chainId) return false;
      if (filters.seriesId && row.seriesId !== filters.seriesId.toLowerCase()) return false;
      if (filters.side && row.tokenSide !== filters.side) return false;
      if (filters.mode && row.mode !== filters.mode) return false;
      if (filters.active !== undefined && row.active !== filters.active) return false;
      if (filters.seller && row.seller !== normalizeAddress(filters.seller)) return false;
      if (filters.settled !== undefined && row.settled !== filters.settled) return false;
      if (filters.engineAddress && row.engineAddress !== normalizeAddress(filters.engineAddress)) return false;
      if (engineAddresses !== undefined && !engineAddresses.has(row.engineAddress)) return false;
      return true;
    });
  }

  async getListing(id: string): Promise<ListingRow | null> {
    const row = this.listings.get(id);
    return row ? this.enrichListing(row) : null;
  }

  async listUserListings(address: Address, chainId?: number, mode?: MarketMode, settled?: boolean): Promise<ListingRow[]> {
    return this.listListings({ seller: normalizeAddress(address), chainId, mode, settled });
  }

  async listPublicPositionActivity(address: Address, chainId?: number, factory?: Address): Promise<PublicPositionActivityRow[]> {
    const normalized = normalizeAddress(address);
    return [...this.activity.values()].filter((row) => {
      if (row.userAddress !== normalized) return false;
      if (chainId && row.chainId !== chainId) return false;
      if (factory && row.factoryAddress !== normalizeAddress(factory)) return false;
      return true;
    });
  }

  async listBridgeRequests(filters: BridgeRequestFilters): Promise<BridgeRequestRow[]> {
    return [...this.bridgeRequests.values()].filter((row) => {
      if (filters.chainId && row.chainId !== filters.chainId) return false;
      if (filters.bridge && row.bridgeAddress !== normalizeAddress(filters.bridge)) return false;
      if (filters.user && row.userAddress !== normalizeAddress(filters.user)) return false;
      if (filters.status && row.status !== filters.status) return false;
      return true;
    });
  }

  async getBridgeRequest(id: string): Promise<BridgeRequestRow | null> {
    return this.bridgeRequests.get(id) ?? null;
  }

  async listKeeperReadyBridgeRequests(args: {
    chains: AppConfig["chains"];
    headByChain: Map<number, bigint>;
  }): Promise<KeeperBridgeRequest[]> {
    const ready: KeeperBridgeRequest[] = [];
    for (const chain of args.chains) {
      const head = args.headByChain.get(chain.chainId);
      if (head == null) continue;
      for (const bridge of chain.bridges) {
        if (!bridge.keeperEnabled || !bridge.keeperPrivateKey) continue;
        const minConfirmations = BigInt(bridge.minConfirmationsBeforeFinalize ?? chain.confirmationDepth);
        const maxRequestBlock = head > minConfirmations ? head - minConfirmations : 0n;
        for (const row of this.bridgeRequests.values()) {
          if (row.chainId !== chain.chainId) continue;
          if (row.bridgeAddress !== normalizeAddress(bridge.address)) continue;
          if (row.status !== "requested" && row.status !== "failed") continue;
          if (BigInt(row.requestBlock) > maxRequestBlock) continue;
          ready.push({ ...row, bridge });
        }
      }
    }
    return ready;
  }

  async marketSummary(chainId?: number, seriesId?: Hex): Promise<{ seriesCount: number; listingCount: number; activeListingCount: number; fillAttemptCount: number }> {
    const series = [...this.series.values()].filter((row) => {
      if (chainId && row.chainId !== chainId) return false;
      if (seriesId && row.seriesId !== seriesId.toLowerCase()) return false;
      return true;
    });
    const listings = [...this.listings.values()].filter((row) => {
      if (chainId && row.chainId !== chainId) return false;
      if (seriesId && row.seriesId !== seriesId.toLowerCase()) return false;
      return true;
    });
    return {
      seriesCount: series.length,
      listingCount: listings.length,
      activeListingCount: listings.filter((row) => row.active).length,
      fillAttemptCount: listings.reduce((sum, row) => sum + row.fillAttemptCount, 0),
    };
  }
}
