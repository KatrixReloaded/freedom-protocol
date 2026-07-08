import { DEFAULT_MATURITY, normalizeRoute, routes } from "./config.js";
import { sendWalletTx } from "./abi.js";
import { fetchActiveSeries } from "./active-series.js";
import { createInitialState } from "./app-state.js";
import { configuredMarketApiUrl, fetchBridgeRequests } from "./bridge-status.js";
import { formatTokenUnits } from "./format.js";
import { fetchMarketListings, fetchUserListings } from "./market-listings.js";
import { ensureMotionBackground } from "./motion-background.js";
import { createProtocolActions } from "./protocol-actions.js";
import { readEncryptedBalanceHandle, revealEncryptedBalance } from "./reveal.js";
import { resetFheInstance } from "./encryption.js";
import { createSeriesState } from "./series-state.js";
import { createTradeActions } from "./trade-actions.js";
import {
  expectedOptionRawForPaymentRaw,
  fairQuoteRawForOptionRaw,
  formatQuoteRaw,
  quoteTokenForAddress,
  selectedCreateAmountRaw,
  selectedCreateSide,
  selectedQuoteToken
} from "./trade-pricing.js";
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
  defaultStrike,
  ethPrice,
  isWrongNetwork,
  maturityTimestamp,
  maturityValidation,
  maxStrike,
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
    state.form.strike = String(defaultStrike());
    state.form.maturity = DEFAULT_MATURITY;
  }
  scheduleSeriesRefresh();
}

function syncDefaultStrikeFromOracle() {
  if (!state.form.strikeAuto) return false;
  const nextStrike = String(defaultStrike());
  if (!nextStrike || state.form.strike === nextStrike) return false;
  state.form.strike = nextStrike;
  scheduleSeriesRefresh();
  return true;
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
  state.form.selectedActiveSeriesKey = "";
  syncFormToSeries();
  scheduleBalanceRefresh();
  scheduleSeriesRefresh();
  window.setTimeout(refreshActiveSeries, 0);
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
  if (key === "strike") state.form.strikeAuto = false;
  if (["strike", "maturity"].includes(key)) state.form.selectedActiveSeriesKey = "";
  updateTradeFormDerivedValues(key);
  state.animatePage = false;
  render();
  if (key === "collateral") scheduleBalanceRefresh();
  if (["collateral", "strike", "maturity"].includes(key)) scheduleSeriesRefresh();
  if (["tradeSideFilter", "tradeActiveFilter"].includes(key)) window.setTimeout(refreshTradeListings, 0);
}

function updateTradeFormDerivedValues(key) {
  if (key === "tradeMinReceive") state.form.tradeMinReceiveAuto = !state.form.tradeMinReceive;
  if (key === "tradeFillExpected") state.form.tradeFillExpectedAuto = !state.form.tradeFillExpected;
  if (key === "tradeSelectedListingId") syncQuoteTokenFromSelectedListing();

  if (["tradeCreateSide", "tradeSellAmount", "tradeSellPAmount", "tradeSellNAmount", "tradeQuoteToken", "tradeCreateQuoteToken", "strike", "maturity"].includes(key)) {
    if (key === "tradeQuoteToken") state.form.tradeCreateQuoteToken = state.form.tradeQuoteToken;
    autoFillCreateQuote();
  }
  if (["tradeFillPayment", "tradeQuoteToken", "tradeFillQuoteToken", "tradeSelectedListingId", "strike", "maturity"].includes(key)) {
    if (key === "tradeQuoteToken") state.form.tradeFillQuoteToken = state.form.tradeQuoteToken;
    autoFillFillExpected();
  }
}

function syncQuoteTokenFromSelectedListing() {
  const listing = selectedTradeListing();
  const quote = quoteTokenForAddress(listing?.quoteToken, activeFactoryConfig());
  if (quote) state.form.tradeFillQuoteToken = quote.symbol;
}

function autoFillCreateQuote() {
  if (state.route !== "/trade" || state.mode !== "confidential" || state.form.tradeMinReceiveAuto === false) return;
  const quote = selectedQuoteToken(state, activeFactoryConfig(), "tradeCreateQuoteToken");
  const side = selectedCreateSide(state.form);
  const amount = selectedCreateAmountRaw(state.form);
  if (!side || amount <= 0n) return;
  const fair = fairQuoteRawForOptionRaw({ state, optionRaw: amount, side, quote });
  if (fair == null) {
    state.form.tradeMinReceive = "";
    state.form.tradeMinReceiveAuto = true;
    return;
  }
  state.form.tradeMinReceive = formatQuoteRaw(fair, quote);
  state.form.tradeMinReceiveAuto = true;
}

