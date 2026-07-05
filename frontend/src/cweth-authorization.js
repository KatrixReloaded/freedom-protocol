import { SELECTORS } from "./config.js";
import { encodeCall, isAddress } from "./abi.js";
import { encryptAmount } from "./encryption.js";

function cwethAuthMode(factory) {
  const mode = String(factory.cwethAuthMode || "allowance").toLowerCase();
  return ["allowance", "operator", "none"].includes(mode) ? mode : "allowance";
}

function cwethAuthLabel(factory) {
  return {
    allowance: "Authorize cWETH vault",
    operator: "Authorize cWETH vault operator",
    none: "Skip cWETH authorization"
  }[cwethAuthMode(factory)];
}

async function authorizeCWeth({ factory, cWETH, vault, userAddress, amount, sendTx, fhe }) {
  const mode = cwethAuthMode(factory);
  if (mode === "none") return { skipped: true, mode };
  if (!isAddress(vault)) throw new Error("Factory vault is not configured.");

  if (mode === "operator") {
    const until = BigInt(factory.operatorUntil || defaultOperatorUntil());
    const data = encodeCall(SELECTORS.setOperator, [
      { type: "address", value: vault },
      { type: "uint", value: until }
    ]);
    return { mode, hash: await sendTx(cWETH, data, 0n) };
  }

  const encrypted = await encryptAmount({
    contractAddress: cWETH,
    userAddress,
    value: amount,
    fhe
  });
  const data = encodeCall(SELECTORS.confidentialApprove, [
    { type: "address", value: vault },
    { type: "bytes32", value: encrypted.handle },
    { type: "bytes", value: encrypted.proof }
  ]);
  return { mode, hash: await sendTx(cWETH, data, 0n) };
}

function defaultOperatorUntil() {
  return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
}

export { authorizeCWeth, cwethAuthLabel, cwethAuthMode };
