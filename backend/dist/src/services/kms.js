import { decodeAbiParameters, parseAbiParameters } from "viem";
export function decodeActualBurned(input) {
    const [actualBurned] = decodeAbiParameters(parseAbiParameters("uint64"), input.abiEncodedCleartexts);
    return actualBurned.toString();
}
export function hasKmsProof(input) {
    return Boolean(input.abiEncodedCleartexts && input.decryptionProof);
}
