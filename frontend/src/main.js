import { DEFAULT_MATURITY, DEFAULT_STRIKE, normalizeRoute, routes } from "./config.js";
import { sendWalletTx } from "./abi.js";
import { createInitialState } from "./app-state.js";
import { configuredMarketApiUrl, fetchBridgeRequests } from "./bridge-status.js";
import { formatTokenUnits } from "./format.js";
import { ensureMotionBackground } from "./motion-background.js";
import { createProtocolActions } from "./protocol-actions.js";
import { revealEncryptedBalance } from "./reveal.js";
import { createSeriesState } from "./series-state.js";
import { createViews } from "./views.js";
import { createWalletActions } from "./wallet.js";

const state = createInitialState();

function setState(patch) {
  Object.assign(state, patch);
  render();
}

const seriesState = createSeriesState({ state });

const {
  activeFactoryConfig,
  collateralSymbol,
  isWrongNetwork,
  maturityTimestamp,
  maturityValidation,
  parseCollateralUnits,
  publicCollateralConfig,
  publicSeriesChainMismatch,
  selectedSeries,
  statusFor,
  strikeInput,
  strikeValidation,
  targetChainConfig,
  timeToMaturity
} = seriesState;

async function sendTx(to, data, value = 0n) {
  return sendWalletTx(state.wallet.account, to, data, value);
}

function scheduleSeriesRefresh() {
  window.clearTimeout(scheduleSeriesRefresh.timer);
  scheduleSeriesRefresh.timer = window.setTimeout(refreshSelectedSeries, 180);
}

function syncFormToSeries() {
  if (!state.form.strike || !state.form.maturity) {
    state.form.strike = DEFAULT_STRIKE;
    state.form.maturity = DEFAULT_MATURITY;
  }
  scheduleSeriesRefresh();
}

function scheduleBalanceRefresh(force = false) {
  window.clearTimeout(scheduleBalanceRefresh.timer);
  const nextRetryAt = state.balances.publicCollateral.nextRetryAt || 0;
  if (!force && nextRetryAt > Date.now()) {
    render();
    return;
  }
  scheduleBalanceRefresh.timer = window.setTimeout(() => refreshPublicCollateralBalance(force), 120);
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("freedom.mode", mode);
  syncFormToSeries();
  scheduleBalanceRefresh();
  scheduleSeriesRefresh();
  if (state.wallet.connected && isWrongNetwork()) {
    const target = targetChainConfig();
    setToast(`Switch wallet to ${target?.label || `chain ${target?.chainId || ""}`}.`);
  }
  render();
}

function setToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 3600);
}

function updateForm(key, value) {
  state.form[key] = value;
  state.animatePage = false;
  render();
  if (key === "collateral") scheduleBalanceRefresh();
  if (["collateral", "strike", "maturity"].includes(key)) scheduleSeriesRefresh();
}

function setTx(steps) {
  state.tx = steps.map((label, index) => ({ label, status: index === 0 ? "pending" : "idle", hash: "" }));
  render();
}

function updateTx(index, patch) {
  state.tx[index] = { ...state.tx[index], ...patch };
  render();
}

function marketApiUrl() {
  return configuredMarketApiUrl(state.deployments);
}

const walletActions = createWalletActions({
  state,
  setState,
  render,
  scheduleBalanceRefresh,
  scheduleSeriesRefresh,
  setToast,
  isWrongNetwork,
  targetChainConfig
});

const {
  connectWallet,
  disconnectWallet,
  handleNetworkAction,
  networkActionTitle,
  networkLabel,
  networkStateClass,
  refreshWallet,
  switchToZama
} = walletActions;

async function disconnectWalletAndClearReveals() {
  clearReveals();
  return disconnectWallet();
}

const protocolActions = createProtocolActions({
  activeFactoryConfig,
  isWrongNetwork,
  maturityTimestamp,
  maturityValidation,
  parseCollateralUnits,
  publicCollateralConfig,
  publicSeriesChainMismatch,
  refreshWalletNetwork: switchToZama,
  render,
  selectedSeries,
  sendTx,
  setToast,
  setTx,
  state,
  strikeValidation,
  targetChainConfig,
  switchToZama,
  updateTx
});

