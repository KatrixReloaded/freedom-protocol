function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function requireAddress(value, label) {
  if (!isAddress(value)) throw new Error(`${label} is not configured.`);
  return value;
}

function addressCallData(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function hexWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodeAddress(address) {
  return addressCallData(address);
}

function encodeBytes32(value) {
  return String(value || "0x").replace(/^0x/, "").padStart(64, "0");
}

function encodeBytes(value) {
  const clean = String(value || "0x").replace(/^0x/, "");
  const length = clean.length / 2;
  const paddedLength = Math.ceil(length / 32) * 64;
  return `${hexWord(length)}${clean.padEnd(paddedLength, "0")}`;
}

function encodeCall(selector, args = []) {
  let head = "";
  let tail = "";
  for (const arg of args) {
    if (arg.type === "uint") head += hexWord(arg.value);
    else if (arg.type === "bool") head += hexWord(arg.value ? 1 : 0);
    else if (arg.type === "address") head += encodeAddress(arg.value);
    else if (arg.type === "bytes32") head += encodeBytes32(arg.value);
    else if (arg.type === "bytes") {
      const offset = 32n * BigInt(args.length) + BigInt(tail.length / 2);
      head += hexWord(offset);
      tail += encodeBytes(arg.value);
    }
  }
  return `${selector}${head}${tail}`;
}

function words(result) {
  const clean = String(result || "0x").replace(/^0x/, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 64) out.push(clean.slice(i, i + 64).padStart(64, "0"));
  return out;
}

function decodeAddress(word) {
  return `0x${word.slice(24)}`;
}

function decodeUint(word) {
  return BigInt(`0x${word || "0"}`);
}

function decodeBool(word) {
  return decodeUint(word) !== 0n;
}

async function ethCall(to, data, provider = window.ethereum) {
  requireAddress(to, "Contract address");
  const result = await provider.request({ method: "eth_call", params: [{ to, data }, "latest"] });
  return result || "0x";
}

async function sendWalletTx(from, to, data, value = 0n, provider = window.ethereum) {
  requireAddress(to, "Transaction target");
  if (!from) throw new Error("Connect wallet");
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${BigInt(value).toString(16)}` }]
  });
}

export {
  addressCallData,
  decodeAddress,
  decodeBool,
  decodeUint,
  encodeCall,
  ethCall,
  isAddress,
  requireAddress,
  sendWalletTx,
  words
};
