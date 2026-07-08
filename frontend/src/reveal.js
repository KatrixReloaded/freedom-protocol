import { SELECTORS } from "./config.js";
import { encodeCall, ethCall, isAddress, words } from "./abi.js";
import { SEPOLIA_FHE_CONFIG, getFheInstance, getFheSdkDebugInfo } from "./encryption.js";

const REVEAL_DURATION_DAYS = 7;
const ZERO_HANDLE = `0x${"0".repeat(64)}`;
const ETHERS_URL = "https://esm.sh/ethers@6.17.0?bundle";
let ethersPromise = null;

async function revealEncryptedBalance({ tokenAddress, userAddress, handle, fhe = {}, chainId = 0 }) {
  if (!isAddress(tokenAddress)) throw new Error("Token address is not configured.");
  if (!isAddress(userAddress)) throw new Error("Connect wallet before revealing.");
  const balanceHandle = normalizeHandle(handle || (await readEncryptedBalanceHandle({ tokenAddress, userAddress, chainId })));
  const debug = revealDebugContext({ tokenAddress, userAddress, chainId, handle: balanceHandle, fhe });
  if (!balanceHandle || balanceHandle === ZERO_HANDLE) {
    debugRevealPath({ ...debug, sdkPath: "zero-handle" });
    return 0n;
  }

  const sdkTokenAddress = await checksumAddress(tokenAddress);
  const sdkUserAddress = await checksumAddress(userAddress);
  const instance = await getFheInstance(fhe);
  if (supportsModernUserDecrypt(instance)) {
    return decryptWithDebug("modern.decrypt", debug, () => modernUserDecrypt({ instance, tokenAddress: sdkTokenAddress, userAddress: sdkUserAddress, handle: balanceHandle }));
  }
  if (typeof instance.userDecryptSingleHandle === "function") {
    return decryptWithDebug("userDecryptSingleHandle", debug, () =>
      singleHandleUserDecrypt({ instance, tokenAddress: sdkTokenAddress, userAddress: sdkUserAddress, handle: balanceHandle })
    );
  }
  if (supportsLegacyUserDecrypt(instance)) {
    return decryptWithDebug("legacy.userDecrypt", debug, () => legacyUserDecrypt({ instance, tokenAddress: sdkTokenAddress, userAddress: sdkUserAddress, handle: balanceHandle }));
  }
  if (supportsManualPermitDecrypt(instance)) {
    return decryptWithDebug("manualPermit.decrypt", debug, () => manualPermitDecrypt({ instance, tokenAddress: sdkTokenAddress, userAddress: sdkUserAddress, handle: balanceHandle }));
  }
  throw new Error("SDK does not support user decrypt.");
}

async function readEncryptedBalanceHandle({ tokenAddress, userAddress, chainId = 0 }) {
  if (!isAddress(tokenAddress) || !isAddress(userAddress)) return "";
  const data = encodeCall(SELECTORS.confidentialBalanceOf, [{ type: "address", value: userAddress }]);
  const raw = await ethCall(tokenAddress, data);
  const out = words(raw);
  const normalizedHandle = normalizeHandle(`0x${out[0] || ""}`);
  debugBalanceHandleRead({
    tokenAddress,
    userAddress,
    chainId,
    data,
    raw,
    handleState: normalizedHandle === ZERO_HANDLE ? "zero" : normalizedHandle ? "nonzero" : "invalid"
  });
  return `0x${out[0] || ""}`;
}

function supportsModernUserDecrypt(instance) {
  return (
    typeof instance.generateTransportKeyPair === "function" &&
    typeof instance.signDecryptionPermit === "function" &&
    typeof instance.decrypt === "function"
  );
}

function supportsLegacyUserDecrypt(instance) {
  return typeof instance.generateKeypair === "function" && typeof instance.createEIP712 === "function" && typeof instance.userDecrypt === "function";
}

function supportsManualPermitDecrypt(instance) {
  return (
    typeof instance.generateTransportKeyPair === "function" &&
    typeof instance.createUserDecryptEIP712 === "function" &&
    typeof instance.decrypt === "function"
  );
}

async function modernUserDecrypt({ instance, tokenAddress, userAddress, handle }) {
  const transportKeyPair = await instance.generateTransportKeyPair();
  const signedPermit = await instance.signDecryptionPermit({
    contractAddresses: [tokenAddress],
    startTimestamp: currentTimestamp(),
    durationDays: REVEAL_DURATION_DAYS,
    signerAddress: userAddress,
    signer: browserSigner(userAddress),
    transportKeyPair
  });
  const result = await instance.decrypt({
    transportKeyPair,
    encryptedValues: [{ encryptedValue: handle, contractAddress: tokenAddress }],
    signedPermit
  });
  debugDecryptResultShape("modern.decrypt", result, handle);
  return extractDecryptedValue(result, handle);
}