const {
  loadData,
  refreshPublicCollateralBalance,
  refreshSelectedSeries,
  runClaim,
  runDeposit,
  runSettleSeries,
  runShieldBridge,
  runWrapWeth
} = protocolActions;

async function refreshBridgeRequests() {
  const apiUrl = marketApiUrl();
  const bridge = activeFactoryConfig().chain?.bridge || "";
  if (!apiUrl || !state.wallet.connected || !bridge) {
    state.bridgeRequests = {
      ...state.bridgeRequests,
      status: apiUrl ? "idle" : "unconfigured",
      rows: [],
      error: ""
    };
    render();
    return;
  }
  if (refreshBridgeRequests.inFlight) return;
  refreshBridgeRequests.inFlight = true;
  state.bridgeRequests = { ...state.bridgeRequests, status: "loading", error: "" };
  render();
  try {
    const rows = await fetchBridgeRequests({
      apiUrl,
      chainId: state.wallet.chainId,
      bridge,
      user: state.wallet.account
    });
    const active = reconcileActiveBridgeRequest(rows);
    state.bridgeRequests = {
      ...state.bridgeRequests,
      status: "ready",
      rows,
      active,
      error: "",
      lastUpdated: Date.now()
    };
  } catch (error) {
    state.bridgeRequests = {
      ...state.bridgeRequests,
      status: "error",
      error: normalizeBridgeStatusError(error)
    };
  } finally {
    refreshBridgeRequests.inFlight = false;
    render();
  }
}

function reconcileActiveBridgeRequest(rows) {
  const active = state.bridgeRequests.active;
  if (!rows.length) return active;
  const byRequestId = active?.requestId ? rows.find((row) => row.requestId === active.requestId) : null;
  const byTx = active?.txHash ? rows.find((row) => sameHash(row.requestTx, active.txHash)) : null;
  return byRequestId || byTx || active || rows[0];
}

function sameHash(a, b) {
  return Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
}

function normalizeBridgeStatusError(error) {
  const message = String(error?.message || error || "");
  if (/fetch|network|failed|timeout|refused/i.test(message)) return "Bridge status backend unavailable.";
  return message.length > 120 ? "Bridge status read failed." : message || "Bridge status read failed.";
}

function balanceRetrySeconds() {
  const retryAt = state.balances.publicCollateral.nextRetryAt || 0;
  return retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0;
}

function balanceDisplay(symbol) {
  if (!state.wallet.connected) return { hint: "Balance: connect wallet", max: "" };
  if (state.mode === "confidential" && isWrongNetwork()) return { hint: "Balance: unavailable on wrong network", max: "" };
  if (state.mode === "confidential") return { hint: "Balance: use Reveal to decrypt locally", max: "" };
  const balance = state.balances.publicCollateral;
  if (balance.status === "loading") return { hint: `Balance: loading ${symbol}...`, max: "" };
  if (balance.status === "ready") return { hint: `Balance: ${balance.value} ${balance.symbol}`, max: balance.max };
  if (balance.status === "error") {
    const wait = balanceRetrySeconds();
    return { hint: `Balance: ${balance.error}${wait ? ` Retry in ${wait}s.` : ""}`, max: "" };
  }
  return { hint: `Balance: ${symbol} read unavailable`, max: "" };
}

function optionBalanceText(key) {
  const balance = state.balances[key];
  if (!state.seriesRead.exists) return "series not created";
  if (balance.status === "ready") return balance.value;
  if (balance.status === "loading") return "loading";
  if (balance.status === "error") return balance.error;
  return "unavailable";
}

async function revealBalance(key, tokenAddress, handle = "") {
  if (!key) return;
  if (!state.wallet.connected) {
    setToast("Connect wallet before revealing.");
    return;
  }
  if (isWrongNetwork()) {
    setToast("Switch network before revealing.");
    return;
  }
  if (!tokenAddress) {
    state.reveal[key] = { status: "error", value: "", error: "Token address is not configured." };
    render();
    return;
  }
  state.reveal[key] = { status: "loading", value: "", error: "" };
  render();
  try {
    const raw = await revealEncryptedBalance({
      tokenAddress,
      userAddress: state.wallet.account,
      handle,
      fhe: activeFactoryConfig().fhe || {}
    });
    state.reveal[key] = { status: "ready", value: formatTokenUnits(raw, 6, 6), error: "" };
  } catch (error) {
    state.reveal[key] = { status: "error", value: "", error: normalizeRevealError(error) };
  }
  render();
}