function autoFillFillExpected() {
  if (state.route !== "/trade" || state.mode !== "confidential" || state.form.tradeFillExpectedAuto === false) return;
  const listing = selectedTradeListing();
  const side = listingSide(listing);
  const quote = selectedQuoteToken(state, activeFactoryConfig(), "tradeFillQuoteToken");
  const payment = parseTradeQuoteUnits(state.form.tradeFillPayment, quote);
  if (!side || !payment || payment <= 0n) return;
  const expected = expectedOptionRawForPaymentRaw({ state, paymentRaw: payment, side, quote });
  if (expected == null) {
    state.form.tradeFillExpected = "";
    state.form.tradeFillExpectedAuto = true;
    return;
  }
  state.form.tradeFillExpected = formatTokenUnits(expected, 6, 6);
  state.form.tradeFillExpectedAuto = true;
}

function selectedTradeListing() {
  const id = String(state.form.tradeSelectedListingId || "");
  return (state.trade.listings || []).find((listing) => listingSelectionKey(listing) === id) || null;
}

function listingSelectionKey(listing) {
  return String(listing?.id || `${listing?.engineAddress || ""}:${listing?.listingId || ""}`);
}

function listingSide(listing) {
  if (!listing) return "";
  if (listing.side) return listing.side;
  const token = String(listing.tokenAddress || listing.token || "").toLowerCase();
  const series = selectedSeries();
  if (token && token === String(series?.stable_token || "").toLowerCase()) return "P";
  if (token && token === String(series?.up_token || "").toLowerCase()) return "N";
  return "";
}

function parseTradeQuoteUnits(value, quote) {
  return parseUnitsSafe(value, quote.decimals);
}