async function singleHandleUserDecrypt({ instance, tokenAddress, userAddress, handle }) {
  const result = await instance.userDecryptSingleHandle({
    handle,
    contractAddress: tokenAddress,
    signer: browserSigner(userAddress)
  });
  debugDecryptResultShape("userDecryptSingleHandle", result, handle);
  return extractDecryptedValue(result, handle);
}

async function legacyUserDecrypt({ instance, tokenAddress, userAddress, handle }) {
  const keypair = await instance.generateKeypair();
  const startTimestamp = currentTimestamp();
  const durationDays = REVEAL_DURATION_DAYS;
  const contractAddresses = [tokenAddress];
  const handleContractPairs = [{ handle, contractAddress: tokenAddress }];
  const extraData = await instance.getExtraData?.();
  const eip712 = await instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays, extraData);
  const signature = await signTypedData(userAddress, typedDataForWallet(eip712));
  const result = await instance.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace(/^0x/, ""),
    contractAddresses,
    userAddress,
    startTimestamp,
    durationDays,
    extraData
  );
  debugDecryptResultShape("legacy.userDecrypt", result, handle);
  return extractDecryptedValue(result, handle);
}

async function manualPermitDecrypt({ instance, tokenAddress, userAddress, handle }) {
  const transportKeyPair = await instance.generateTransportKeyPair();
  const permit = await instance.createUserDecryptEIP712({
    contractAddresses: [tokenAddress],
    startTimestamp: currentTimestamp(),
    durationDays: REVEAL_DURATION_DAYS,
    signerAddress: userAddress,
    transportKeyPair
  });
  const signature = await signTypedData(userAddress, typedDataForWallet(permit));
  const signedPermit = {
    ...permit,
    signature,
    signerAddress: userAddress
  };
  const result = await instance.decrypt({
    transportKeyPair,
    encryptedValues: [{ encryptedValue: handle, contractAddress: tokenAddress }],
    signedPermit
  });
  debugDecryptResultShape("manualPermit.decrypt", result, handle);
  return extractDecryptedValue(result, handle);
}

function browserSigner(userAddress) {
  return {
    account: { address: userAddress },
    getAddress: async () => userAddress,
    request: (args) => window.ethereum.request(args),
    transport: { request: (args) => window.ethereum.request(args) },
    signTypedData: async (...args) => {
      const typedData =
        args.length === 1 && typeof args[0] === "object"
          ? { domain: args[0].domain, types: args[0].types, primaryType: args[0].primaryType, message: args[0].message }
          : { domain: args[0], types: args[1], message: args[2] };
      return signTypedData(userAddress, typedData);
    },
    _signTypedData: async (domain, types, message) => signTypedData(userAddress, { domain, types, message })
  };
}

async function signTypedData(userAddress, typedData) {
  if (!window.ethereum?.request) throw new Error("No injected wallet found.");
  try {
    const walletTypedData = typedDataForWallet(typedData);
    debugSignatureState("requested", walletTypedData);
    const signature = await window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [userAddress, JSON.stringify(walletTypedData)]
    });
    debugSignatureState("received", walletTypedData);
    return signature;
  } catch (error) {
    if (error?.code === 4001 || /reject|denied|cancel/i.test(String(error?.message || ""))) {
      throw new Error("User rejected signature.");
    }
    throw error;
  }
}

function typedDataForWallet(eip712) {
  const types = eip712?.types || {};
  return normalizeTypedDataValue({
    domain: eip712?.domain || {},
    types,
    primaryType: eip712?.primaryType || Object.keys(types).find((key) => key !== "EIP712Domain") || "UserDecryptRequestVerification",
    message: eip712?.message || {}
  });
}

function normalizeTypedDataValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => normalizeTypedDataValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeTypedDataValue(entry)]));
  }
  return value;
}

function currentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

async function decryptWithDebug(path, context, decrypt) {
  try {
    debugRevealPath({ ...context, sdkPath: path });
    const value = await decrypt();
    debugExtractedValue({ ...context, sdkPath: path, value });
    return value;
  } catch (error) {
    attachRevealDebug(error, { ...context, sdkPath: path });
    debugRevealFailure({ ...context, sdkPath: path, error });
    throw error;
  }
}

