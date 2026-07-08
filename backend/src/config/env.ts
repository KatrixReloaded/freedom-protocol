import "dotenv/config";
import { z } from "zod";
import type { Address } from "viem";
import type { AppConfig, BridgeConfig, ChainConfig, FactoryConfig, MatchingEngineConfig } from "../types.js";
import { normalizeAddress } from "../keys.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const contractSchema = z.object({
  address: addressSchema,
  mode: z.enum(["public", "confidential"]),
  collateralSymbol: z.string().optional(),
  collateralAddress: addressSchema.optional(),
  oracleAdapter: addressSchema.optional(),
  factoryAddress: addressSchema.optional(),
  cWethAddress: addressSchema.optional(),
  startBlock: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
});

const bridgeSchema = z.object({
  address: addressSchema,
  publicFactory: addressSchema,
  confidentialFactory: addressSchema,
  startBlock: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  keeperEnabled: z.boolean().default(false),
  keeperPrivateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  minConfirmationsBeforeFinalize: z.number().int().nonnegative().optional(),
});

const fheConfigSchema = z.object({
  publicDecryptUrl: z.string().url().optional(),
  relayerUrl: z.string().url().optional(),
  gatewayUrl: z.string().url().optional(),
});

const chainSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().min(1),
  rpcUrl: z.string().min(1),
  confirmationDepth: z.number().int().nonnegative().default(12),
  cWethAddress: addressSchema.optional(),
  oracleAdapter: addressSchema.optional(),
  settlementKeeperEnabled: z.boolean().default(false),
  settlementKeeperPrivateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  settlementKeeperMinConfirmations: z.number().int().nonnegative().optional(),
  factories: z.array(contractSchema).default([]),
  matchingEngines: z.array(contractSchema).default([]),
  bridges: z.array(bridgeSchema).default([]),
  fheConfig: fheConfigSchema.optional(),
});

const chainsSchema = z.object({
  chains: z.array(chainSchema).default([]),
});

function bigintFrom(value: unknown, fallback: bigint): bigint {
  if (value === undefined || value === null || value === "") return fallback;
  return BigInt(String(value));
}

