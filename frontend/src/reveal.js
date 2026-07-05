import { SELECTORS } from "./config.js";
import { encodeCall, ethCall, isAddress, words } from "./abi.js";
import { getFheInstance } from "./encryption.js";

const REVEAL_DURATION_DAYS = 7;
const ZERO_HANDLE = `0x${"0".repeat(64)}`;

async function revealEncryptedBalance({ tokenAddress, userAddress, handle, fhe = {} }) {
  if (!isAddress(tokenAddress)) throw new Error("Token address is not configured.");
  if (!isAddress(userAddress)) throw new Error("Connect wallet before revealing.");
  const balanceHandle = normalizeHandle(handle || (await readEncryptedBalanceHandle({ tokenAddress, userAddress })));
  if (!balanceHandle || balanceHandle === ZERO_HANDLE) throw new Error("Balance handle is not decryptable by this wallet.");

  const instance = await getFheInstance(fhe);
  if (supportsModernUserDecrypt(instance)) {
    return modernUserDecrypt({ instance, tokenAddress, userAddress, handle: balanceHandle });
  }
  if (typeof instance.userDecryptSingleHandle === "function") {
    return singleHandleUserDecrypt({ instance, tokenAddress, userAddress, handle: balanceHandle });
  }
  if (supportsLegacyUserDecrypt(instance)) {
    return legacyUserDecrypt({ instance, tokenAddress, userAddress, handle: balanceHandle });
  }
  if (supportsManualPermitDecrypt(instance)) {
    return manualPermitDecrypt({ instance, tokenAddress, userAddress, handle: balanceHandle });
  }
  throw new Error("SDK does not support user decrypt.");
}

async function readEncryptedBalanceHandle({ tokenAddress, userAddress }) {
  if (!isAddress(tokenAddress) || !isAddress(userAddress)) return "";
  try {
    return `0x${words(await ethCall(tokenAddress, encodeCall(SELECTORS.confidentialBalanceOf, [{ type: "address", value: userAddress }])))[0] || ""}`;
  } catch (_error) {
    return "";
  }
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
  return extractDecryptedValue(result, handle);
}

async function singleHandleUserDecrypt({ instance, tokenAddress, userAddress, handle }) {
  const result = await instance.userDecryptSingleHandle({
    handle,
    contractAddress: tokenAddress,
    signer: browserSigner(userAddress)
  });
  return extractDecryptedValue(result, handle);
}

async function legacyUserDecrypt({ instance, tokenAddress, userAddress, handle }) {
  const keypair = await instance.generateKeypair();
  const startTimestamp = String(currentTimestamp());
  const durationDays = String(REVEAL_DURATION_DAYS);
  const contractAddresses = [tokenAddress];
  const handleContractPairs = [{ handle, contractAddress: tokenAddress }];
  const eip712 = await instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);
  const signature = await signTypedData(userAddress, typedDataForWallet(eip712));
  const result = await instance.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace(/^0x/, ""),
    contractAddresses,
    userAddress,
    startTimestamp,
    durationDays
  );
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
    return await window.ethereum.request({
      method: "eth_signTypedData_v4",
      params: [userAddress, JSON.stringify(typedDataForWallet(typedData))]
    });
  } catch (error) {
    if (error?.code === 4001 || /reject|denied|cancel/i.test(String(error?.message || ""))) {
      throw new Error("User rejected signature.");
    }
    throw error;
  }
}

function typedDataForWallet(eip712) {
  const types = eip712?.types || {};
  return {
    domain: eip712?.domain || {},
    types,
    primaryType: eip712?.primaryType || Object.keys(types).find((key) => key !== "EIP712Domain") || "UserDecryptRequestVerification",
    message: eip712?.message || {}
  };
}

function currentTimestamp() {
  return Math.floor(Date.now() / 1000);
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
  throw new Error("Balance handle is not decryptable by this wallet.");
}

function unwrapValue(result, handle) {
  if (result == null) return null;
  if (typeof result === "bigint" || typeof result === "number" || typeof result === "string") return result;
  if (Array.isArray(result)) return unwrapValue(result[0], handle);
  const keys = [handle, handle.toLowerCase(), handle.toUpperCase()];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(result, key)) return result[key];
  }
  if (typeof result.value !== "undefined") return result.value;
  if (Array.isArray(result.clearValues)) return unwrapValue(result.clearValues[0], handle);
  if (result.clearValues && typeof result.clearValues === "object") return unwrapValue(result.clearValues, handle);
  if (Array.isArray(result.values)) return unwrapValue(result.values[0], handle);
  return null;
}

function stringToBigInt(value) {
  const raw = value.trim();
  if (/^0x[0-9a-f]+$/i.test(raw)) return BigInt(raw);
  if (/^\d+$/.test(raw)) return BigInt(raw);
  throw new Error("Balance handle is not decryptable by this wallet.");
}

export { readEncryptedBalanceHandle, revealEncryptedBalance };
