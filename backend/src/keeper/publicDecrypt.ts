import type { Hex } from "viem";
import { createInstance, SepoliaConfig, type FhevmInstance } from "@zama-fhe/relayer-sdk/node";
import type { AppConfig, FheConfig } from "../types.js";

export interface PublicDecryptRequest {
  chainId: number;
  handle: Hex;
  type: "euint64";
  fheConfig?: FheConfig;
}

export interface PublicDecryptResult {
  clearValue: bigint;
  abiEncodedCleartexts: Hex;
  decryptionProof: Hex;
}

export interface PublicDecryptService {
  publicDecryptHandle(request: PublicDecryptRequest): Promise<PublicDecryptResult>;
}

type CreateZamaInstance = (config: Parameters<typeof createInstance>[0]) => Promise<Pick<FhevmInstance, "publicDecrypt">>;

function clearValueFromResult(clearValues: Record<string, unknown>, handle: Hex): bigint {
  const requestedHandle = handle.toLowerCase();
  const entry = Object.entries(clearValues).find(([candidate]) => candidate.toLowerCase() === requestedHandle);
  if (!entry) throw new Error("public decrypt result missing requested handle");

  const value = entry[1];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error("public decrypt result has unsupported euint64 clear value");
}

export class ZamaPublicDecryptService implements PublicDecryptService {
  private readonly instances = new Map<string, Promise<Pick<FhevmInstance, "publicDecrypt">>>();

  constructor(
    private readonly config: AppConfig,
    private readonly createZamaInstance: CreateZamaInstance = createInstance,
  ) {}

  async publicDecryptHandle(request: PublicDecryptRequest): Promise<PublicDecryptResult> {
    if (request.type !== "euint64") throw new Error(`unsupported public decrypt type: ${request.type}`);
    const instance = await this.instanceFor(request);
    const result = await instance.publicDecrypt([request.handle]);

    return {
      clearValue: clearValueFromResult(result.clearValues as Record<string, unknown>, request.handle),
      abiEncodedCleartexts: result.abiEncodedClearValues,
      decryptionProof: result.decryptionProof,
    };
  }

  private instanceFor(request: PublicDecryptRequest): Promise<Pick<FhevmInstance, "publicDecrypt">> {
    const chain = this.config.chains.find((candidate) => candidate.chainId === request.chainId);
    if (!chain) throw new Error(`chain ${request.chainId} not configured`);
    const relayerUrl = request.fheConfig?.relayerUrl;
    if (!relayerUrl) throw new Error("public decrypt unavailable / missing fheConfig.relayerUrl");
    if (request.chainId !== 11155111) throw new Error(`public decrypt unavailable for unsupported chain ${request.chainId}`);

    const cacheKey = `${chain.chainId}:${chain.rpcUrl}:${relayerUrl}`;
    let instance = this.instances.get(cacheKey);
    if (!instance) {
      instance = this.createZamaInstance({
        ...SepoliaConfig,
        chainId: chain.chainId,
        network: chain.rpcUrl,
        relayerUrl,
      });
      this.instances.set(cacheKey, instance);
    }
    return instance;
  }
}

export class UnconfiguredPublicDecryptService implements PublicDecryptService {
  async publicDecryptHandle(): Promise<PublicDecryptResult> {
    throw new Error("public decrypt unavailable / SDK not configured");
  }
}
