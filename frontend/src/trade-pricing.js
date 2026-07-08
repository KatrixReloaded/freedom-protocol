import { SCALE } from "./config.js";
import { formatTokenUnits, parseUnits } from "./format.js";

const PRICE_SCALE = 100_000_000n;
const MIN_ETH_USD_PRICE_SCALED = 100n * PRICE_SCALE;
const MAX_ETH_USD_PRICE_SCALED = 20_000n * PRICE_SCALE;
const PRICE_DECIMAL_CANDIDATES = [8, 10, 11, 12, 18, 0];

function quoteTokenOptions(factory = {}) {
  return [
    {
      symbol: "cWETH",
      address: factory.cWETH || "",
      decimals: Number(factory.collateralDecimals || 6),
      authMode: factory.cwethAuthMode || "operator",
      operatorUntil: factory.operatorUntil || ""
    },
    {
      symbol: "cUSDC",
      address: factory.cUSDC || "",
      decimals: Number(factory.cUSDCDecimals || 6),
      authMode: factory.cUSDCAuthMode || factory.cusdcAuthMode || factory.cwethAuthMode || "operator",
      operatorUntil: factory.cUSDCOperatorUntil || factory.cusdcOperatorUntil || factory.operatorUntil || ""
    }
  ];
}

function selectedQuoteToken(state, factory = {}, key = "tradeQuoteToken") {
  const selected = String(state.form[key] || state.form.tradeQuoteToken || "cWETH");
  return quoteTokenOptions(factory).find((option) => option.symbol === selected) || quoteTokenOptions(factory)[0];
}

function quoteTokenForAddress(address, factory = {}) {
  const normalized = String(address || "").toLowerCase();
  return quoteTokenOptions(factory).find((option) => option.address && String(option.address).toLowerCase() === normalized) || null;
}

function selectedCreateSide(form) {
  const amount = parseUnits(form.tradeSellAmount || "", 6) || 0n;
  if (amount > 0n && ["P", "N"].includes(form.tradeCreateSide)) return form.tradeCreateSide;
  const pAmount = parseUnits(form.tradeSellPAmount || "", 6) || 0n;
  const nAmount = parseUnits(form.tradeSellNAmount || "", 6) || 0n;
  if (pAmount > 0n && nAmount > 0n) return "";
  if (pAmount > 0n) return "P";
  if (nAmount > 0n) return "N";
  return "";
}

function selectedCreateAmountRaw(form) {
  const amount = parseUnits(form.tradeSellAmount || "", 6) || 0n;
  if (amount > 0n && ["P", "N"].includes(form.tradeCreateSide)) return amount;
  const side = selectedCreateSide(form);
  if (side === "P") return parseUnits(form.tradeSellPAmount || "", 6) || 0n;
  if (side === "N") return parseUnits(form.tradeSellNAmount || "", 6) || 0n;
  return 0n;
}

function oraclePriceNumber(state) {
  const scaled = oraclePriceScaled(state);
  return scaled > 0n ? Number(scaled) / Number(PRICE_SCALE) : 0;
}

function oraclePriceScaled(state) {
  if (state.oracleRead.status !== "ready" || !state.oracleRead.price) return 0n;
  const raw = BigInt(state.oracleRead.price || 0);
  for (const decimals of PRICE_DECIMAL_CANDIDATES) {
    const scaled = decimals === 8 ? raw : raw * PRICE_SCALE / 10n ** BigInt(decimals);
    if (scaled >= MIN_ETH_USD_PRICE_SCALED && scaled <= MAX_ETH_USD_PRICE_SCALED) return scaled;
  }
  return 0n;
}

function payoutRateRaw(state, side) {
  const key = side === "P" ? "stablePayout" : side === "N" ? "upPayout" : "";
  if (!key) return null;
  if (state.seriesRead.settled) return BigInt(state.seriesRead[key] || 0);
  const price = oraclePriceNumber(state);
  const strike = Number(state.form.strike || 0);
  if (!Number.isFinite(price) || !Number.isFinite(strike) || price <= 0 || strike <= 0) return null;
  const stableRate = Math.min(Number(SCALE), Math.max(0, Math.floor((strike / price) * Number(SCALE))));
  return BigInt(side === "P" ? stableRate : Number(SCALE) - stableRate);
}

function fairQuoteRawForOptionRaw({ state, optionRaw, side, quote }) {
  const rate = payoutRateRaw(state, side);
  if (rate == null || rate <= 0n || optionRaw <= 0n) return null;
  const ethRaw = (optionRaw * rate) / SCALE;
  return quoteRawFromEthRaw({ state, ethRaw, quote });
}

function expectedOptionRawForPaymentRaw({ state, paymentRaw, side, quote }) {
  const rate = payoutRateRaw(state, side);
  if (rate == null || rate <= 0n || paymentRaw <= 0n) return null;
  const ethRaw = ethRawFromQuoteRaw({ state, quoteRaw: paymentRaw, quote });
  if (ethRaw == null) return null;
  return (ethRaw * SCALE) / rate;
}

function quoteRawFromEthRaw({ state, ethRaw, quote }) {
  if (quote.symbol === "cWETH") return ethRaw;
  const price = oraclePriceScaled(state);
  if (quote.symbol === "cUSDC" && price > 0n) {
    return (ethRaw * price * 10n ** BigInt(quote.decimals)) / (SCALE * PRICE_SCALE);
  }
  return null;
}

function ethRawFromQuoteRaw({ state, quoteRaw, quote }) {
  if (quote.symbol === "cWETH") return quoteRaw;
  const price = oraclePriceScaled(state);
  if (quote.symbol === "cUSDC" && price > 0n) {
    return (quoteRaw * SCALE * PRICE_SCALE) / (10n ** BigInt(quote.decimals) * price);
  }
  return null;
}

function formatQuoteRaw(raw, quote) {
  return formatTokenUnits(raw || 0n, quote.decimals, quote.decimals === 6 ? 6 : Math.min(quote.decimals, 6));
}

function pnlPercentText(valueRaw, costRaw) {
  if (valueRaw == null || costRaw == null || costRaw <= 0n) return "";
  const basisPoints = Number(((valueRaw - costRaw) * 10_000n) / costRaw);
  const percent = basisPoints / 100;
  const formatted = Math.abs(percent) >= 10 ? Math.abs(percent).toFixed(1) : Math.abs(percent).toFixed(2).replace(/0$/, "");
  return `P&L: ${percent >= 0 ? "+" : "-"}${formatted}%`;
}

export {
  expectedOptionRawForPaymentRaw,
  fairQuoteRawForOptionRaw,
  formatQuoteRaw,
  oraclePriceNumber,
  payoutRateRaw,
  pnlPercentText,
  quoteTokenForAddress,
  quoteTokenOptions,
  selectedCreateAmountRaw,
  selectedCreateSide,
  selectedQuoteToken
};
