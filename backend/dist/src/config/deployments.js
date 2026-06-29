import fs from "node:fs";
import path from "node:path";
import { getAddress, isAddress, zeroAddress } from "viem";
import { loadEnv } from "../env.js";
function normalizeAddress(value, fallback = zeroAddress) {
    const raw = typeof value === "string" && value.length > 0 ? value : fallback;
    if (!isAddress(raw))
        throw new Error(`Invalid address ${String(raw)}`);
    return getAddress(raw);
}
function normalizePublicFactory(input) {
    return {
        mode: input.mode ?? (normalizeAddress(input.collateralToken) === zeroAddress ? "ETH" : "ERC20"),
        collateralToken: normalizeAddress(input.collateralToken),
        collateralSymbol: input.collateralSymbol,
        collateralDecimals: input.collateralDecimals,
        factory: normalizeAddress(input.factory),
        vault: normalizeAddress(input.vault)
    };
}
function normalizeConfidentialFactory(input) {
    return {
        mode: "cWETH",
        cWETH: normalizeAddress(input.cWETH),
        factory: normalizeAddress(input.factory),
        vault: normalizeAddress(input.vault)
    };
}
function normalizeChain(input) {
    const chainId = Number(input.chainId);
    if (!Number.isSafeInteger(chainId))
        throw new Error("Deployment missing chainId");
    return {
        chainId,
        rpcUrl: input.rpcUrl,
        rpcUrlEnv: input.rpcUrlEnv,
        startBlock: Number(input.startBlock ?? 0),
        confirmations: Number(input.confirmations ?? 3),
        oracle: input.oracle ? normalizeAddress(input.oracle) : undefined,
        publicFactories: (input.publicFactories ?? []).map(normalizePublicFactory),
        confidentialFactories: (input.confidentialFactories ?? []).map(normalizeConfidentialFactory),
        matchingEngine: input.matchingEngine ? normalizeAddress(input.matchingEngine) : undefined,
        seriesPoolImplementation: input.seriesPoolImplementation ? normalizeAddress(input.seriesPoolImplementation) : undefined,
        bridge: input.bridge ? normalizeAddress(input.bridge) : undefined,
        quoteTokens: input.quoteTokens,
        series: input.series ?? []
    };
}
function mergePartial(target, partial) {
    target.chainId ??= partial.chainId;
    target.oracle ??= partial.oracle;
    target.rpcUrl ??= partial.rpcUrl;
    target.rpcUrlEnv ??= partial.rpcUrlEnv;
    target.startBlock ??= partial.startBlock;
    target.confirmations ??= partial.confirmations;
    target.publicFactories ??= [];
    target.confidentialFactories ??= [];
    target.series ??= [];
    if (partial.publicFactories)
        target.publicFactories.push(...partial.publicFactories);
    if (partial.confidentialFactories)
        target.confidentialFactories.push(...partial.confidentialFactories);
    if (partial.factory && partial.collateralToken !== undefined) {
        target.publicFactories.push({
            mode: partial.mode ?? (partial.collateralToken === zeroAddress ? "ETH" : "ERC20"),
            collateralToken: partial.collateralToken,
            factory: partial.factory,
            vault: partial.vault
        });
    }
    if (partial.factory && partial.cWETH) {
        target.confidentialFactories.push({
            mode: "cWETH",
            cWETH: partial.cWETH,
            factory: partial.factory,
            vault: partial.vault
        });
    }
    if (partial.bridge)
        target.bridge = partial.bridge;
    if (partial.matchingEngine)
        target.matchingEngine = partial.matchingEngine;
    if (partial.seriesPoolImplementation)
        target.seriesPoolImplementation = partial.seriesPoolImplementation;
    if (partial.publicFactory)
        target.publicFactory = partial.publicFactory;
    if (partial.confidentialFactory)
        target.confidentialFactory = partial.confidentialFactory;
    if (partial.strike && partial.maturity && partial.factory)
        target.series.push(partial);
    if (partial.quoteTokens)
        target.quoteTokens = { ...(target.quoteTokens ?? {}), ...partial.quoteTokens };
    return target;
}
export class DeploymentRegistry {
    chains;
    constructor(chains) {
        this.chains = chains;
    }
    chain(chainId) {
        return this.chains.find((c) => c.chainId === chainId);
    }
    publicFactory(chainId, factory) {
        const normalized = normalizeAddress(factory);
        return this.chain(chainId)?.publicFactories.find((f) => f.factory === normalized);
    }
    confidentialFactory(chainId, factory) {
        const normalized = normalizeAddress(factory);
        return this.chain(chainId)?.confidentialFactories.find((f) => f.factory === normalized);
    }
    factory(chainId, factory) {
        return this.publicFactory(chainId, factory) ?? this.confidentialFactory(chainId, factory);
    }
}
export function loadDeploymentRegistry(deploymentsPath = loadEnv().deploymentsPath) {
    if (!fs.existsSync(deploymentsPath))
        return new DeploymentRegistry([]);
    const files = fs.statSync(deploymentsPath).isDirectory()
        ? fs.readdirSync(deploymentsPath).filter((f) => f.endsWith(".json")).map((f) => path.join(deploymentsPath, f))
        : [deploymentsPath];
    const partialsByChain = new Map();
    for (const file of files) {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        const entries = raw.chainId ? [raw] : Object.values(raw);
        for (const entry of entries) {
            if (!entry || typeof entry !== "object")
                continue;
            const chainId = Number(entry.chainId);
            if (!Number.isSafeInteger(chainId))
                continue;
            partialsByChain.set(chainId, mergePartial(partialsByChain.get(chainId) ?? {}, entry));
        }
    }
    return new DeploymentRegistry([...partialsByChain.values()].map(normalizeChain));
}
