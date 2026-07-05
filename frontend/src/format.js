import { POC_MATURITY_INTERVAL_SECONDS, SCALE, defaultPocMaturityTimestamp } from "./config.js";

function formatAddress(value) {
  if (!value || value.length < 12) return value || "Not connected";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function parseChainId(value) {
  const raw = String(value || "0");
  return raw.startsWith("0x") ? Number.parseInt(raw, 16) : Number(raw);
}

function seriesKey(chainId, factory, strike, maturity) {
  return `${chainId}:${factory}:${strike}:${maturity}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "2-digit", year: "numeric" }).format(
    new Date(Number(timestamp) * 1000)
  );
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(Number(timestamp) * 1000)
  );
}

function isTenMinuteMaturity(timestamp) {
  const value = Number(timestamp);
  return Number.isSafeInteger(value) && value > 0 && value % POC_MATURITY_INTERVAL_SECONDS === 0;
}

function maturityTimestamp(timestamp) {
  return Number(timestamp || 0);
}

function maturitySlotOptions({ includePast = false, pastSlots = 24, futureSlots = 12, selected = "" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const next = defaultPocMaturityTimestamp();
  const slots = new Set();
  if (includePast) {
    const previous = Math.floor(now / POC_MATURITY_INTERVAL_SECONDS) * POC_MATURITY_INTERVAL_SECONDS;
    for (let i = pastSlots; i >= 0; i--) slots.add(previous - i * POC_MATURITY_INTERVAL_SECONDS);
  }
  for (let i = 0; i < futureSlots; i++) slots.add(next + i * POC_MATURITY_INTERVAL_SECONDS);
  if (selected && isTenMinuteMaturity(selected)) slots.add(Number(selected));
  return [...slots].filter((slot) => slot > 0).sort((a, b) => a - b).map(String);
}

function timeToMaturityValue(maturity) {
  const seconds = Number(maturity) - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "Matured";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m remaining` : `${hours}h remaining`;
}

function parseUnits(value, decimals = 18) {
  const raw = String(value || "").trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0"));
}

function decimalInput(value, decimals = 6) {
  const cleaned = String(value || "")
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1");
  const [whole, fraction] = cleaned.split(".");
  if (fraction == null) return whole;
  return `${whole}.${fraction.slice(0, decimals)}`;
}

function integerInput(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function strikeInput(value, maxStrike) {
  const cleaned = integerInput(value);
  if (!cleaned) return "";
  return Number(cleaned) > maxStrike ? String(maxStrike) : cleaned;
}

function numericTextAttrs(extra = {}) {
  return {
    type: "text",
    inputmode: "numeric",
    pattern: "[0-9]*",
    autocomplete: "off",
    ...extra
  };
}

function decimalTextAttrs(extra = {}) {
  return {
    type: "text",
    inputmode: "decimal",
    pattern: "[0-9]*[.]?[0-9]*",
    autocomplete: "off",
    ...extra
  };
}

function formatProtocolUnits(value) {
  if (value == null) return "0.000000";
  const units = BigInt(String(value));
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

function formatTokenUnits(value, decimals = 18, precision = 6) {
  const units = BigInt(String(value || "0"));
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fractionBase = 10n ** BigInt(Math.max(decimals - precision, 0));
  const fraction = decimals >= precision ? (units % base) / fractionBase : (units % base) * 10n ** BigInt(precision - decimals);
  return `${whole}.${fraction.toString().padStart(precision, "0")}`;
}

export {
  decimalInput,
  decimalTextAttrs,
  formatAddress,
  formatDate,
  formatDateTime,
  formatProtocolUnits,
  formatTokenUnits,
  integerInput,
  isTenMinuteMaturity,
  maturitySlotOptions,
  maturityTimestamp,
  numericTextAttrs,
  parseChainId,
  parseUnits,
  seriesKey,
  strikeInput,
  timeToMaturityValue
};
