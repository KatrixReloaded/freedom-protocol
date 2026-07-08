import { ZAMA_SEPOLIA_GATEWAY_ID, ZAMA_SEPOLIA_RELAYER_URL, SEPOLIA_CHAIN_ID } from "./config.js";
import { isAddress } from "./abi.js";

const DEFAULT_SDK_URL = "https://esm.sh/@zama-fhe/relayer-sdk@0.5.0-alpha.2/web?bundle";
const LEGACY_SDK_URL = "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.js";
const ETHERS_URL = "https://esm.sh/ethers@6.17.0?bundle";
const SEPOLIA_FHE_CONFIG = {
  aclContractAddress: "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
  kmsContractAddress: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
  inputVerifierContractAddress: "0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0",
  verifyingContractAddressDecryption: "0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478",
  verifyingContractAddressInputVerification: "0x483b9dE06E4E4C7D35CCf5837A1668487406D955",
  chainId: SEPOLIA_CHAIN_ID,
  gatewayChainId: ZAMA_SEPOLIA_GATEWAY_ID,
  relayerUrl: ZAMA_SEPOLIA_RELAYER_URL
};

let sdkPromise = null;
let instancePromise = null;
let instanceCacheKey = "";
let loadedSdkUrl = "";
let sdkLoadError = "";
let ethersPromise = null;

async function encryptAmount({ contractAddress, userAddress, value, fhe = {} }) {
  const targetAddress = await checksumAddress(contractAddress, "Encryption target contract");
  const accountAddress = await checksumAddress(userAddress, "User address");
  const amount = BigInt(value || 0);
  if (amount <= 0n) throw new Error("Enter amount.");
  if (amount > 2n ** 64n - 1n) throw new Error("Confidential amount exceeds euint64 range.");

  const instance = await getFheInstance(fhe);
  if (typeof instance.createEncryptedInput === "function") {
    const encrypted = await instance.createEncryptedInput(targetAddress, accountAddress).add64(amount).encrypt();
    return encryptedInputResult(encrypted);
  }
  if (typeof instance.encrypt === "function") {
    const encrypted = await instance.encrypt({
      contractAddress: targetAddress,
      userAddress: accountAddress,
      values: { type: "uint64", value: amount }
    });
    return encryptedInputResult(encrypted);
  }
  throw new Error("Loaded Zama SDK does not expose an encryption API.");
}

function encryptedInputResult(encrypted) {
  const handle =
    encrypted?.handles?.[0] ||
    encrypted?.externalEncryptedValue?.bytes32Hex ||
    encrypted?.externalEncryptedValues?.[0]?.bytes32Hex ||
    encrypted?.externalEncryptedValue ||
    encrypted?.externalEncryptedValues?.[0];
  const proof = encrypted?.inputProof || encrypted?.proof;
  return {
    handle: bytes32Hex(handle, "Encrypted handle"),
    proof: bytesHex(proof, "Input proof")
  };
}

function bytes32Hex(value, label) {
  const hex = bytesHex(value, label);
  if (hex.length !== 66) throw new Error(`${label} must be 32 bytes.`);
  return hex;
}

function bytesHex(value, label) {
  if (value == null) throw new Error(`${label} missing from FHE SDK result.`);
  if (typeof value === "string") {
    if (!/^0x([a-fA-F0-9]{2})*$/.test(value)) throw new Error(`${label} must be 0x-prefixed hex.`);
    return value;
  }
  if (value instanceof Uint8Array) return uint8ArrayHex(value);
  if (ArrayBuffer.isView(value)) return uint8ArrayHex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof ArrayBuffer) return uint8ArrayHex(new Uint8Array(value));
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return uint8ArrayHex(Uint8Array.from(value));
  if (typeof value.bytes32Hex === "string") return bytes32Hex(value.bytes32Hex, label);
  if (typeof value.hex === "string") return bytesHex(value.hex, label);
  throw new Error(`${label} has an unsupported FHE SDK result type.`);
}