function revealDebugContext({ tokenAddress, userAddress, chainId, handle, fhe }) {
  const sdk = getFheSdkDebugInfo();
  return {
    tokenAddress,
    userAddress,
    chainId: Number(chainId || 0),
    handleState: handle === ZERO_HANDLE ? "zero" : "nonzero",
    relayerUrl: fhe?.relayerUrl || SEPOLIA_FHE_CONFIG.relayerUrl || "",
    fheConfig: {
      relayerUrl: fhe?.relayerUrl || SEPOLIA_FHE_CONFIG.relayerUrl || "",
      chainId: Number(fhe?.chainId || fhe?.hostChainId || SEPOLIA_FHE_CONFIG.chainId || 0),
      gatewayChainId: Number(fhe?.gatewayChainId || SEPOLIA_FHE_CONFIG.gatewayChainId || 0),
      aclContractAddress: fhe?.aclContractAddress || SEPOLIA_FHE_CONFIG.aclContractAddress,
      kmsContractAddress: fhe?.kmsContractAddress || SEPOLIA_FHE_CONFIG.kmsContractAddress,
      inputVerifierContractAddress: fhe?.inputVerifierContractAddress || SEPOLIA_FHE_CONFIG.inputVerifierContractAddress,
      verifyingContractAddressDecryption: fhe?.verifyingContractAddressDecryption || SEPOLIA_FHE_CONFIG.verifyingContractAddressDecryption,
      verifyingContractAddressInputVerification:
        fhe?.verifyingContractAddressInputVerification || SEPOLIA_FHE_CONFIG.verifyingContractAddressInputVerification
    },
    sdkUrl: sdk.sdkUrl,
    sdkLoadError: sdk.sdkLoadError,
    sdkInstanceCacheKey: sdk.instanceCacheKey
  };
}

function debugRevealPath(context) {
  if (!isRevealDebugEnabled()) return;
  console.debug("Freedom reveal decrypt path", revealDebugPayload(context));
}

function debugBalanceHandleRead({ tokenAddress, userAddress, chainId, data, raw, handleState }) {
  if (!isRevealDebugEnabled()) return;
  const token = String(tokenAddress || "").toLowerCase();
  const user = String(userAddress || "").toLowerCase();
  const chain = Number(chainId || 0);
  console.debug("Freedom reveal balance handle read", {
    tokenAddress: token,
    userAddress: user,
    chainId: chain,
    selector: SELECTORS.confidentialBalanceOf,
    callInput: {
      selector: data.slice(0, 10),
      byteLength: Math.max(0, (data.length - 2) / 2),
      userAddress: user
    },
    rawOutput: {
      byteLength: Math.max(0, (String(raw || "0x").length - 2) / 2),
      wordCount: words(raw).length,
      handleState
    }
  });
}

function debugDecryptResultShape(path, result, handle) {
  if (!isRevealDebugEnabled()) return;
  console.debug("Freedom reveal decrypt result shape", {
    sdkPath: path,
    result: summarizeResultShape(result, handle)
  });
}

function debugExtractedValue({ tokenAddress, userAddress, chainId, handleState, sdkPath, value }) {
  if (!isRevealDebugEnabled()) return;
  console.debug("Freedom reveal extracted value", {
    tokenAddress,
    userAddress,
    chainId,
    handle: handleState,
    sdkPath,
    valueType: typeof value,
    valueState: BigInt(value || 0) === 0n ? "zero" : "nonzero",
    display: formatDebugTokenUnits(value, 6, 6)
  });
}

function debugSignatureState(status, typedData) {
  if (!isRevealDebugEnabled()) return;
  console.debug("Freedom reveal signature", {
    status,
    primaryType: typedData?.primaryType || "",
    domain: {
      name: typedData?.domain?.name || "",
      version: typedData?.domain?.version || "",
      chainId: String(typedData?.domain?.chainId || ""),
      verifyingContract: typedData?.domain?.verifyingContract || ""
    },
    messageShape: summarizeResultShape(typedData?.message || {}, ZERO_HANDLE)
  });
}

function debugRevealFailure({ tokenAddress, userAddress, chainId, handleState, sdkPath, relayerUrl, sdkUrl, sdkLoadError, error }) {
  if (!isRevealDebugEnabled()) return;
  console.debug("Freedom reveal decrypt failed", revealDebugPayload({
    tokenAddress,
    userAddress,
    chainId,
    handleState,
    sdkPath,
    sdkUrl,
    relayerUrl,
    sdkLoadError,
    fheConfig: error?.freedomRevealDebug?.fheConfig,
    sdkInstanceCacheKey: error?.freedomRevealDebug?.sdkInstanceCacheKey,
    error
  }));
}

