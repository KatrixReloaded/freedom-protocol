import { ANVIL_CHAIN_ID, MAX_STRIKE, STRIKE_TICK, ZERO_ADDRESS, chainSupportsMode, chainsForMode } from "./config.js";
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
    const publicConfig = chain?.public?.[state.form.collateral] || {};
    return { chain, mode: "public", collateral: state.form.collateral, ...publicConfig };
  }

  function modeFactoryAddress(chain) {
    if (state.mode === "confidential") return chain?.confidential?.factory || "";
    const selected = chain?.public?.[state.form.collateral]?.factory;
    if (selected) return selected;
    return Object.values(chain?.public || {}).find((entry) => entry?.factory)?.factory || "";
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

  function strikeValidation() {
    const strike = Number(state.form.strike);
    if (!Number.isInteger(strike) || strike <= 0) return "Strike must be positive.";
    if (strike % STRIKE_TICK !== 0) return "Strike must be a multiple of $50.";
    if (strike > MAX_STRIKE) return `Strike cannot exceed 75% of current ETH price. Max strike is $${MAX_STRIKE}.`;
    return "";
  }

  function statusFor(series) {
    const now = Math.floor(Date.now() / 1000);
    if (!series) return "Not created";
    if (series.exists === false) return "Not created";
    if (Number(series.settled)) return "Settled";
    if (Number(series.maturity) <= now) return "Matured";
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
    if (state.form.collateral === "WETH") return "WETH";
    if (String(series?.mode || "").toUpperCase() === "ETH") return "ETH";
    return isNativeToken(series?.collateral_token) ? "ETH" : "WETH";
  }

  function publicCollateralConfig() {
    const config = activeFactoryConfig();
    if (state.form.collateral === "ETH") return { symbol: "ETH", decimals: 18, native: true, token: "", factory: config.factory };
    const token = config.collateralToken || "";
    return {
      symbol: config.collateralSymbol || "WETH",
      decimals: Number(config.collateralDecimals || 18),
      native: false,
      token: isNativeToken(token) ? "" : token,
      factory: config.factory
    };
  }

  function parseCollateralUnits(value) {
    const config = state.mode === "confidential" ? activeFactoryConfig() : publicCollateralConfig();
    return parseUnits(value, Number(config.collateralDecimals || (config.native ? 18 : 18)));
  }

  function strikeInput(value) {
    return sanitizeStrikeInput(value, MAX_STRIKE);
  }

  return {
    activeFactoryConfig,
    collateralSymbol,
    currentChainConfig,
    isWrongNetwork,
    maturityTimestamp,
    maturityValidation,
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
