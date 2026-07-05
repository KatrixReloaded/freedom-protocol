import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { shieldBridgeAbi } from "../abi/contracts.js";
import type { AppConfig } from "../types.js";

export interface FinalizeUnshieldInput {
  chainId: number;
  bridgeAddress: Address;
  requestId: bigint;
  abiEncodedCleartexts: Hex;
  decryptionProof: Hex;
  privateKey: Hex;
}

export interface BridgeFinalizeClient {
  getBlockNumber(chainId: number): Promise<bigint>;
  finalizeUnshield(input: FinalizeUnshieldInput): Promise<Hex>;
}

export class ViemBridgeFinalizeClient implements BridgeFinalizeClient {
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

  async getBlockNumber(chainId: number): Promise<bigint> {
    const chain = this.chainFor(chainId);
    const client = createPublicClient({ chain: this.viemChain(chainId), transport: http(chain.rpcUrl) });
    return client.getBlockNumber();
  }

  async finalizeUnshield(input: FinalizeUnshieldInput): Promise<Hex> {
    const chain = this.chainFor(input.chainId);
    const account = privateKeyToAccount(input.privateKey);
    const client = createWalletClient({
      account,
      chain: this.viemChain(input.chainId),
      transport: http(chain.rpcUrl),
    });
    return client.writeContract({
      address: input.bridgeAddress,
      abi: shieldBridgeAbi,
      functionName: "finalizeUnshield",
      args: [input.requestId, input.abiEncodedCleartexts, input.decryptionProof],
    });
  }
}
