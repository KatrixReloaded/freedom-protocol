import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { erc20Abi } from "../abi/contracts.js";
import type { AppConfig, BridgeRequestFilters, ChainConfig, ListingFilters, SeriesFilters } from "../types.js";
import type { Repository } from "../db/repository.js";
import { normalizeAddress } from "../keys.js";

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  return Number(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return undefined;
}

function optionalAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return normalizeAddress(value as Address);
}

function makeClients(chains: ChainConfig[]): Map<number, PublicClient> {
  return new Map(chains.map((chain) => [chain.chainId, createPublicClient({ transport: http(chain.rpcUrl) })]));
}

function configuredListingEngines(config: AppConfig, chainId?: number, mode?: ListingFilters["mode"]): Address[] {
  const addresses = new Set<Address>();
  for (const chain of config.chains) {
    if (chainId !== undefined && chain.chainId !== chainId) continue;
    for (const engine of chain.matchingEngines) {
      if (mode && engine.mode !== mode) continue;
      addresses.add(normalizeAddress(engine.address));
    }
  }
  return [...addresses];
}

function withSeriesStatus<T extends { maturityTimestamp: string; settled: boolean }>(series: T) {
  const active = BigInt(series.maturityTimestamp) > BigInt(Math.floor(Date.now() / 1000)) && !series.settled;
  return {
    ...series,
    active,
    marketStatus: series.settled ? "settled" : active ? "active" : "matured",
  };
}

export function createServer(config: AppConfig, repository: Repository): FastifyInstance {
  const app = Fastify({ logger: true, routerOptions: { maxParamLength: 256 } });
  const clients = makeClients(config.chains);

  void app.register(cors, { origin: true });

  app.get("/health", async () => ({
    ok: true,
    service: "freedom-market-indexer",
    privacy: {
      transactionRelay: false,
      transactionBuilders: false,
      keyCustody: false,
      confidentialDecryption: false,
    },
  }));

  app.get("/chains", async () => repository.getChains());
  app.get("/deployments", async () => repository.getDeployments());

  app.get<{ Querystring: Record<string, string> }>("/series", async (request) => {
    const filters: SeriesFilters = {
      chainId: optionalNumber(request.query.chainId),
      factory: optionalAddress(request.query.factory),
      mode: request.query.mode as SeriesFilters["mode"],
      strike: request.query.strike,
      maturityTimestamp: request.query.maturityTimestamp,
      settled: optionalBoolean(request.query.settled),
      status: request.query.status === "active" ? "active" : undefined,
    };
    const series = await repository.listSeries(filters);
    return series.map(withSeriesStatus);
  });

  app.get<{ Params: { id: string } }>("/series/:id", async (request, reply) => {
    const series = await repository.getSeries(request.params.id);
    if (!series) return reply.code(404).send({ error: "series not found" });
    return series;
  });

  app.get<{ Querystring: Record<string, string> }>("/markets/listings", async (request) => {
    const chainId = optionalNumber(request.query.chainId);
    const mode = request.query.mode as ListingFilters["mode"];
    const engineAddress = optionalAddress(request.query.engineAddress);
    const filters: ListingFilters = {
      chainId,
      seriesId: request.query.seriesId as ListingFilters["seriesId"],
      side: request.query.side as ListingFilters["side"],
      mode,
      active: optionalBoolean(request.query.active),
      seller: optionalAddress(request.query.seller),
      settled: optionalBoolean(request.query.settled),
      engineAddress,
      engineAddresses: engineAddress ? undefined : configuredListingEngines(config, chainId, mode),
    };
    return repository.listListings(filters);
  });

  app.get<{ Params: { id: string } }>("/markets/listings/:id", async (request, reply) => {
    const listing = await repository.getListing(request.params.id);
    if (!listing) return reply.code(404).send({ error: "listing not found" });
    return listing;
  });

  app.get<{ Params: { address: string }; Querystring: Record<string, string> }>(
    "/markets/user/:address/listings",
    async (request) => {
      return repository.listUserListings(
        normalizeAddress(request.params.address as Address),
        optionalNumber(request.query.chainId),
        request.query.mode as ListingFilters["mode"],
        optionalBoolean(request.query.settled),
      );
    },
  );

  app.get<{ Params: { address: string }; Querystring: Record<string, string> }>(
    "/positions/public/:address",
    async (request) => {
      const address = normalizeAddress(request.params.address as Address);
      const chainId = optionalNumber(request.query.chainId);
      const factory = optionalAddress(request.query.factory);
      const activity = await repository.listPublicPositionActivity(address, chainId, factory);
      const series = await repository.listSeries({ chainId, factory, mode: "public" });

      const liveBalances = [];
      for (const row of series) {
        const client = clients.get(row.chainId);
        if (!client) continue;
        try {
          const blockNumber = await client.getBlockNumber();
          const [stableBalance, upBalance] = await Promise.all([
            client.readContract({
              address: row.stableToken,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
              blockNumber,
            }),
            client.readContract({
              address: row.upToken,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
              blockNumber,
            }),
          ]);
          liveBalances.push({
            seriesId: row.seriesId,
            seriesKey: row.id,
            chainId: row.chainId,
            factoryAddress: row.factoryAddress,
            stableToken: row.stableToken,
            upToken: row.upToken,
            stableBalance: stableBalance.toString(),
            upBalance: upBalance.toString(),
            blockNumber: blockNumber.toString(),
            source: "erc20.balanceOf",
          });
        } catch (error) {
          liveBalances.push({
            seriesId: row.seriesId,
            seriesKey: row.id,
            chainId: row.chainId,
            factoryAddress: row.factoryAddress,
            stableToken: row.stableToken,
            upToken: row.upToken,
            error: error instanceof Error ? error.message : "balance read failed",
            source: "erc20.balanceOf",
          });
        }
      }

      return {
        address,
        chainId: chainId ?? null,
        factory: factory ?? null,
        eventDerivedActivity: activity,
        liveBalances,
        limitations: {
          eventDerivedActivity:
            "Split/Merge/Redeemed activity is not a complete position balance when tokens transfer outside indexed factory events.",
          liveBalances:
            "Live balances are direct ERC20 balanceOf reads for public option tokens discovered from SeriesCreated.",
          confidential:
            "Confidential balances are not tracked, posted, decrypted, or inferred by this service.",
        },
      };
    },
  );

  app.get<{ Querystring: Record<string, string> }>("/markets/summary", async (request) => {
    return repository.marketSummary(optionalNumber(request.query.chainId), request.query.seriesId as ListingFilters["seriesId"]);
  });

  app.get<{ Querystring: Record<string, string> }>("/bridges/requests", async (request) => {
    const filters: BridgeRequestFilters = {
      chainId: optionalNumber(request.query.chainId),
      bridge: optionalAddress(request.query.bridge),
      user: optionalAddress(request.query.user),
      status: request.query.status as BridgeRequestFilters["status"],
    };
    return repository.listBridgeRequests(filters);
  });

  app.get<{ Params: { id: string } }>("/bridges/requests/:id", async (request, reply) => {
    const bridgeRequest = await repository.getBridgeRequest(request.params.id);
    if (!bridgeRequest) return reply.code(404).send({ error: "bridge request not found" });
    return bridgeRequest;
  });

  return app;
}
