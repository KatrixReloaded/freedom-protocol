import { decodeAbiParameters, parseAbiParameters, type Hex } from "viem";

export interface DecryptionInput {
  abiEncodedCleartexts: Hex;
  decryptionProof: Hex;
}

export function decodeActualBurned(input: DecryptionInput): string {
  const [actualBurned] = decodeAbiParameters(parseAbiParameters("uint64"), input.abiEncodedCleartexts);
  return actualBurned.toString();
}

export function hasKmsProof(input: Partial<DecryptionInput>): input is DecryptionInput {
  return Boolean(input.abiEncodedCleartexts && input.decryptionProof);
}

