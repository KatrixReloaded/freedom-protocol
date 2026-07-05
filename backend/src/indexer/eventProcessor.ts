import { decodeEventLog, type Address, type Hex } from "viem";
import { confidentialFactoryAbi, confidentialMatchingEngineAbi, publicFactoryAbi, shieldBridgeAbi } from "../abi/contracts.js";
import { deriveSeriesId, normalizeAddress } from "../keys.js";
import type { BridgeConfig, FactoryConfig, MatchingEngineConfig, SourceRef, TokenSide } from "../types.js";
import type { Repository } from "../db/repository.js";

export interface IndexableLog {
  data: Hex;
  topics: readonly (Hex | Hex[] | null)[];
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
}

function sourceFromLog(chainId: number, contractAddress: Address, log: IndexableLog): SourceRef {
  if (log.blockNumber == null || log.transactionHash == null || log.logIndex == null) {
    throw new Error("Cannot index unmined log");
  }
  return {
    chainId,
    contractAddress: normalizeAddress(contractAddress),
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  };
}

function requireArgs<T extends Record<string, unknown>>(args: unknown): T {
  if (!args || typeof args !== "object") throw new Error("Decoded event missing args");
  return args as T;
}

function topicsForDecode(topics: IndexableLog["topics"]): [] | [Hex, ...Hex[]] {
  const flat = topics.filter((topic): topic is Hex => typeof topic === "string");
  if (flat.length === 0) return [];
  return flat as [Hex, ...Hex[]];
}

export class EventProcessor {
  constructor(private readonly repository: Repository) {}

  async processFactoryLog(chainId: number, factory: FactoryConfig, log: IndexableLog): Promise<void> {
    const source = sourceFromLog(chainId, factory.address, log);
    const abi = factory.mode === "public" ? publicFactoryAbi : confidentialFactoryAbi;
    let decoded: ReturnType<typeof decodeEventLog<typeof abi>>;
    try {
      decoded = decodeEventLog({ abi, data: log.data, topics: topicsForDecode(log.topics), strict: true });
    } catch {
      return;
    }
    const eventName = decoded.eventName;
    const isNew = await this.repository.recordLogOnce(source, eventName);
    if (!isNew) return;

    if (eventName === "SeriesCreated") {
      const args = requireArgs<{
        seriesId: Hex;
        strikePrice: bigint;
        maturityTimestamp: bigint;
        stableToken: Address;
        upToken: Address;
      }>(decoded.args);
      await this.repository.upsertSeriesCreated({
        ...source,
        seriesId: args.seriesId,
        strikePrice: args.strikePrice,
        maturityTimestamp: args.maturityTimestamp,
        stableToken: args.stableToken,
        upToken: args.upToken,
        factory,
      });
      return;
    }

    if (eventName === "Settled") {
      const args = requireArgs<{ seriesId: Hex; oraclePrice: bigint; stablePayout: bigint; upPayout: bigint }>(
        decoded.args,
      );
      await this.repository.upsertSeriesSettled({
        ...source,
        seriesId: args.seriesId,
        oraclePrice: args.oraclePrice,
        stablePayout: args.stablePayout,
        upPayout: args.upPayout,
      });
      return;
    }

    if (factory.mode !== "public") return;

    if (eventName === "Split") {
      const args = requireArgs<{ user: Address; seriesId: Hex; amount: bigint }>(decoded.args);
      await this.repository.applyPublicPositionDelta({
        ...source,
        userAddress: args.user,
        seriesId: args.seriesId,
        splitAmount: args.amount,
      });
      return;
    }

    if (eventName === "Merge") {
      const args = requireArgs<{ user: Address; seriesId: Hex; amount: bigint }>(decoded.args);
      await this.repository.applyPublicPositionDelta({
        ...source,
        userAddress: args.user,
        seriesId: args.seriesId,
        mergeAmount: args.amount,
      });
      return;
    }

    if (eventName === "Redeemed") {
      const args = requireArgs<{ user: Address; seriesId: Hex; claim: bigint }>(decoded.args);
      await this.repository.applyPublicPositionDelta({
        ...source,
        userAddress: args.user,
        seriesId: args.seriesId,
        redeemedClaim: args.claim,
      });
    }
  }