function uint8ArrayHex(bytes) {
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function getFheInstance(fhe = {}) {
  if (!window.ethereum) throw new Error("No injected wallet found.");
  const config = fheConfig(fhe);
  const cacheKey = fheInstanceCacheKey(config);
  if (!instancePromise || instanceCacheKey !== cacheKey) {
    instanceCacheKey = cacheKey;
    instancePromise = loadSdk().then(async (sdk) => {
      if (typeof sdk.initSDK === "function") await sdk.initSDK();
      if (typeof sdk.createInstance !== "function") throw new Error("Zama relayer SDK createInstance() is unavailable.");
      return sdk.createInstance({
        ...(sdk.SepoliaConfig || SEPOLIA_FHE_CONFIG),
        ...config,
        network: window.ethereum
      });
    });
  }
  return instancePromise;
}

async function loadSdk() {
  if (window.ZamaRelayerSDK) return window.ZamaRelayerSDK;
  if (!sdkPromise) {
    const sdkUrl = window.__FREEDOM_ZAMA_SDK_URL__ || DEFAULT_SDK_URL;
    sdkPromise = importSdk(sdkUrl).catch((error) => {
      sdkLoadError = String(error?.message || error || "");
      if (window.__FREEDOM_ZAMA_SDK_URL__) throw error;
      return importSdk(LEGACY_SDK_URL).catch((legacyError) => {
        sdkLoadError = [error, legacyError].map((entry) => String(entry?.message || entry || "")).filter(Boolean).join(" | ");
        throw new Error(`FHE SDK unavailable. Install or expose @zama-fhe/relayer-sdk, or allow ${sdkUrl}. ${sdkLoadError}`.trim());
      });
    });
  }
  return sdkPromise;
}

async function importSdk(url) {
  const sdk = await import(url);
  loadedSdkUrl = url;
  sdkLoadError = "";
  return sdk;
}

function resetFheInstance() {
  instancePromise = null;
  instanceCacheKey = "";
}

function getFheSdkDebugInfo() {
  return {
    sdkUrl: loadedSdkUrl || window.__FREEDOM_ZAMA_SDK_URL__ || DEFAULT_SDK_URL,
    sdkLoadError,
    instanceCacheKey
  };
}

function fheConfig(fhe = {}) {
  return {
    ...SEPOLIA_FHE_CONFIG,
    ...fhe,
    chainId: Number(fhe?.chainId || fhe?.hostChainId || SEPOLIA_FHE_CONFIG.chainId),
    gatewayChainId: Number(fhe?.gatewayChainId || SEPOLIA_FHE_CONFIG.gatewayChainId),
    relayerUrl: fhe?.relayerUrl || SEPOLIA_FHE_CONFIG.relayerUrl
  };
}

function fheInstanceCacheKey(config) {
  return JSON.stringify({
    providerChainId: String(window.ethereum?.chainId || ""),
    relayerUrl: config.relayerUrl,
    chainId: Number(config.chainId || 0),
    gatewayChainId: Number(config.gatewayChainId || 0),
    aclContractAddress: config.aclContractAddress,
    kmsContractAddress: config.kmsContractAddress,
    inputVerifierContractAddress: config.inputVerifierContractAddress,
    verifyingContractAddressDecryption: config.verifyingContractAddressDecryption,
    verifyingContractAddressInputVerification: config.verifyingContractAddressInputVerification
  });
}

async function checksumAddress(address, label) {
  if (!isAddress(address)) throw new Error(`${label} is not configured.`);
  const { getAddress } = await loadEthers();
  return getAddress(address);
}

function loadEthers() {
  if (!ethersPromise) ethersPromise = import(ETHERS_URL);
  return ethersPromise;
}

export { SEPOLIA_FHE_CONFIG, encryptAmount, getFheInstance, getFheSdkDebugInfo, loadSdk, resetFheInstance };
