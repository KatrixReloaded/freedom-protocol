import { ANVIL_CHAIN_ID, FALLBACK_ETH_PRICE, STRIKE_TICK, ZERO_ADDRESS, chainSupportsMode, chainsForMode } from "./config.js";
import {
  isTenMinuteMaturity,
  maturityTimestamp as toMaturityTimestamp,
  parseUnits,
  seriesKey,
  strikeInput as sanitizeStrikeInput,
  timeToMaturityValue
} from "./format.js";

function createSeriesState({ state }) {
  function activeChainConfig() {
    if (state.wallet.chainId) {
      const connected = state.deployments.chains.find((chain) => Number(chain.chainId) === Number(state.wallet.chainId));
      if (connected && chainSupportsMode(connected, state.mode)) return connected;
    }
    return targetChainConfig();
  }

  function targetChainConfig() {
    const supported = chainsForMode(state.deployments, state.mode);
    const configured = supported.find((chain) => modeFactoryAddress(chain));
    if (configured) return configured;
    return supported[0] || state.deployments.chains[0] || { chainId: ANVIL_CHAIN_ID, label: "Anvil 31337" };
  }

  function currentChainConfig() {
    return state.deployments.chains.find((chain) => Number(chain.chainId) === Number(state.wallet.chainId)) || null;
  }

  function modeChainIds(mode = state.mode) {
    return chainsForMode(state.deployments, mode).map((chain) => Number(chain.chainId));
  }

  function activeFactoryConfig() {
    const chain = activeChainConfig();
    if (state.mode === "confidential") {
      return { chain, mode: "confidential", collateral: "cWETH", ...(chain?.confidential || {}) };
    }
    const publicConfig = chain?.public || {};
    const paymentAsset = publicPaymentAsset(publicConfig);
    return { chain, mode: "public", collateral: publicConfig.collateralSymbol || "WETH", paymentAsset, ...publicConfig };
  }

  function modeFactoryAddress(chain) {
    if (state.mode === "confidential") return chain?.confidential?.factory || "";
    return chain?.public?.factory || "";
  }

  function maturityTimestamp(timestamp = state.form.maturity) {
    return toMaturityTimestamp(timestamp);
  }

  function maturityValidation({ requireFuture = false } = {}) {
    const timestamp = Number(state.form.maturity);
    if (!isTenMinuteMaturity(timestamp)) return "Maturity must be aligned to a 10-minute slot.";
    if (requireFuture && timestamp <= Math.floor(Date.now() / 1000)) return "Maturity must be a future 10-minute slot.";
    return "";
  }

  function strikeValidation({ capToEthPrice = true } = {}) {
    const strike = Number(state.form.strike);
    const max = maxStrike();
    if (!Number.isInteger(strike) || strike <= 0) return "Strike must be positive.";
    if (strike % STRIKE_TICK !== 0) return "Strike must be a multiple of $50.";
    if (capToEthPrice && strike > max) return `Strike cannot exceed 50% of current ETH price. Max strike is $${max}.`;
    return "";
  }

  function statusFor(series) {
    const now = Math.floor(Date.now() / 1000);
    if (!series) return "Not created";
    if (series.exists === false) return "Not created";
    if (Number(series.settled)) return "Settled";
    if (Number(series.maturityTimestamp || series.maturity) <= now) return "Matured";
    return "Active";
  }

  function timeToMaturity(series) {
    return timeToMaturityValue(series?.maturity || state.form.maturity);
  }

  function selectedSeries() {
    if (!state.seriesRead.stableToken && !state.seriesRead.upToken) return null;
    const factory = activeFactoryConfig();
    return {
      series_key: seriesKey(factory.chain?.chainId || state.wallet.chainId || ANVIL_CHAIN_ID, factory.factory || ZERO_ADDRESS, state.form.strike, maturityTimestamp()),
      chain_id: factory.chain?.chainId || state.wallet.chainId || ANVIL_CHAIN_ID,
      factory_address: factory.factory || "",
      strike: state.form.strike,
      maturity: state.form.maturity,
      maturityTimestamp: maturityTimestamp(),
      mode: state.mode,
      collateral_token: factory.collateralToken || factory.cWETH || ZERO_ADDRESS,
      stable_token: state.seriesRead.stableToken,
      up_token: state.seriesRead.upToken,
      exists: state.seriesRead.exists,
      settled: state.seriesRead.settled,
      stable_payout: state.seriesRead.stablePayout,
      up_payout: state.seriesRead.upPayout
    };
  }

  function isWrongNetwork() {
    if (!state.wallet.connected) return false;
    const connected = currentChainConfig();
    return !connected || !chainSupportsMode(connected, state.mode);
  }

  function publicSeriesChainMismatch() {
    const series = selectedSeries();
    return state.mode === "public" && state.wallet.connected && series?.chain_id && Number(series.chain_id) !== state.wallet.chainId;
  }

  function isNativeToken(value) {
    return !value || /^0x0{40}$/i.test(value);
  }

  function collateralSymbol(series = selectedSeries()) {
    if (state.mode === "confidential") return "cWETH";
    return publicPaymentAsset();
  }

  function publicCollateralConfig() {
    const config = activeFactoryConfig();
    if (publicPaymentAsset(config) === "ETH") return { symbol: "ETH", decimals: 18, native: true, token: "", factory: config.factory };
    const token = config.collateralToken || "";
    return {
      symbol: "WETH",
      decimals: Number(config.collateralDecimals || 18),
      native: false,
      token: isNativeToken(token) ? "" : token,
      factory: config.factory
    };
  }

  function publicPaymentAsset(config = activeFactoryConfig()) {
    const supported = Array.isArray(config?.paymentAssets) && config.paymentAssets.length ? config.paymentAssets : ["ETH", "WETH"];
    const requested = String(state.form.collateral || "ETH").toUpperCase();
    return supported.includes(requested) ? requested : supported[0] || "ETH";
  }

  function parseCollateralUnits(value) {
    const config = state.mode === "confidential" ? activeFactoryConfig() : publicCollateralConfig();
    return parseUnits(value, Number(config.collateralDecimals || (config.native ? 18 : 18)));
  }

  function strikeInput(value) {
    return sanitizeStrikeInput(value, state.route === "/settle" ? Number.MAX_SAFE_INTEGER : maxStrike());
  }

  function ethPrice() {
    const raw = BigInt(state.oracleRead.price || 0);
    if (raw <= 0n) return FALLBACK_ETH_PRICE;
    if (raw > 1_000_000_000n) return Number(raw) / 100_000_000;
    return Number(raw);
  }

  function defaultStrike() {
    const halfPrice = Math.floor(ethPrice() / 2);
    return Math.floor(halfPrice / STRIKE_TICK) * STRIKE_TICK;
  }

  function maxStrike() {
    return defaultStrike();
  }

  return {
    activeFactoryConfig,
    collateralSymbol,
    currentChainConfig,
    defaultStrike,
    ethPrice,
    isWrongNetwork,
    maturityTimestamp,
    maturityValidation,
    maxStrike,
    modeChainIds,
    parseCollateralUnits,
    publicCollateralConfig,
    publicSeriesChainMismatch,
    selectedSeries,
    statusFor,
    strikeInput,
    strikeValidation,
    targetChainConfig,
    timeToMaturity
  };
}

export { createSeriesState };