function hideReveal(key) {
  if (!key || !state.reveal[key]) return;
  delete state.reveal[key];
  render();
}

function clearReveals() {
  state.reveal = {};
}

function normalizeRevealError(error) {
  const message = String(error?.message || error || "");
  if (/User rejected signature/i.test(message) || error?.code === 4001 || /reject|denied|cancel/i.test(message)) return "User rejected signature.";
  if (/FHE SDK unavailable|SDK does not support user decrypt|Loaded Zama SDK|createInstance|does not expose|not a function/i.test(message)) {
    return "SDK does not support user decrypt.";
  }
  if (/relayer|fetch|network|timeout|503|502|504/i.test(message)) return "Relayer unavailable.";
  if (/not decryptable|ACL|allow|permission|handle|ciphertext|access/i.test(message)) return "Balance handle is not decryptable by this wallet.";
  return message.length > 120 ? "Balance handle is not decryptable by this wallet." : message || "Balance reveal failed.";
}

function navigate(event) {
  event.preventDefault();
  const path = normalizeRoute(new URL(event.currentTarget.href).pathname);
  history.pushState(null, "", path);
  setState({ route: path, animatePage: true });
  if (path === "/shield") window.setTimeout(refreshBridgeRequests, 0);
}

function supportsSelectionRange(input) {
  return ["text", "search", "url", "tel", "password"].includes(input.type);
}

const views = createViews({
  state,
  routes,
  balanceDisplay,
  balanceRetrySeconds,
  collateralSymbol,
  activeFactoryConfig,
  targetChainConfig,
  connectWallet,
  disconnectWallet: disconnectWalletAndClearReveals,
  handleNetworkAction,
  isWrongNetwork,
  maturityTimestamp,
  navigate,
  networkActionTitle,
  networkLabel,
  networkStateClass,
  optionBalanceText,
  publicSeriesChainMismatch,
  refreshPublicCollateralBalance,
  refreshSelectedSeries,
  refreshBridgeRequests,
  revealBalance,
  runClaim,
  runDeposit,
  runSettleSeries,
  runShieldBridge,
  runWrapWeth,
  selectedSeries,
  setMode,
  marketApiUrl,
  hideReveal,
  statusFor,
  strikeInput,
  switchToZama,
  timeToMaturity,
  updateForm
});

function render() {
  const app = document.querySelector("#app");
  const active = document.activeElement;
  const focusState =
    active?.id && active instanceof HTMLInputElement
      ? { id: active.id, start: supportsSelectionRange(active) ? active.selectionStart : null, end: supportsSelectionRange(active) ? active.selectionEnd : null }
      : null;
  app.replaceChildren(views.appShell());
  if (focusState) {
    const next = document.getElementById(focusState.id);
    if (next instanceof HTMLInputElement) {
      next.focus({ preventScroll: true });
      if (supportsSelectionRange(next)) next.setSelectionRange(focusState.start, focusState.end);
    }
  }
  state.animatePage = false;
}

window.addEventListener("popstate", () => setState({ route: normalizeRoute(location.pathname), animatePage: true }));
window.addEventListener("focus", refreshWallet);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshWallet();
});
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accounts) => {
    clearReveals();
    if (accounts?.length) localStorage.removeItem("freedom.walletDisconnected");
    refreshWallet();
  });
  window.ethereum.on?.("chainChanged", () => {
    clearReveals();
    refreshWallet();
  });
}
if (location.pathname === "/") history.replaceState(null, "", "/deposit");

ensureMotionBackground();
render();
refreshWallet();
loadData();
window.setInterval(() => {
  if (state.route === "/shield") refreshBridgeRequests();
}, 8000);