function parseChains(json: string | undefined): ChainConfig[] {
  if (!json) {
    return [
      {
        chainId: 31337,
        name: "local",
        rpcUrl: "http://127.0.0.1:8545",
        confirmationDepth: 1,
        settlementKeeperEnabled: false,
        factories: [],
        matchingEngines: [],
        bridges: [],
      },
      {
        chainId: 11155111,
        name: "sepolia",
        rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
        confirmationDepth: 12,
        cWethAddress: "0x46208622DA27d91db4f0393733C8BA082ed83158",
        oracleAdapter: "0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e",
        settlementKeeperEnabled: false,
        settlementKeeperMinConfirmations: 12,
        factories: [
          {
            address: "0x1c98aF677B9680c6A94dF4687bF454648A32e5e2",
            mode: "public",
            collateralSymbol: "WETH",
            collateralAddress: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
            oracleAdapter: "0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e",
            startBlock: 11228476n,
          },
          {
            address: "0xb1EB5165Bc03847C8789f9b06f121a5Da3ec387c",
            mode: "confidential",
            collateralSymbol: "cWETH",
            collateralAddress: "0x46208622DA27d91db4f0393733C8BA082ed83158",
            oracleAdapter: "0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e",
            startBlock: 11228476n,
          },
        ],
        matchingEngines: [
          {
            address: "0x4Ac50Eb419cE50dCa6940fF90bFa7DA42fA30Ca9",
            mode: "confidential",
            factoryAddress: "0xb1EB5165Bc03847C8789f9b06f121a5Da3ec387c",
            cWethAddress: "0x46208622DA27d91db4f0393733C8BA082ed83158",
            startBlock: 11228476n,
          },
        ],
        bridges: [
          {
            address: "0xea54b756D2586394029A2f4fBFAe024766E8aaf7",
            publicFactory: "0x1c98aF677B9680c6A94dF4687bF454648A32e5e2",
            confidentialFactory: "0xb1EB5165Bc03847C8789f9b06f121a5Da3ec387c",
            startBlock: 11228476n,
            keeperEnabled: false,
            minConfirmationsBeforeFinalize: 12,
          },
        ],
        fheConfig: { relayerUrl: "https://relayer.testnet.zama.org" },
      },
    ];
  }

  const parsed = chainsSchema.parse(JSON.parse(json));
  return parsed.chains.map((chain) => ({
    chainId: chain.chainId,
    name: chain.name,
    rpcUrl: chain.rpcUrl,
    confirmationDepth: chain.confirmationDepth,
    cWethAddress: chain.cWethAddress ? normalizeAddress(chain.cWethAddress as Address) : undefined,
    oracleAdapter: chain.oracleAdapter ? normalizeAddress(chain.oracleAdapter as Address) : undefined,
    settlementKeeperEnabled: chain.settlementKeeperEnabled,
    settlementKeeperPrivateKey: chain.settlementKeeperPrivateKey as ChainConfig["settlementKeeperPrivateKey"],
    settlementKeeperMinConfirmations: chain.settlementKeeperMinConfirmations,
    factories: chain.factories.map((factory): FactoryConfig => ({
      address: normalizeAddress(factory.address as Address),
      mode: factory.mode,
      collateralSymbol: factory.collateralSymbol ?? (factory.mode === "confidential" ? "cWETH" : "ETH"),
      collateralAddress: factory.collateralAddress ? normalizeAddress(factory.collateralAddress as Address) : undefined,
      oracleAdapter: factory.oracleAdapter ? normalizeAddress(factory.oracleAdapter as Address) : undefined,
      startBlock: factory.startBlock === undefined ? undefined : BigInt(factory.startBlock),
    })),
    matchingEngines: chain.matchingEngines.map((engine): MatchingEngineConfig => ({
      address: normalizeAddress(engine.address as Address),
      mode: engine.mode,
      factoryAddress: engine.factoryAddress ? normalizeAddress(engine.factoryAddress as Address) : undefined,
      cWethAddress: engine.cWethAddress ? normalizeAddress(engine.cWethAddress as Address) : undefined,
      startBlock: engine.startBlock === undefined ? undefined : BigInt(engine.startBlock),
    })),
    bridges: chain.bridges.map((bridge): BridgeConfig => ({
      address: normalizeAddress(bridge.address as Address),
      publicFactory: normalizeAddress(bridge.publicFactory as Address),
      confidentialFactory: normalizeAddress(bridge.confidentialFactory as Address),
      startBlock: bridge.startBlock === undefined ? undefined : BigInt(bridge.startBlock),
      keeperEnabled: bridge.keeperEnabled,
      keeperPrivateKey: bridge.keeperPrivateKey as BridgeConfig["keeperPrivateKey"],
      minConfirmationsBeforeFinalize: bridge.minConfirmationsBeforeFinalize,
    })),
    fheConfig: chain.fheConfig,
  }));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 4010),
    host: env.HOST ?? "127.0.0.1",
    databaseUrl: env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/freedom_market_indexer",
    pollIntervalMs: Number(env.INDEXER_POLL_INTERVAL_MS ?? 12_000),
    rewindBlocks: bigintFrom(env.INDEXER_REWIND_BLOCKS, 64n),
    maxBlockRange: bigintFrom(env.INDEXER_MAX_BLOCK_RANGE, 2_000n),
    keeperPollIntervalMs: Number(env.KEEPER_POLL_INTERVAL_MS ?? 15_000),
    settlementKeeperPollIntervalMs: Number(env.SETTLEMENT_KEEPER_POLL_INTERVAL_MS ?? 60_000),
    chains: parseChains(env.CHAINS_JSON),
  };
}