function parseUnitsSafe(value, decimals) {
  try {
    const raw = String(value || "").trim();
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
    const [whole, fraction = ""] = raw.split(".");
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0"));
  } catch (_error) {
    return null;
  }
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

function activeSeriesRowKey(row) {
  return [
    row.chainId || "",
    String(row.mode || "").toLowerCase(),
    String(row.factoryAddress || "").toLowerCase(),
    row.strikePrice || "",
    row.maturityTimestamp || ""
  ].join(":");
}

function selectActiveSeries(row) {
  state.form.strike = String(row.strikePrice || "");
  state.form.maturity = String(row.maturityTimestamp || "");
  state.form.strikeAuto = false;
  state.form.selectedActiveSeriesKey = activeSeriesRowKey(row);
  state.animatePage = false;
  scheduleSeriesRefresh();
  render();
}

async function refreshActiveSeries() {
  if (!["/deposit", "/trade"].includes(state.route)) return;
  const apiUrl = marketApiUrl();
  if (!apiUrl) {
    state.activeSeries = { ...state.activeSeries, status: "unconfigured", rows: [], error: "" };
    render();
    return;
  }
  if (refreshActiveSeries.inFlight) return;
  refreshActiveSeries.inFlight = true;
  state.activeSeries = { ...state.activeSeries, status: "loading", error: "" };
  render();
  try {
    const rows = await fetchActiveSeries({ apiUrl });
    state.activeSeries = {
      status: "ready",
      rows: filterActiveSeriesRows(rows),
      error: "",
      lastUpdated: Date.now()
    };
  } catch (error) {
    state.activeSeries = {
      ...state.activeSeries,
      status: "error",
      rows: [],
      error: normalizeActiveSeriesError(error)
    };
  } finally {
    refreshActiveSeries.inFlight = false;
    render();
  }
}

async function refreshTradeListings() {
  if (state.route !== "/trade" || state.mode !== "confidential") return;
  const apiUrl = marketApiUrl();
  if (!apiUrl) {
    state.trade = { ...state.trade, status: "unconfigured", listings: [], userListings: [], error: "" };
    render();
    return;
  }
  if (refreshTradeListings.inFlight) return;
  refreshTradeListings.inFlight = true;
  state.trade = { ...state.trade, status: "loading", error: "" };
  render();
  try {
    const factory = activeFactoryConfig();
    const chainId = Number(factory.chain?.chainId || state.wallet.chainId || 0);
    const active = state.form.tradeActiveFilter === "All" ? "" : "true";
    const side = state.form.tradeSideFilter === "All" ? "" : state.form.tradeSideFilter;
    const [listings, userListings] = await Promise.all([
      fetchMarketListings({ apiUrl, chainId, mode: "confidential", active, side }),
      state.wallet.connected ? fetchUserListings({ apiUrl, chainId, user: state.wallet.account, mode: "confidential" }) : Promise.resolve([])
    ]);
    state.trade = {
      status: "ready",
      listings: filterTradeListings(listings),
      userListings: filterTradeListings(userListings),
      error: "",
      lastUpdated: Date.now()
    };
  } catch (error) {
    state.trade = {
      ...state.trade,
      status: "error",
      listings: [],
      userListings: [],
      error: normalizeMarketError(error)
    };
  } finally {
    refreshTradeListings.inFlight = false;
    render();
  }
}

function filterTradeListings(rows) {
  const factory = activeFactoryConfig();
  const chainId = Number(factory.chain?.chainId || state.wallet.chainId || 0);
  const side = String(state.form.tradeSideFilter || "All").toUpperCase();
  return rows.filter((row) => {
    if (row.chainId && chainId && Number(row.chainId) !== chainId) return false;
    if (row.mode && row.mode !== "confidential") return false;
    if (state.form.tradeActiveFilter !== "All" && row.active === false) return false;
    if (side !== "ALL" && row.side && row.side !== side) return false;
    return true;
  });
}

function normalizeMarketError(error) {
  const message = String(error?.message || error || "");
  if (/fetch|network|failed|timeout|refused/i.test(message)) return "Market backend unavailable.";
  return message.length > 120 ? "Market listings read failed." : message || "Market listings read failed.";
}

function filterActiveSeriesRows(rows) {
  const factory = activeFactoryConfig();
  const chainId = Number(factory.chain?.chainId || state.wallet.chainId || 0);
  const mode = String(state.mode || "").toLowerCase();
  const factoryAddress = String(factory.factory || "").toLowerCase();
  return rows.filter((row) => {
    const rowStatus = String(row.status || "active").toLowerCase();
    if (rowStatus && !["active", "live"].includes(rowStatus)) return false;
    if (row.chainId && chainId && Number(row.chainId) !== chainId) return false;
    if (row.mode && row.mode !== mode) return false;
    if (row.factoryAddress && factoryAddress && String(row.factoryAddress).toLowerCase() !== factoryAddress) return false;
    return true;
  });
}

function normalizeActiveSeriesError(error) {
  const message = String(error?.message || error || "");
  if (/fetch|network|failed|timeout|refused/i.test(message)) return "Active series backend unavailable. Manual entry still works.";
  return message.length > 120 ? "Active series read failed. Manual entry still works." : message || "Active series read failed. Manual entry still works.";
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
  resetFheInstance();
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
  syncDefaultStrikeFromOracle,
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
  runShieldBridge,
  runWrapWeth
} = protocolActions;

const tradeActions = createTradeActions({
  activeFactoryConfig,
  isWrongNetwork,
  maturityTimestamp,
  render,
  selectedSeries,
  sendTx,
  setToast,
  setTx,
  state,
  updateTx
});

const { runCancelTradeListing, runCreateTradeListing, runFillTradeListing } = tradeActions;

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
  const previousHandle = state.reveal[key]?.handle || "";
  state.reveal[key] = { status: "loading", value: "", error: "", handle: "" };
  render();
  try {
    const currentHandle = handle || (await readEncryptedBalanceHandle({ tokenAddress, userAddress: state.wallet.account, chainId: state.wallet.chainId }));
    debugRevealEntry("handle-read", { key, tokenAddress, handle: currentHandle, previousHandle });
    resetFheInstance();
    const raw = await revealEncryptedBalance({
      tokenAddress,
      userAddress: state.wallet.account,
      chainId: state.wallet.chainId,
      handle: currentHandle,
      fhe: activeFactoryConfig().fhe || {}
    });
    state.reveal[key] = { status: "ready", value: formatTokenUnits(raw, 6, 6), raw, handle: currentHandle, error: "" };
    debugRevealEntry("ready", { key, tokenAddress, handle: currentHandle, previousHandle, value: raw });
  } catch (error) {
    state.reveal[key] = { status: "error", value: "", handle: "", error: normalizeRevealError(error) };
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
  if (/HTTP error|status:\s*\d{3}|\b40[0-9]\b|\b50[0-9]\b|relayer|fetch|network|timeout|Failed to fetch/i.test(message)) {
    return revealRelayerErrorText(error);
  }
  if (/not decryptable|ACL|allow|permission|handle|ciphertext|access/i.test(message)) return "This encrypted balance is not decryptable by the connected wallet.";
  return message.length > 120 ? "This encrypted balance is not decryptable by the connected wallet." : message || "Balance reveal failed.";
}

function debugRevealEntry(status, { key, tokenAddress, handle, previousHandle, value }) {
  if (!isRevealDebugEnabled()) return;
  const normalizedHandle = normalizeRevealHandle(handle);
  const normalizedPrevious = normalizeRevealHandle(previousHandle);
  console.debug("Freedom reveal entry", {
    status,
    keyScope: String(key || "").split(":")[0] || "",
    tokenAddress,
    userAddress: state.wallet.account,
    chainId: state.wallet.chainId,
    handleState: normalizedHandle === ZERO_REVEAL_HANDLE ? "zero" : normalizedHandle ? "nonzero" : "invalid",
    handleSource: "current-read",
    decryptHandleMatchesCurrentRead: Boolean(normalizedHandle),
    handleMatchesPrevious: Boolean(normalizedHandle && normalizedPrevious && normalizedHandle === normalizedPrevious),
    valueType: typeof value,
    valueState: typeof value === "undefined" ? "" : BigInt(value || 0) === 0n ? "zero" : "nonzero",
    display: typeof value === "undefined" ? "" : formatTokenUnits(value, 6, 6)
  });
}

function normalizeRevealHandle(value) {
  const clean = String(value || "").replace(/^0x/, "").padStart(64, "0");
  if (!/^[a-fA-F0-9]{64}$/.test(clean)) return "";
  return `0x${clean.toLowerCase()}`;
}

function isRevealDebugEnabled() {
  return window.__FREEDOM_DEBUG_REVEAL__ === true || window.localStorage?.getItem("freedom.debugReveal") === "1";
}

const ZERO_REVEAL_HANDLE = `0x${"0".repeat(64)}`;

function revealRelayerErrorText(error) {
  const debug = error?.freedomRevealDebug || {};
  const status = debug.status ? ` HTTP ${debug.status}.` : "";
  return `Relayer request failed.${status}`.trim();
}

function navigate(event) {
  event.preventDefault();
  const path = normalizeRoute(new URL(event.currentTarget.href).pathname);
  history.pushState(null, "", path);
  if (path === "/trade" && state.mode !== "confidential") {
    state.mode = "confidential";
    localStorage.setItem("freedom.mode", "confidential");
    state.form.selectedActiveSeriesKey = "";
    syncFormToSeries();
    scheduleBalanceRefresh();
  }
  setState({ route: path, animatePage: true });
  if (path === "/deposit") window.setTimeout(refreshActiveSeries, 0);
  if (path === "/trade") {
    window.setTimeout(refreshActiveSeries, 0);
    window.setTimeout(refreshTradeListings, 0);
  }
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
  defaultStrike,
  ethPrice,
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
  refreshActiveSeries,
  refreshTradeListings,
  refreshBridgeRequests,
  revealBalance,
  runClaim,
  runDeposit,
  runCancelTradeListing,
  runCreateTradeListing,
  runFillTradeListing,
  runShieldBridge,
  runWrapWeth,
  selectedSeries,
  setMode,
  selectActiveSeries,
  marketApiUrl,
  maxStrike,
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
    resetFheInstance();
    if (accounts?.length) localStorage.removeItem("freedom.walletDisconnected");
    refreshWallet();
    window.setTimeout(refreshTradeListings, 0);
  });
  window.ethereum.on?.("chainChanged", () => {
    clearReveals();
    resetFheInstance();
    refreshWallet();
    window.setTimeout(refreshActiveSeries, 0);
    window.setTimeout(refreshTradeListings, 0);
  });
}
if (location.pathname === "/") history.replaceState(null, "", "/deposit");

ensureMotionBackground();
render();
refreshWallet();
loadData();
refreshActiveSeries();
refreshTradeListings();
window.setInterval(() => {
  if (state.route === "/shield") refreshBridgeRequests();
  if (state.route === "/trade") refreshTradeListings();
}, 8000);
