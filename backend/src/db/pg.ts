import pg from "pg";
import type { Address, Hex } from "viem";
import {
  bridgePrimaryKey,
  bridgeRequestPrimaryKey,
  enginePrimaryKey,
  factoryPrimaryKey,
  listingPrimaryKey,
  normalizeAddress,
  positionActivityPrimaryKey,
  seriesPrimaryKey,
} from "../keys.js";
import type { AppConfig, BridgeRequestFilters, BridgeRequestRow, BridgeRequestStatus, ChainStatusRow, EventGroup, ListingFilters, ListingRow, MarketMode, PublicPositionActivityRow, SeriesFilters, SeriesRow, SourceRef } from "../types.js";
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
import { runMigrations } from "./migrate.js";

const { Pool } = pg;

function bigintText(value: bigint): string {
  return value.toString();
}

function rowToChain(row: Record<string, unknown>): ChainStatusRow {
  return {
    chainId: Number(row.chain_id),
    name: String(row.name),
    rpcUrl: String(row.rpc_url),
    confirmationDepth: Number(row.confirmation_depth),
    cWethAddress: (row.c_weth_address as Address | null) ?? null,
    lastSeenBlock: row.last_seen_block == null ? null : String(row.last_seen_block),
  };
}

function rowToSeries(row: Record<string, unknown>): SeriesRow {
  return {
    id: String(row.id),
    chainId: Number(row.chain_id),
    factoryAddress: row.factory_address as Address,
    seriesId: row.series_id as Hex,
    strikePrice: String(row.strike_price),
    maturityTimestamp: String(row.maturity_timestamp),
    stableToken: row.stable_token as Address,
    upToken: row.up_token as Address,
    mode: row.mode as MarketMode,
    collateralSymbol: String(row.collateral_symbol),
    collateralAddress: (row.collateral_address as Address | null) ?? null,
    createdBlock: String(row.created_block),
    createdTx: row.created_tx as Hex,
    createdLogIndex: Number(row.created_log_index),
    settled: Boolean(row.settled),
    oraclePrice: row.oracle_price == null ? null : String(row.oracle_price),
    stablePayout: row.stable_payout == null ? null : String(row.stable_payout),
    upPayout: row.up_payout == null ? null : String(row.up_payout),
    settledBlock: row.settled_block == null ? null : String(row.settled_block),
    settledTx: (row.settled_tx as Hex | null) ?? null,
    settledLogIndex: row.settled_log_index == null ? null : Number(row.settled_log_index),
  };
}

function rowToListing(row: Record<string, unknown>): ListingRow {
  const maturityTimestamp = row.series_maturity_timestamp == null ? String(row.maturity_timestamp) : String(row.series_maturity_timestamp);
  const settled = row.series_settled == null ? null : Boolean(row.series_settled);
  const isMatured = BigInt(maturityTimestamp) <= BigInt(Math.floor(Date.now() / 1000));
  return {
    id: String(row.id),
    chainId: Number(row.chain_id),
    engineAddress: row.engine_address as Address,
    listingId: String(row.listing_id),
    mode: row.mode as MarketMode,
    seriesId: (row.series_id as Hex | null) ?? null,
    factoryAddress: (row.factory_address as Address | null) ?? null,
    seller: row.seller as Address,
    token: row.token as Address,
    tokenSide: row.token_side as ListingRow["tokenSide"],
    quoteToken: row.quote_token as Address,
    strikePrice: String(row.strike_price),
    maturityTimestamp,
    active: Boolean(row.active),
    fillAttemptCount: Number(row.fill_attempt_count),
    lastBuyer: (row.last_buyer as Address | null) ?? null,
    createdBlock: String(row.created_block),
    createdTx: row.created_tx as Hex,
    createdLogIndex: Number(row.created_log_index),
    cancelledBlock: row.cancelled_block == null ? null : String(row.cancelled_block),
    cancelledTx: (row.cancelled_tx as Hex | null) ?? null,
    cancelledLogIndex: row.cancelled_log_index == null ? null : Number(row.cancelled_log_index),
    filledBlock: row.filled_block == null ? null : String(row.filled_block),
    filledTx: (row.filled_tx as Hex | null) ?? null,
    filledLogIndex: row.filled_log_index == null ? null : Number(row.filled_log_index),
    isMatured,
    settled,
    marketStatus: settled == null ? null : settled ? "settled" : "live",
    settlementPending: isMatured == null || settled == null ? null : isMatured && !settled,
    oraclePrice: row.series_oracle_price == null ? null : String(row.series_oracle_price),
    stablePayout: row.series_stable_payout == null ? null : String(row.series_stable_payout),
    upPayout: row.series_up_payout == null ? null : String(row.series_up_payout),
    settledBlock: row.series_settled_block == null ? null : String(row.series_settled_block),
    settledTx: (row.series_settled_tx as Hex | null) ?? null,
  };
}

