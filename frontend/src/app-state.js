import { DEFAULT_MATURITY, DEFAULT_STRIKE, loadDeploymentConfig, normalizeRoute } from "./config.js";

function createInitialState(pathname = location.pathname) {
  return {
    route: normalizeRoute(pathname),
    mode: localStorage.getItem("freedom.mode") || "public",
    deployments: loadDeploymentConfig(),
    loading: true,
    wallet: {
      account: "",
      chainId: 0,
      connected: false
    },
    balances: {
      publicCollateral: { status: "idle", symbol: "", value: "", max: "", raw: 0n, error: "", nextRetryAt: 0 },
      stable: { status: "idle", value: "", raw: 0n, error: "" },
      up: { status: "idle", value: "", raw: 0n, error: "" }
    },
    seriesRead: {
      status: "idle",
      exists: false,
      settled: false,
      stableToken: "",
      upToken: "",
      stablePayout: "0",
      upPayout: "0",
      maturityTimestamp: DEFAULT_MATURITY,
      oracle: "",
      error: ""
    },
    oracleRead: {
      status: "idle",
      adapter: "",
      price: "",
      updatedAt: "",
      error: ""
    },
    form: {
      collateral: "ETH",
      amount: "",
      wrapAmount: "",
      shieldAmount: "",
      strike: DEFAULT_STRIKE,
      maturity: DEFAULT_MATURITY,
      side: "P",
      marketFilter: "All"
    },
    tx: [],
    bridgeRequests: { status: "idle", rows: [], active: null, error: "", lastUpdated: 0 },
    toast: null,
    fhe: { status: "idle", error: "" },
    reveal: {},
    animatePage: true
  };
}

export { createInitialState };