function attachRevealDebug(error, context) {
  if (!error || typeof error !== "object") return;
  try {
    error.freedomRevealDebug = revealDebugPayload({ ...context, error });
  } catch (_ignored) {
    // Debug attachment must never mask the original decrypt failure.
  }
}

function revealDebugPayload({
  tokenAddress,
  userAddress,
  chainId,
  handleState,
  sdkPath,
  sdkUrl,
  relayerUrl,
  fheConfig,
  sdkLoadError,
  sdkInstanceCacheKey,
  error
}) {
  const message = sanitizeDebugMessage(error?.message || error || "");
  return {
    tokenAddress,
    userAddress,
    chainId,
    handle: handleState,
    sdkPath,
    sdkUrl,
    relayerUrl,
    failingUrl: extractErrorUrl(error) || extractUrl(message),
    status: extractErrorStatus(error) || extractStatus(message),
    fheConfig,
    sdkLoadError,
    sdkInstanceCacheKey,
    error: message
  };
}

function isRevealDebugEnabled() {
  return window.__FREEDOM_DEBUG_REVEAL__ === true || window.localStorage?.getItem("freedom.debugReveal") === "1";
}

function sanitizeDebugMessage(message) {
  return String(message || "")
    .replace(/0x[a-fA-F0-9]{64}\b/g, "[redacted-bytes32]")
    .replace(/0x[a-fA-F0-9]{130}\b/g, "[redacted-signature]");
}

function extractUrl(message) {
  return String(message || "").match(/https?:\/\/[^\s"')]+/)?.[0] || "";
}

function extractStatus(message) {
  return String(message || "").match(/status:\s*(\d{3})|\b(40[0-9]|50[0-9])\b/i)?.slice(1).find(Boolean) || "";
}

function extractErrorUrl(error) {
  return (
    error?.url ||
    error?.request?.url ||
    error?.response?.url ||
    error?.info?.requestUrl ||
    error?.cause?.url ||
    error?.cause?.request?.url ||
    error?.cause?.response?.url ||
    error?.cause?.info?.requestUrl ||
    ""
  );
}

function extractErrorStatus(error) {
  return (
    error?.status ||
    error?.statusCode ||
    error?.response?.status ||
    error?.response?.statusCode ||
    parseResponseStatus(error?.info?.responseStatus) ||
    error?.cause?.status ||
    error?.cause?.statusCode ||
    error?.cause?.response?.status ||
    error?.cause?.response?.statusCode ||
    parseResponseStatus(error?.cause?.info?.responseStatus) ||
    ""
  );
}

function parseResponseStatus(value) {
  return String(value || "").match(/\b(\d{3})\b/)?.[1] || "";
}

async function checksumAddress(address) {
  if (!isAddress(address)) throw new Error("Bad address checksum.");
  const { getAddress } = await loadEthers();
  return getAddress(address);
}

function loadEthers() {
  if (!ethersPromise) ethersPromise = import(ETHERS_URL);
  return ethersPromise;
}

function normalizeHandle(value) {
  const clean = String(value || "").replace(/^0x/, "").padStart(64, "0");
  if (!/^[a-fA-F0-9]{64}$/.test(clean)) return "";
  return `0x${clean.toLowerCase()}`;
}

function extractDecryptedValue(result, handle) {
  const direct = unwrapValue(result, handle);
  if (direct == null) throw new Error("Balance handle is not decryptable by this wallet.");
  if (typeof direct === "bigint") return direct;
  if (typeof direct === "number") return BigInt(direct);
  if (typeof direct === "string") return stringToBigInt(direct);
  if (typeof direct.value !== "undefined") return extractDecryptedValue(direct.value, handle);
  if (typeof direct.decryptedValue !== "undefined") return extractDecryptedValue(direct.decryptedValue, handle);
  if (typeof direct.clearValue !== "undefined") return extractDecryptedValue(direct.clearValue, handle);
  throw new Error("Balance handle is not decryptable by this wallet.");
}

function unwrapValue(result, handle) {
  if (result == null) return null;
  if (typeof result === "bigint" || typeof result === "number" || typeof result === "string") return result;
  if (result instanceof Map) return unwrapMapValue(result, handle);
  if (Array.isArray(result)) return unwrapArrayValue(result, handle);
  const keys = handleKeys(handle);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(result, key)) return result[key];
  }
  if (typeof result.value !== "undefined") return result.value;
  if (typeof result.decryptedValue !== "undefined") return result.decryptedValue;
  if (typeof result.clearValue !== "undefined") return result.clearValue;
  if (Array.isArray(result.clearValues)) return unwrapArrayValue(result.clearValues, handle);
  if (result.clearValues && typeof result.clearValues === "object") return unwrapValue(result.clearValues, handle);
  if (Array.isArray(result.values)) return unwrapArrayValue(result.values, handle);
  return null;
}