function rowToPosition(row: Record<string, unknown>): PublicPositionActivityRow {
  return {
    id: String(row.id),
    chainId: Number(row.chain_id),
    factoryAddress: row.factory_address as Address,
    userAddress: row.user_address as Address,
    seriesId: row.series_id as Hex,
    splitAmount: String(row.split_amount),
    mergeAmount: String(row.merge_amount),
    redeemedClaim: String(row.redeemed_claim),
    splitCount: Number(row.split_count),
    mergeCount: Number(row.merge_count),
    redeemedCount: Number(row.redeemed_count),
    lastBlock: String(row.last_block),
    lastTx: row.last_tx as Hex,
    lastLogIndex: Number(row.last_log_index),
  };
}

function rowToBridgeRequest(row: Record<string, unknown>): BridgeRequestRow {
  return {
    id: String(row.id),
    chainId: Number(row.chain_id),
    bridgeAddress: row.bridge_address as Address,
    requestId: String(row.request_id),
    userAddress: row.user_address as Address,
    strikePrice: String(row.strike_price),
    maturityTimestamp: String(row.maturity_timestamp),
    isStable: Boolean(row.is_stable),
    requestedAmount: String(row.requested_amount),
    burnedAmountHandle: row.burned_amount_handle as Hex,
    status: row.status as BridgeRequestStatus,
    finalizedAmount: row.finalized_amount == null ? null : String(row.finalized_amount),
    requestBlock: String(row.request_block),
    requestTx: row.request_tx as Hex,
    requestLogIndex: Number(row.request_log_index),
    finalizeBlock: row.finalize_block == null ? null : String(row.finalize_block),
    finalizeTx: (row.finalize_tx as Hex | null) ?? null,
    finalizeLogIndex: row.finalize_log_index == null ? null : Number(row.finalize_log_index),
    finalizeTxHash: (row.finalize_tx_hash as Hex | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
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

export class PgRepository implements Repository {
  private readonly pool: pg.Pool;
  private deployments: unknown = { chains: [] };

  constructor(private readonly config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async migrate(): Promise<void> {
    await runMigrations(this.config.databaseUrl);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

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
      await this.pool.query(
        `insert into chains(chain_id, name, rpc_url, confirmation_depth, c_weth_address)
         values($1, $2, $3, $4, $5)
         on conflict(chain_id) do update set
           name = excluded.name,
           rpc_url = excluded.rpc_url,
           confirmation_depth = excluded.confirmation_depth,
           c_weth_address = excluded.c_weth_address,
           updated_at = now()`,
        [chain.chainId, chain.name, chain.rpcUrl, chain.confirmationDepth, chain.cWethAddress ?? null],
      );

      for (const factory of chain.factories) {
        await this.pool.query(
          `insert into factories(id, chain_id, address, mode, collateral_symbol, collateral_address, start_block)
           values($1, $2, $3, $4, $5, $6, $7)
           on conflict(id) do update set
             mode = excluded.mode,
             collateral_symbol = excluded.collateral_symbol,
             collateral_address = excluded.collateral_address,
             start_block = excluded.start_block`,
          [
            factoryPrimaryKey(chain.chainId, factory.address),
            chain.chainId,
            normalizeAddress(factory.address),
            factory.mode,
            factory.collateralSymbol,
            factory.collateralAddress ? normalizeAddress(factory.collateralAddress) : null,
            factory.startBlock == null ? null : bigintText(factory.startBlock),
          ],
        );
      }

      for (const engine of chain.matchingEngines) {
        await this.pool.query(
          `insert into matching_engines(id, chain_id, address, mode, factory_address, c_weth_address, start_block)
           values($1, $2, $3, $4, $5, $6, $7)
           on conflict(id) do update set
             mode = excluded.mode,
             factory_address = excluded.factory_address,
             c_weth_address = excluded.c_weth_address,
             start_block = excluded.start_block`,
          [
            enginePrimaryKey(chain.chainId, engine.address),
            chain.chainId,
            normalizeAddress(engine.address),
            engine.mode,
            engine.factoryAddress ? normalizeAddress(engine.factoryAddress) : null,
            engine.cWethAddress ? normalizeAddress(engine.cWethAddress) : null,
            engine.startBlock == null ? null : bigintText(engine.startBlock),
          ],
        );
      }

      for (const bridge of chain.bridges) {
        await this.pool.query(
          `insert into bridges(
            id, chain_id, address, public_factory, confidential_factory,
            start_block, keeper_enabled, min_confirmations_before_finalize
          ) values($1,$2,$3,$4,$5,$6,$7,$8)
          on conflict(id) do update set
            public_factory = excluded.public_factory,
            confidential_factory = excluded.confidential_factory,
            start_block = excluded.start_block,
            keeper_enabled = excluded.keeper_enabled,
            min_confirmations_before_finalize = excluded.min_confirmations_before_finalize,
            updated_at = now()`,
          [
            bridgePrimaryKey(chain.chainId, bridge.address),
            chain.chainId,
            normalizeAddress(bridge.address),
            normalizeAddress(bridge.publicFactory),
            normalizeAddress(bridge.confidentialFactory),
            bridge.startBlock == null ? null : bigintText(bridge.startBlock),
            bridge.keeperEnabled,
            bridge.minConfirmationsBeforeFinalize ?? null,
          ],
        );
      }
    }
  }

  async recordLogOnce(source: SourceRef, eventName: string): Promise<boolean> {
    const result = await this.pool.query(
      `insert into indexed_logs(chain_id, contract_address, block_number, tx_hash, log_index, event_name)
       values($1, $2, $3, $4, $5, $6)
       on conflict(chain_id, tx_hash, log_index) do nothing`,
      [
        source.chainId,
        normalizeAddress(source.contractAddress),
        bigintText(source.blockNumber),
        source.transactionHash.toLowerCase(),
        source.logIndex,
        eventName,
      ],
    );
    return result.rowCount === 1;
  }

  async upsertSeriesCreated(input: SeriesCreatedInput): Promise<void> {
    await this.pool.query(
      `insert into series(
        id, chain_id, factory_address, series_id, strike_price, maturity_timestamp,
        stable_token, up_token, mode, collateral_symbol, collateral_address,
        created_block, created_tx, created_log_index
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict(id) do update set
        stable_token = excluded.stable_token,
        up_token = excluded.up_token,
        updated_at = now()`,
      [
        seriesPrimaryKey(input.chainId, input.contractAddress, input.seriesId),
        input.chainId,
        normalizeAddress(input.contractAddress),
        input.seriesId.toLowerCase(),
        bigintText(input.strikePrice),
        bigintText(input.maturityTimestamp),
        normalizeAddress(input.stableToken),
        normalizeAddress(input.upToken),
        input.factory.mode,
        input.factory.collateralSymbol,
        input.factory.collateralAddress ? normalizeAddress(input.factory.collateralAddress) : null,
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async upsertSeriesSettled(input: SeriesSettledInput): Promise<void> {
    await this.pool.query(
      `update series set
        settled = true,
        oracle_price = $4,
        stable_payout = $5,
        up_payout = $6,
        settled_block = $7,
        settled_tx = $8,
        settled_log_index = $9,
        updated_at = now()
       where chain_id = $1 and factory_address = $2 and series_id = $3`,
      [
        input.chainId,
        normalizeAddress(input.contractAddress),
        input.seriesId.toLowerCase(),
        bigintText(input.oraclePrice),
        bigintText(input.stablePayout),
        bigintText(input.upPayout),
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async applyPublicPositionDelta(input: PublicPositionDeltaInput): Promise<void> {
    await this.pool.query(
      `insert into public_position_activity(
        id, chain_id, factory_address, user_address, series_id,
        split_amount, merge_amount, redeemed_claim,
        split_count, merge_count, redeemed_count,
        last_block, last_tx, last_log_index
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict(id) do update set
        split_amount = public_position_activity.split_amount + excluded.split_amount,
        merge_amount = public_position_activity.merge_amount + excluded.merge_amount,
        redeemed_claim = public_position_activity.redeemed_claim + excluded.redeemed_claim,
        split_count = public_position_activity.split_count + excluded.split_count,
        merge_count = public_position_activity.merge_count + excluded.merge_count,
        redeemed_count = public_position_activity.redeemed_count + excluded.redeemed_count,
        last_block = greatest(public_position_activity.last_block, excluded.last_block),
        last_tx = excluded.last_tx,
        last_log_index = excluded.last_log_index,
        updated_at = now()`,
      [
        positionActivityPrimaryKey(input.chainId, input.contractAddress, input.userAddress, input.seriesId),
        input.chainId,
        normalizeAddress(input.contractAddress),
        normalizeAddress(input.userAddress),
        input.seriesId.toLowerCase(),
        bigintText(input.splitAmount ?? 0n),
        bigintText(input.mergeAmount ?? 0n),
        bigintText(input.redeemedClaim ?? 0n),
        input.splitAmount ? 1 : 0,
        input.mergeAmount ? 1 : 0,
        input.redeemedClaim ? 1 : 0,
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async upsertListingCreated(input: ListingCreatedInput): Promise<void> {
    await this.pool.query(
      `insert into market_listings(
        id, chain_id, engine_address, listing_id, mode, series_id, factory_address,
        seller, token, token_side, quote_token, strike_price, maturity_timestamp,
        active, created_block, created_tx, created_log_index
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16)
      on conflict(id) do update set
        seller = excluded.seller,
        token = excluded.token,
        token_side = excluded.token_side,
        quote_token = excluded.quote_token,
        updated_at = now()`,
      [
        listingPrimaryKey(input.chainId, input.contractAddress, input.listingId),
        input.chainId,
        normalizeAddress(input.contractAddress),
        bigintText(input.listingId),
        input.engine.mode,
        input.seriesId?.toLowerCase() ?? null,
        input.factoryAddress ? normalizeAddress(input.factoryAddress) : null,
        normalizeAddress(input.seller),
        normalizeAddress(input.token),
        input.tokenSide,
        normalizeAddress(input.quoteToken),
        bigintText(input.strikePrice),
        bigintText(input.maturityTimestamp),
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async markListingFilled(input: ListingFillInput): Promise<void> {
    await this.pool.query(
      `update market_listings set
        active = false,
        fill_attempt_count = fill_attempt_count + 1,
        last_buyer = $4,
        filled_block = $5,
        filled_tx = $6,
        filled_log_index = $7,
        updated_at = now()
       where chain_id = $1 and engine_address = $2 and listing_id = $3`,
      [
        input.chainId,
        normalizeAddress(input.contractAddress),
        bigintText(input.listingId),
        normalizeAddress(input.buyer),
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async markListingCancelled(input: ListingCancelInput): Promise<void> {
    await this.pool.query(
      `update market_listings set
        active = false,
        cancelled_block = $4,
        cancelled_tx = $5,
        cancelled_log_index = $6,
        updated_at = now()
       where chain_id = $1 and engine_address = $2 and listing_id = $3`,
      [
        input.chainId,
        normalizeAddress(input.contractAddress),
        bigintText(input.listingId),
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async upsertUnshieldRequested(input: UnshieldRequestedInput): Promise<void> {
    await this.pool.query(
      `insert into bridge_requests(
        id, chain_id, bridge_address, request_id, user_address,
        strike_price, maturity_timestamp, is_stable, requested_amount, burned_amount_handle,
        status, request_block, request_tx, request_log_index
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'requested',$11,$12,$13)
      on conflict(id) do update set
        user_address = excluded.user_address,
        strike_price = excluded.strike_price,
        maturity_timestamp = excluded.maturity_timestamp,
        is_stable = excluded.is_stable,
        requested_amount = excluded.requested_amount,
        burned_amount_handle = excluded.burned_amount_handle,
        status = case
          when bridge_requests.status = 'finalized' then bridge_requests.status
          else excluded.status
        end,
        error = null,
        updated_at = now()`,
      [
        bridgeRequestPrimaryKey(input.chainId, input.contractAddress, input.requestId),
        input.chainId,
        normalizeAddress(input.contractAddress),
        bigintText(input.requestId),
        normalizeAddress(input.userAddress),
        bigintText(input.strikePrice),
        bigintText(input.maturityTimestamp),
        input.isStable,
        bigintText(input.requestedAmount),
        input.burnedAmountHandle.toLowerCase(),
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async markUnshieldFinalized(input: UnshieldFinalizedInput): Promise<void> {
    await this.pool.query(
      `update bridge_requests set
        status = 'finalized',
        finalized_amount = $4,
        finalize_block = $5,
        finalize_tx = $6,
        finalize_log_index = $7,
        error = null,
        updated_at = now()
       where chain_id = $1 and bridge_address = $2 and request_id = $3`,
      [
        input.chainId,
        normalizeAddress(input.contractAddress),
        bigintText(input.requestId),
        bigintText(input.amount),
        bigintText(input.blockNumber),
        input.transactionHash.toLowerCase(),
        input.logIndex,
      ],
    );
  }

  async updateBridgeRequestStatus(input: BridgeRequestStatusInput): Promise<void> {
    await this.pool.query(
      `update bridge_requests set
        status = $2,
        finalize_tx_hash = coalesce($3, finalize_tx_hash),
        error = $4,
        updated_at = now()
       where id = $1 and status <> 'finalized'`,
      [input.id, input.status, input.finalizeTxHash?.toLowerCase() ?? null, input.error ?? null],
    );
  }

  async getCursor(chainId: number, contractAddress: Address, eventGroup: EventGroup): Promise<bigint | null> {
    const result = await this.pool.query(
      `select last_indexed_block from indexer_cursors where chain_id = $1 and contract_address = $2 and event_group = $3`,
      [chainId, normalizeAddress(contractAddress), eventGroup],
    );
    return result.rows[0] ? BigInt(result.rows[0].last_indexed_block) : null;
  }

  async setCursor(chainId: number, contractAddress: Address, eventGroup: EventGroup, blockNumber: bigint): Promise<void> {
    await this.pool.query(
      `insert into indexer_cursors(chain_id, contract_address, event_group, last_indexed_block)
       values($1, $2, $3, $4)
       on conflict(chain_id, contract_address, event_group) do update set
         last_indexed_block = excluded.last_indexed_block,
         updated_at = now()`,
      [chainId, normalizeAddress(contractAddress), eventGroup, bigintText(blockNumber)],
    );
  }

  async getChains(): Promise<ChainStatusRow[]> {
    const result = await this.pool.query("select * from chains order by chain_id");
    return result.rows.map(rowToChain);
  }

  async updateChainHead(chainId: number, blockNumber: bigint): Promise<void> {
    await this.pool.query(
      "update chains set last_seen_block = $2, updated_at = now() where chain_id = $1",
      [chainId, bigintText(blockNumber)],
    );
  }

  async getDeployments(): Promise<unknown> {
    return this.deployments;
  }

  async listSeries(filters: SeriesFilters): Promise<SeriesRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      where.push(clause.replace("?", `$${values.length}`));
    };
    if (filters.chainId) add("chain_id = ?", filters.chainId);
    if (filters.factory) add("factory_address = ?", normalizeAddress(filters.factory));
    if (filters.mode) add("mode = ?", filters.mode);
    if (filters.strike) add("strike_price = ?", filters.strike);
    if (filters.maturityTimestamp) add("maturity_timestamp = ?", filters.maturityTimestamp);
    if (filters.settled !== undefined) add("settled = ?", filters.settled);
    const result = await this.pool.query(
      `select * from series ${where.length ? `where ${where.join(" and ")}` : ""} order by maturity_timestamp, strike_price, factory_address`,
      values,
    );
    return result.rows.map(rowToSeries);
  }

  async getSeries(id: string): Promise<SeriesRow | null> {
    const result = await this.pool.query("select * from series where id = $1", [id]);
    return result.rows[0] ? rowToSeries(result.rows[0]) : null;
  }

  async listSettlementCandidates(chainId: number, latestBlockTimestamp: bigint): Promise<SeriesRow[]> {
    const result = await this.pool.query(
      `select * from series
       where chain_id = $1
         and settled = false
         and maturity_timestamp <= $2
       order by maturity_timestamp, factory_address, series_id`,
      [chainId, bigintText(latestBlockTimestamp)],
    );
    return result.rows.map(rowToSeries);
  }

  async findSeriesByToken(chainId: number, token: Address): Promise<SeriesRow | null> {
    const result = await this.pool.query(
      "select * from series where chain_id = $1 and (stable_token = $2 or up_token = $2) limit 1",
      [chainId, normalizeAddress(token)],
    );
    return result.rows[0] ? rowToSeries(result.rows[0]) : null;
  }

  async listListings(filters: ListingFilters): Promise<ListingRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      where.push(clause.replace("?", `$${values.length}`));
    };
    if (filters.chainId) add("market_listings.chain_id = ?", filters.chainId);
    if (filters.seriesId) add("market_listings.series_id = ?", filters.seriesId.toLowerCase());
    if (filters.side) add("market_listings.token_side = ?", filters.side);
    if (filters.mode) add("market_listings.mode = ?", filters.mode);
    if (filters.active !== undefined) add("market_listings.active = ?", filters.active);
    if (filters.seller) add("market_listings.seller = ?", normalizeAddress(filters.seller));
    if (filters.settled !== undefined) add("s.settled = ?", filters.settled);
    const result = await this.pool.query(
      `select
        market_listings.*,
        s.maturity_timestamp as series_maturity_timestamp,
        s.settled as series_settled,
        s.oracle_price as series_oracle_price,
        s.stable_payout as series_stable_payout,
        s.up_payout as series_up_payout,
        s.settled_block as series_settled_block,
        s.settled_tx as series_settled_tx
       from market_listings
       left join lateral (
         select *
         from series
         where series.chain_id = market_listings.chain_id
           and (
             (
               market_listings.factory_address is not null
               and series.factory_address = market_listings.factory_address
               and series.series_id = market_listings.series_id
             )
             or series.stable_token = market_listings.token
             or series.up_token = market_listings.token
           )
         limit 1
       ) s on true
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by created_block desc, created_log_index desc`,
      values,
    );
    return result.rows.map(rowToListing);
  }

  async getListing(id: string): Promise<ListingRow | null> {
    const result = await this.pool.query(
      `select
        market_listings.*,
        s.maturity_timestamp as series_maturity_timestamp,
        s.settled as series_settled,
        s.oracle_price as series_oracle_price,
        s.stable_payout as series_stable_payout,
        s.up_payout as series_up_payout,
        s.settled_block as series_settled_block,
        s.settled_tx as series_settled_tx
       from market_listings
       left join lateral (
         select *
         from series
         where series.chain_id = market_listings.chain_id
           and (
             (
               market_listings.factory_address is not null
               and series.factory_address = market_listings.factory_address
               and series.series_id = market_listings.series_id
             )
             or series.stable_token = market_listings.token
             or series.up_token = market_listings.token
           )
         limit 1
       ) s on true
       where market_listings.id = $1`,
      [id],
    );
    return result.rows[0] ? rowToListing(result.rows[0]) : null;
  }

  async listUserListings(address: Address, chainId?: number, mode?: MarketMode, settled?: boolean): Promise<ListingRow[]> {
    return this.listListings({ seller: normalizeAddress(address), chainId, mode, settled });
  }

  async listPublicPositionActivity(address: Address, chainId?: number, factory?: Address): Promise<PublicPositionActivityRow[]> {
    const where = ["user_address = $1"];
    const values: unknown[] = [normalizeAddress(address)];
    if (chainId) {
      values.push(chainId);
      where.push(`chain_id = $${values.length}`);
    }
    if (factory) {
      values.push(normalizeAddress(factory));
      where.push(`factory_address = $${values.length}`);
    }
    const result = await this.pool.query(
      `select * from public_position_activity where ${where.join(" and ")} order by last_block desc`,
      values,
    );
    return result.rows.map(rowToPosition);
  }

  async listBridgeRequests(filters: BridgeRequestFilters): Promise<BridgeRequestRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      where.push(clause.replace("?", `$${values.length}`));
    };
    if (filters.chainId) add("chain_id = ?", filters.chainId);
    if (filters.bridge) add("bridge_address = ?", normalizeAddress(filters.bridge));
    if (filters.user) add("user_address = ?", normalizeAddress(filters.user));
    if (filters.status) add("status = ?", filters.status);
    const result = await this.pool.query(
      `select * from bridge_requests ${where.length ? `where ${where.join(" and ")}` : ""} order by request_block desc, request_log_index desc`,
      values,
    );
    return result.rows.map(rowToBridgeRequest);
  }

  async getBridgeRequest(id: string): Promise<BridgeRequestRow | null> {
    const result = await this.pool.query("select * from bridge_requests where id = $1", [id]);
    return result.rows[0] ? rowToBridgeRequest(result.rows[0]) : null;
  }

  async listKeeperReadyBridgeRequests(args: {
    chains: AppConfig["chains"];
    headByChain: Map<number, bigint>;
  }): Promise<KeeperBridgeRequest[]> {
    const rows: KeeperBridgeRequest[] = [];
    for (const chain of args.chains) {
      const head = args.headByChain.get(chain.chainId);
      if (head == null) continue;
      for (const bridge of chain.bridges) {
        if (!bridge.keeperEnabled || !bridge.keeperPrivateKey) continue;
        const minConfirmations = BigInt(bridge.minConfirmationsBeforeFinalize ?? chain.confirmationDepth);
        const maxRequestBlock = head > minConfirmations ? head - minConfirmations : 0n;
        const result = await this.pool.query(
          `select * from bridge_requests
           where chain_id = $1
             and bridge_address = $2
             and status in ('requested', 'failed')
             and request_block <= $3
           order by request_block, request_log_index
           limit 25`,
          [chain.chainId, normalizeAddress(bridge.address), bigintText(maxRequestBlock)],
        );
        for (const row of result.rows) {
          rows.push({ ...rowToBridgeRequest(row), bridge });
        }
      }
    }
    return rows;
  }

  async marketSummary(chainId?: number, seriesId?: Hex): Promise<{ seriesCount: number; listingCount: number; activeListingCount: number; fillAttemptCount: number }> {
    const values: unknown[] = [];
    const seriesWhere: string[] = [];
    const listingWhere: string[] = [];
    if (chainId) {
      values.push(chainId);
      seriesWhere.push(`chain_id = $${values.length}`);
      listingWhere.push(`chain_id = $${values.length}`);
    }
    if (seriesId) {
      values.push(seriesId.toLowerCase());
      seriesWhere.push(`series_id = $${values.length}`);
      listingWhere.push(`series_id = $${values.length}`);
    }
    const [series, listings] = await Promise.all([
      this.pool.query(`select count(*)::int as count from series ${seriesWhere.length ? `where ${seriesWhere.join(" and ")}` : ""}`, values),
      this.pool.query(
        `select count(*)::int as listing_count,
          coalesce(sum(case when active then 1 else 0 end), 0)::int as active_listing_count,
          coalesce(sum(fill_attempt_count), 0)::int as fill_attempt_count
         from market_listings ${listingWhere.length ? `where ${listingWhere.join(" and ")}` : ""}`,
        values,
      ),
    ]);
    return {
      seriesCount: Number(series.rows[0].count),
      listingCount: Number(listings.rows[0].listing_count),
      activeListingCount: Number(listings.rows[0].active_listing_count),
      fillAttemptCount: Number(listings.rows[0].fill_attempt_count),
    };
  }
}
