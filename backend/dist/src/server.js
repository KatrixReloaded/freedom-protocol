import http from "node:http";
import { getAddress } from "viem";
import { loadAbis } from "./config/abis.js";
import { loadDeploymentRegistry } from "./config/deployments.js";
import { loadEnv } from "./env.js";
import { openDb, seedDeployments } from "./db/client.js";
import { ChainClients } from "./services/chain.js";
import { listBridgeRequests, markBridgeRetryability, reserveFor } from "./services/readModels.js";
import { findSeries, parseSeriesKey, seedKnownSeries } from "./services/registry.js";
import { buildBridgeFinalize, buildBridgeUnshield } from "./tx/bridge.js";
import { buildConfidentialMerge, buildConfidentialRedeem, buildConfidentialSplit } from "./tx/confidential.js";
import { buildCancelListing, buildCreateListing, buildFillListing } from "./tx/matching.js";
import { buildOracleSettle } from "./tx/oracle.js";
import { buildPoolDeposit, buildPoolFill, buildPoolWithdraw } from "./tx/pools.js";
import { buildApproveCollateral, buildFundBridgeReserve, buildPublicMerge, buildPublicRedeem, buildPublicSplit } from "./tx/public.js";
import { openApiSpec } from "./openapi.js";
import { createWorker } from "./indexer/worker.js";
function jsonReplacer(_key, value) {
    return typeof value === "bigint" ? value.toString() : value;
}
async function parseBody(req) {
    if (!["POST", "PUT", "PATCH"].includes(req.method ?? ""))
        return undefined;
    const chunks = [];
    for await (const chunk of req)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.length === 0)
        return undefined;
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : undefined;
}
function send(res, status, payload) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload, jsonReplacer));
}
function route(pattern, path) {
    const pp = pattern.split("/").filter(Boolean);
    const ap = path.split("/").filter(Boolean);
    if (pp.length !== ap.length)
        return undefined;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(":"))
            params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
        else if (pp[i] !== ap[i])
            return undefined;
    }
    return params;
}
async function readOnChain(ctx, chainId, fn) {
    const client = ctx.chains.get(chainId);
    if (!client)
        return { available: false, reason: "rpc_not_configured" };
    return { available: true, value: await fn(client) };
}
function txCtx(ctx) {
    return { db: ctx.db, registry: ctx.registry, abis: ctx.abis };
}
const routes = [
    {
        method: "GET",
        pattern: "/health",
        handler: (ctx) => ({ ok: true, service: "freedom-backend", db: Boolean(ctx.db), uptime: process.uptime() })
    },
    { method: "GET", pattern: "/config", handler: (ctx) => ({ chains: ctx.registry.chains }) },
    { method: "GET", pattern: "/chains", handler: (ctx) => ctx.registry.chains.map((c) => ({ chainId: c.chainId, startBlock: c.startBlock, confirmations: c.confirmations })) },
    {
        method: "GET",
        pattern: "/chains/:chainId/deployments",
        handler: (ctx, req) => {
            const chain = ctx.registry.chain(Number(req.params.chainId));
            if (!chain)
                throw Object.assign(new Error("Unknown chain"), { statusCode: 404 });
            return chain;
        }
    },
    { method: "GET", pattern: "/abis", handler: (ctx) => ({ names: ctx.abis.names, abis: ctx.abis.all() }) },
    { method: "GET", pattern: "/openapi.json", handler: () => openApiSpec },
    {
        method: "GET",
        pattern: "/series",
        handler: (ctx, req) => {
            const filters = {
                chainId: req.query.get("chainId") ? Number(req.query.get("chainId")) : undefined,
                factory: req.query.get("factory") ?? undefined,
                mode: req.query.get("mode") ?? undefined
            };
            const clauses = [];
            const args = [];
            if (filters.chainId != null) {
                clauses.push("chain_id=?");
                args.push(filters.chainId);
            }
            if (filters.factory) {
                clauses.push("factory_address=?");
                args.push(getAddress(filters.factory));
            }
            if (filters.mode) {
                clauses.push("mode=?");
                args.push(filters.mode);
            }
            const sql = `SELECT * FROM series ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY maturity,strike`;
            return ctx.db.prepare(sql).all(...args);
        }
    },
    {
        method: "GET",
        pattern: "/series/:seriesKey",
        handler: (ctx, req) => {
            const series = findSeries(ctx.db, req.params.seriesKey);
            if (!series)
                throw Object.assign(new Error("Unknown series"), { statusCode: 404 });
            return series;
        }
    },
    {
        method: "GET",
        pattern: "/series/:seriesKey/tokens",
        handler: (ctx, req) => {
            const series = findSeries(ctx.db, req.params.seriesKey);
            if (!series)
                throw Object.assign(new Error("Unknown series"), { statusCode: 404 });
            return { stableToken: series.stableToken, upToken: series.upToken };
        }
    },
    {
        method: "GET",
        pattern: "/series/:seriesKey/settlement",
        handler: (ctx, req) => {
            const series = findSeries(ctx.db, req.params.seriesKey);
            if (!series)
                throw Object.assign(new Error("Unknown series"), { statusCode: 404 });
            return { settled: series.settled, stablePayout: series.stablePayout, upPayout: series.upPayout };
        }
    },
    {
        method: "GET",
        pattern: "/series/:seriesKey/reserves",
        handler: (ctx, req) => {
            const parsed = parseSeriesKey(req.params.seriesKey);
            return reserveFor(ctx.db, parsed.chainId, req.params.seriesKey);
        }
    },
    {
        method: "GET",
        pattern: "/series/:seriesKey/bridge-capacity",
        handler: (ctx, req) => {
            const parsed = parseSeriesKey(req.params.seriesKey);
            const reserve = reserveFor(ctx.db, parsed.chainId, req.params.seriesKey);
            return { bridgeMintable: reserve.bridge_capacity, source: "indexed" };
        }
    },
    { method: "POST", pattern: "/tx/public/approve-collateral", handler: (ctx, req) => buildApproveCollateral(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/public/split", handler: (ctx, req) => buildPublicSplit(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/public/merge", handler: (ctx, req) => buildPublicMerge(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/public/redeem", handler: (ctx, req) => buildPublicRedeem(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/public/fund-bridge-reserve", handler: (ctx, req) => buildFundBridgeReserve(txCtx(ctx), req.body) },
    {
        method: "GET",
        pattern: "/public/:chainId/factories/:factory/vault",
        handler: (ctx, req) => {
            const factory = ctx.registry.publicFactory(Number(req.params.chainId), req.params.factory);
            if (!factory)
                throw Object.assign(new Error("Unknown public factory"), { statusCode: 404 });
            return { vault: factory.vault, collateralToken: factory.collateralToken, mode: factory.mode };
        }
    },
    {
        method: "GET",
        pattern: "/public/:chainId/factories/:factory/flash-loans",
        handler: (ctx, req) => {
            const factory = ctx.registry.publicFactory(Number(req.params.chainId), req.params.factory);
            if (!factory)
                throw Object.assign(new Error("Unknown public factory"), { statusCode: 404 });
            return { vault: factory.vault, token: factory.collateralToken, feeBps: 5 };
        }
    },
    {
        method: "GET",
        pattern: "/public/:chainId/tokens/:token/balance",
        handler: async (ctx, req) => {
            const user = req.query.get("user");
            if (!user)
                throw Object.assign(new Error("Missing user"), { statusCode: 400 });
            return readOnChain(ctx, Number(req.params.chainId), (client) => client.readContract({ address: getAddress(req.params.token), abi: ctx.abis.get("IERC20"), functionName: "balanceOf", args: [getAddress(user)] }));
        }
    },
    {
        method: "GET",
        pattern: "/public/:chainId/collateral/:token/allowance",
        handler: async (ctx, req) => {
            const owner = req.query.get("owner");
            const spender = req.query.get("spender");
            if (!owner || !spender)
                throw Object.assign(new Error("Missing owner or spender"), { statusCode: 400 });
            return readOnChain(ctx, Number(req.params.chainId), (client) => client.readContract({
                address: getAddress(req.params.token),
                abi: ctx.abis.get("IERC20"),
                functionName: "allowance",
                args: [getAddress(owner), getAddress(spender)]
            }));
        }
    },
    { method: "POST", pattern: "/tx/confidential/split", handler: (ctx, req) => buildConfidentialSplit(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/confidential/merge", handler: (ctx, req) => buildConfidentialMerge(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/confidential/redeem", handler: (ctx, req) => buildConfidentialRedeem(txCtx(ctx), req.body) },
    {
        method: "GET",
        pattern: "/confidential/balance-handles",
        handler: async (ctx, req) => {
            const chainId = Number(req.query.get("chainId"));
            const token = req.query.get("token");
            const user = req.query.get("user");
            if (!chainId || !token || !user)
                throw Object.assign(new Error("Missing chainId, token, or user"), { statusCode: 400 });
            return readOnChain(ctx, chainId, (client) => client.readContract({ address: getAddress(token), abi: ctx.abis.get("OptionToken"), functionName: "balanceOf", args: [getAddress(user)] }));
        }
    },
    {
        method: "GET",
        pattern: "/confidential/allowance-handles",
        handler: async (ctx, req) => {
            const chainId = Number(req.query.get("chainId"));
            const token = req.query.get("token");
            const owner = req.query.get("owner");
            const spender = req.query.get("spender");
            if (!chainId || !token || !owner || !spender)
                throw Object.assign(new Error("Missing chainId, token, owner, or spender"), { statusCode: 400 });
            return readOnChain(ctx, chainId, (client) => client.readContract({
                address: getAddress(token),
                abi: ctx.abis.get("OptionToken"),
                functionName: "allowance",
                args: [getAddress(owner), getAddress(spender)]
            }));
        }
    },
    {
        method: "GET",
        pattern: "/bridge/requests",
        handler: (ctx, req) => listBridgeRequests(ctx.db, {
            chainId: req.query.get("chainId") ? Number(req.query.get("chainId")) : undefined,
            user: req.query.get("user") ?? undefined,
            seriesKey: req.query.get("seriesKey") ?? undefined,
            status: req.query.get("status") ?? undefined
        })
    },
    {
        method: "GET",
        pattern: "/bridge/requests/:requestKey",
        handler: (ctx, req) => {
            const row = ctx.db.prepare("SELECT * FROM bridge_requests WHERE request_key=?").get(req.params.requestKey);
            if (!row)
                throw Object.assign(new Error("Unknown bridge request"), { statusCode: 404 });
            return row;
        }
    },
    {
        method: "POST",
        pattern: "/bridge/requests/:requestKey/decryption-status",
        handler: (ctx, req) => {
            const actual = req.body?.actualBurnedAmount;
            const status = req.body?.status ?? "pending";
            ctx.db
                .prepare("UPDATE bridge_requests SET actual_burned_amount=COALESCE(?,actual_burned_amount),status=?,failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE request_key=?")
                .run(actual == null ? null : String(actual), status, req.body?.failureReason ?? null, req.params.requestKey);
            const row = ctx.db.prepare("SELECT * FROM bridge_requests WHERE request_key=?").get(req.params.requestKey);
            if (!row)
                throw Object.assign(new Error("Unknown bridge request"), { statusCode: 404 });
            if (req.body?.bridgeMintable != null)
                markBridgeRetryability(ctx.db, req.params.requestKey, BigInt(req.body.bridgeMintable));
            return row;
        }
    },
    { method: "POST", pattern: "/tx/bridge/unshield", handler: (ctx, req) => buildBridgeUnshield(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/bridge/finalize", handler: (ctx, req) => buildBridgeFinalize(txCtx(ctx), req.body) },
    {
        method: "GET",
        pattern: "/matching/listings",
        handler: (ctx, req) => {
            const clauses = [];
            const args = [];
            for (const [param, col] of [
                ["chainId", "chain_id"],
                ["token", "token"],
                ["quoteToken", "quote_token"],
                ["seller", "seller"],
                ["active", "active"]
            ]) {
                const value = req.query.get(param);
                if (value != null) {
                    clauses.push(`${col}=?`);
                    args.push(param === "active" ? (value === "true" ? 1 : 0) : param === "chainId" ? Number(value) : getAddress(value));
                }
            }
            return ctx.db.prepare(`SELECT * FROM matching_listings ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}`).all(...args);
        }
    },
    {
        method: "GET",
        pattern: "/matching/listings/:listingKey",
        handler: (ctx, req) => {
            const row = ctx.db.prepare("SELECT * FROM matching_listings WHERE listing_key=?").get(req.params.listingKey);
            if (!row)
                throw Object.assign(new Error("Unknown listing"), { statusCode: 404 });
            return row;
        }
    },
    { method: "POST", pattern: "/tx/matching/create-listing", handler: (ctx, req) => buildCreateListing(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/matching/fill", handler: (ctx, req) => buildFillListing(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/matching/cancel", handler: (ctx, req) => buildCancelListing(txCtx(ctx), req.body) },
    {
        method: "GET",
        pattern: "/pools",
        handler: (ctx, req) => {
            const clauses = [];
            const args = [];
            if (req.query.get("chainId")) {
                clauses.push("chain_id=?");
                args.push(Number(req.query.get("chainId")));
            }
            if (req.query.get("factory")) {
                clauses.push("factory_address=?");
                args.push(getAddress(req.query.get("factory")));
            }
            if (req.query.get("seriesKey")) {
                clauses.push("series_key=?");
                args.push(req.query.get("seriesKey"));
            }
            if (req.query.get("isStable")) {
                clauses.push("is_stable=?");
                args.push(req.query.get("isStable") === "true" ? 1 : 0);
            }
            return ctx.db.prepare(`SELECT * FROM pools ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}`).all(...args);
        }
    },
    {
        method: "GET",
        pattern: "/pools/:poolAddress",
        handler: (ctx, req) => {
            const row = ctx.db.prepare("SELECT * FROM pools WHERE pool_address=?").get(getAddress(req.params.poolAddress));
            if (!row)
                throw Object.assign(new Error("Unknown pool"), { statusCode: 404 });
            return row;
        }
    },
    { method: "POST", pattern: "/tx/pools/deposit", handler: (ctx, req) => buildPoolDeposit(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/pools/fill", handler: (ctx, req) => buildPoolFill(txCtx(ctx), req.body) },
    { method: "POST", pattern: "/tx/pools/withdraw", handler: (ctx, req) => buildPoolWithdraw(txCtx(ctx), req.body) },
    {
        method: "GET",
        pattern: "/oracle/settleable-series",
        handler: (ctx, req) => {
            const chainId = req.query.get("chainId") ? Number(req.query.get("chainId")) : undefined;
            const now = Math.floor(Date.now() / 1000);
            const clauses = ["settled=0", "CAST(maturity AS INTEGER)<=?"];
            const args = [now];
            if (chainId != null) {
                clauses.push("chain_id=?");
                args.push(chainId);
            }
            return ctx.db.prepare(`SELECT * FROM series WHERE ${clauses.join(" AND ")} ORDER BY maturity`).all(...args);
        }
    },
    { method: "POST", pattern: "/tx/oracle/settle", handler: (ctx, req) => buildOracleSettle(txCtx(ctx), req.body) }
];
export async function dispatch(ctx, method, pathWithQuery, body) {
    try {
        const url = new URL(pathWithQuery, "http://localhost");
        for (const candidate of routes) {
            if (candidate.method !== method)
                continue;
            const params = route(candidate.pattern, url.pathname);
            if (!params)
                continue;
            return {
                status: 200,
                body: await candidate.handler(ctx, { method, path: url.pathname, params, query: url.searchParams, body })
            };
        }
        return { status: 404, body: { error: "not_found" } };
    }
    catch (error) {
        return {
            status: Number(error?.statusCode ?? 500),
            body: { error: error?.message ?? "unexpected_error", details: error?.details }
        };
    }
}
export function createContext(overrides = {}) {
    const env = overrides.env ?? loadEnv();
    const registry = overrides.registry ?? loadDeploymentRegistry(env.deploymentsPath);
    const db = overrides.db ?? openDb(env.databaseUrl);
    const abis = overrides.abis ?? loadAbis(env.contractsOut);
    seedDeployments(db, registry.chains);
    seedKnownSeries(db, registry);
    return { env, db, registry, abis, chains: overrides.chains ?? new ChainClients(registry) };
}
export function createServer(ctx = createContext()) {
    return http.createServer(async (req, res) => {
        const result = await dispatch(ctx, req.method ?? "GET", req.url ?? "/", await parseBody(req));
        send(res, result.status, result.body);
    });
}
let worker;
if (import.meta.url === `file://${process.argv[1]}`) {
    const ctx = createContext();
    if (ctx.env.indexerEnabled) {
        worker = createWorker(ctx);
        void worker.start();
    }
    createServer(ctx).listen(ctx.env.port, ctx.env.host, () => {
        console.log(`Freedom backend listening on http://${ctx.env.host}:${ctx.env.port}`);
    });
}
process.on("SIGINT", async () => {
    await worker?.stop();
    process.exit(0);
});