function unwrapMapValue(result, handle) {
  const keys = handleKeys(handle);
  for (const key of keys) {
    if (result.has(key)) return result.get(key);
  }
  if (result.size === 1) return unwrapValue([...result.values()][0], handle);
  return null;
}

function unwrapArrayValue(result, handle) {
  const match = result.find((entry) => entryHandleMatches(entry, handle));
  if (match) return unwrapMatchedEntry(match, handle);
  if (result.length === 1) return unwrapValue(result[0], handle);
  return null;
}

function unwrapMatchedEntry(entry, handle) {
  if (entry && typeof entry === "object") {
    if (typeof entry.value !== "undefined") return entry.value;
    if (typeof entry.decryptedValue !== "undefined") return entry.decryptedValue;
    if (typeof entry.clearValue !== "undefined") return entry.clearValue;
  }
  return unwrapValue(entry, handle);
}

function entryHandleMatches(entry, handle) {
  if (!entry || typeof entry !== "object") return false;
  const expected = handleKeys(handle).map((key) => key.toLowerCase());
  const candidates = [entry.handle, entry.ctHandle, entry.encryptedValue, entry.ciphertextHandle].filter(Boolean).map((value) => String(value).toLowerCase());
  return candidates.some((candidate) => expected.includes(candidate));
}

function handleKeys(handle) {
  const text = String(handle || "");
  const clean = text.replace(/^0x/, "");
  return [text, text.toLowerCase(), text.toUpperCase(), clean, clean.toLowerCase(), clean.toUpperCase()];
}

function summarizeResultShape(result, handle) {
  if (result == null) return { type: String(result) };
  if (typeof result !== "object") return { type: typeof result };
  if (result instanceof Map) {
    return {
      type: "Map",
      size: result.size,
      keys: [...result.keys()].slice(0, 8).map((key) => summarizeKey(key, handle)),
      valueTypes: [...result.values()].slice(0, 8).map(valueType)
    };
  }
  if (Array.isArray(result)) {
    return {
      type: "Array",
      length: result.length,
      valueTypes: result.slice(0, 8).map(valueType),
      first: result.length ? summarizeResultShape(result[0], handle) : null
    };
  }
  const entries = Object.entries(result);
  return {
    type: result.constructor?.name || "Object",
    keys: entries.slice(0, 12).map(([key]) => summarizeKey(key, handle)),
    valueTypes: entries.slice(0, 12).map(([, value]) => valueType(value)),
    hasHandleKey: Object.prototype.hasOwnProperty.call(result, handle),
    hasLowerHandleKey: Object.prototype.hasOwnProperty.call(result, handle.toLowerCase()),
    hasUpperHandleKey: Object.prototype.hasOwnProperty.call(result, handle.toUpperCase())
  };
}

function summarizeKey(key, handle) {
  const text = String(key);
  if (text === handle || text.toLowerCase() === handle.toLowerCase()) return "[handle]";
  if (/^0x[a-fA-F0-9]{64}$/.test(text)) return "[bytes32]";
  if (/^0x[a-fA-F0-9]{40}$/.test(text)) return "[address]";
  return text.length > 48 ? `${text.slice(0, 24)}...${text.slice(-8)}` : text;
}

function valueType(value) {
  if (value == null) return String(value);
  if (value instanceof Map) return "Map";
  if (Array.isArray(value)) return "Array";
  return typeof value === "object" ? value.constructor?.name || "Object" : typeof value;
}

function formatDebugTokenUnits(value, decimals = 18, precision = 6) {
  const units = BigInt(value || 0);
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fractionBase = 10n ** BigInt(Math.max(decimals - precision, 0));
  const fraction = decimals >= precision ? (units % base) / fractionBase : (units % base) * 10n ** BigInt(precision - decimals);
  return `${whole}.${fraction.toString().padStart(precision, "0")}`;
}

function stringToBigInt(value) {
  const raw = value.trim();
  if (/^0x[0-9a-f]+$/i.test(raw)) return BigInt(raw);
  if (/^\d+$/.test(raw)) return BigInt(raw);
  throw new Error("Balance handle is not decryptable by this wallet.");
}

export { readEncryptedBalanceHandle, revealEncryptedBalance };