  async processMatchingEngineLog(chainId: number, engine: MatchingEngineConfig, log: IndexableLog): Promise<void> {
    const source = sourceFromLog(chainId, engine.address, log);
    let decoded: ReturnType<typeof decodeEventLog<typeof confidentialMatchingEngineAbi>>;
    try {
      decoded = decodeEventLog({
        abi: confidentialMatchingEngineAbi,
        data: log.data,
        topics: topicsForDecode(log.topics),
        strict: true,
      });
    } catch {
      return;
    }
    const eventName = decoded.eventName;
    const isNew = await this.repository.recordLogOnce(source, eventName);
    if (!isNew) return;

    if (eventName === "ListingCreated") {
      const args = requireArgs<{
        listingId: bigint;
        seller: Address;
        token: Address;
        quoteToken: Address;
        strikePrice: bigint;
        maturityTimestamp: bigint;
      }>(decoded.args);
      const knownSeries = await this.repository.findSeriesByToken(chainId, args.token);
      const tokenSide: TokenSide =
        knownSeries?.stableToken === normalizeAddress(args.token)
          ? "P"
          : knownSeries?.upToken === normalizeAddress(args.token)
            ? "N"
            : "unknown";
      await this.repository.upsertListingCreated({
        ...source,
        listingId: args.listingId,
        seller: args.seller,
        token: args.token,
        quoteToken: args.quoteToken,
        strikePrice: args.strikePrice,
        maturityTimestamp: args.maturityTimestamp,
        engine,
        seriesId: knownSeries?.seriesId ?? deriveSeriesId(args.strikePrice, args.maturityTimestamp),
        factoryAddress: knownSeries?.factoryAddress ?? engine.factoryAddress ?? null,
        tokenSide,
      });
      return;
    }

    if (eventName === "FillAttempted") {
      const args = requireArgs<{ listingId: bigint; buyer: Address }>(decoded.args);
      await this.repository.markListingFilled({ ...source, listingId: args.listingId, buyer: args.buyer });
      return;
    }

    if (eventName === "ListingCancelled") {
      const args = requireArgs<{ listingId: bigint }>(decoded.args);
      await this.repository.markListingCancelled({ ...source, listingId: args.listingId });
    }
  }

  async processBridgeLog(chainId: number, bridge: BridgeConfig, log: IndexableLog): Promise<void> {
    const source = sourceFromLog(chainId, bridge.address, log);
    let decoded: ReturnType<typeof decodeEventLog<typeof shieldBridgeAbi>>;
    try {
      decoded = decodeEventLog({
        abi: shieldBridgeAbi,
        data: log.data,
        topics: topicsForDecode(log.topics),
        strict: true,
      });
    } catch {
      return;
    }
    const eventName = decoded.eventName;
    const isNew = await this.repository.recordLogOnce(source, eventName);
    if (!isNew) return;

    if (eventName === "UnshieldRequested") {
      const args = requireArgs<{
        requestId: bigint;
        user: Address;
        strikePrice: bigint;
        maturityTimestamp: bigint;
        isStable: boolean;
        requestedAmount: bigint;
        burnedAmountHandle: Hex;
      }>(decoded.args);
      await this.repository.upsertUnshieldRequested({
        ...source,
        requestId: args.requestId,
        userAddress: args.user,
        strikePrice: args.strikePrice,
        maturityTimestamp: args.maturityTimestamp,
        isStable: args.isStable,
        requestedAmount: args.requestedAmount,
        burnedAmountHandle: args.burnedAmountHandle,
      });
      return;
    }

    if (eventName === "UnshieldFinalized") {
      const args = requireArgs<{
        requestId: bigint;
        user: Address;
        strikePrice: bigint;
        maturityTimestamp: bigint;
        isStable: boolean;
        amount: bigint;
      }>(decoded.args);
      await this.repository.markUnshieldFinalized({
        ...source,
        requestId: args.requestId,
        userAddress: args.user,
        strikePrice: args.strikePrice,
        maturityTimestamp: args.maturityTimestamp,
        isStable: args.isStable,
        amount: args.amount,
      });
    }
  }
}
