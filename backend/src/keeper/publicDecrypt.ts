import type { Hex } from "viem";
import type { FheConfig } from "../types.js";

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

export class UnconfiguredPublicDecryptService implements PublicDecryptService {
  async publicDecryptHandle(): Promise<PublicDecryptResult> {
    throw new Error("public decrypt unavailable / SDK not configured");
  }
}
