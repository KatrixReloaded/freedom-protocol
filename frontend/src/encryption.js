import { ZAMA_SEPOLIA_GATEWAY_ID, ZAMA_SEPOLIA_RELAYER_URL, SEPOLIA_CHAIN_ID } from "./config.js";

const DEFAULT_SDK_URL = "https://cdn.zama.ai/relayer-sdk-js/0.2.0/relayer-sdk-js.js";
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

async function encryptAmount({ contractAddress, userAddress, value, fhe = {} }) {
  if (!contractAddress) throw new Error("Encryption target contract is not configured.");
  if (!userAddress) throw new Error("Connect wallet before encrypting.");
  const amount = BigInt(value || 0);
  if (amount <= 0n) throw new Error("Enter amount.");
  if (amount > 2n ** 64n - 1n) throw new Error("Confidential amount exceeds euint64 range.");

  const instance = await getFheInstance(fhe);
  if (typeof instance.createEncryptedInput === "function") {
    const encrypted = await instance.createEncryptedInput(contractAddress, userAddress).add64(amount).encrypt();
    return { handle: encrypted.handles?.[0], proof: encrypted.inputProof };
  }
  if (typeof instance.encrypt === "function") {
    const encrypted = await instance.encrypt({
      contractAddress,
      userAddress,
      values: { type: "uint64", value: amount }
    });
    return {
      handle: encrypted.externalEncryptedValue?.bytes32Hex || encrypted.externalEncryptedValues?.[0]?.bytes32Hex,
      proof: encrypted.inputProof
    };
  }
  throw new Error("Loaded Zama SDK does not expose an encryption API.");
}

async function getFheInstance(fhe = {}) {
  if (!window.ethereum) throw new Error("No injected wallet found.");
  if (!instancePromise) {
    instancePromise = loadSdk().then(async (sdk) => {
      if (typeof sdk.initSDK === "function") await sdk.initSDK();
      if (typeof sdk.createInstance !== "function") throw new Error("Zama relayer SDK createInstance() is unavailable.");
      const config = {
        ...(sdk.SepoliaConfig || SEPOLIA_FHE_CONFIG),
        ...SEPOLIA_FHE_CONFIG,
        ...fhe,
        network: window.ethereum
      };
      return sdk.createInstance(config);
    });
  }
  return instancePromise;
}

async function loadSdk() {
  if (window.ZamaRelayerSDK) return window.ZamaRelayerSDK;
  if (!sdkPromise) {
    sdkPromise = import(window.__FREEDOM_ZAMA_SDK_URL__ || DEFAULT_SDK_URL).catch((error) => {
      throw new Error(`FHE SDK unavailable. Install or expose @zama-fhe/relayer-sdk, or allow ${DEFAULT_SDK_URL}. ${error.message || ""}`.trim());
    });
  }
  return sdkPromise;
}

function resetFheInstance() {
  instancePromise = null;
}

export { SEPOLIA_FHE_CONFIG, encryptAmount, getFheInstance, loadSdk, resetFheInstance };
