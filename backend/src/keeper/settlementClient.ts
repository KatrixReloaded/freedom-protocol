import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainlinkOracleAdapterAbi, optionFactoryReadAbi } from "../abi/contracts.js";
import type { AppConfig, MarketMode } from "../types.js";

export interface LatestBlockInfo {
  number: bigint;
  timestamp: bigint;
}

export interface FactorySeriesState {
  exists: boolean;
  settled: boolean;
  maturityTimestamp: bigint;
}

export interface SettleSeriesInput {
  chainId: number;
  mode: MarketMode;
  oracleAdapter: Address;
  factoryAddress: Address;
  strikePrice: bigint;
  maturityTimestamp: bigint;
  privateKey: Hex;
}

export interface SettlementClient {
  getLatestBlock(chainId: number): Promise<LatestBlockInfo>;
  readFactorySeries(args: {
    chainId: number;
    factoryAddress: Address;
    strikePrice: bigint;
    maturityTimestamp: bigint;
  }): Promise<FactorySeriesState>;
  settleSeries(input: SettleSeriesInput): Promise<Hex>;
}

export class ViemSettlementClient implements SettlementClient {
  constructor(private readonly config: AppConfig) {}

  private chainFor(chainId: number): AppConfig["chains"][number] {
    const chain = this.config.chains.find((candidate) => candidate.chainId === chainId);
    if (!chain) throw new Error(`chain ${chainId} not configured`);
    return chain;
  }

  private viemChain(chainId: number): Chain {
    const chain = this.chainFor(chainId);
    return {
      id: chain.chainId,
      name: chain.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    };
  }

  async getLatestBlock(chainId: number): Promise<LatestBlockInfo> {
    const chain = this.chainFor(chainId);
    const client = createPublicClient({ chain: this.viemChain(chainId), transport: http(chain.rpcUrl) });
    const block = await client.getBlock({ blockTag: "latest" });
    return { number: block.number, timestamp: block.timestamp };
  }

  async readFactorySeries(args: {
    chainId: number;
    factoryAddress: Address;
    strikePrice: bigint;
    maturityTimestamp: bigint;
  }): Promise<FactorySeriesState> {
    const chain = this.chainFor(args.chainId);
    const client = createPublicClient({ chain: this.viemChain(args.chainId), transport: http(chain.rpcUrl) });
    const series = await client.readContract({
      address: args.factoryAddress,
      abi: optionFactoryReadAbi,
      functionName: "getSeries",
      args: [args.strikePrice, args.maturityTimestamp],
    });
    return {
      exists: Boolean(series.exists),
      settled: Boolean(series.settled),
      maturityTimestamp: BigInt(series.maturityTimestamp),
    };
  }

  async settleSeries(input: SettleSeriesInput): Promise<Hex> {
    const chain = this.chainFor(input.chainId);
    const account = privateKeyToAccount(input.privateKey);
    const client = createWalletClient({
      account,
      chain: this.viemChain(input.chainId),
      transport: http(chain.rpcUrl),
    });
    return client.writeContract({
      address: input.oracleAdapter,
      abi: chainlinkOracleAdapterAbi,
      functionName: input.mode === "public" ? "settlePublic" : "settleConfidential",
      args: [input.factoryAddress, input.strikePrice, input.maturityTimestamp],
    });
  }
}
