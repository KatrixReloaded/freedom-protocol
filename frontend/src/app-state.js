import { DEFAULT_MATURITY, DEFAULT_STRIKE, loadDeploymentConfig, normalizeRoute } from "./config.js";

function createInitialState(pathname = location.pathname) {
  const route = normalizeRoute(pathname);
  const storedMode = localStorage.getItem("freedom.mode") || "public";
  return {
    route,
    mode: route === "/trade" ? "confidential" : storedMode,
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
      payoutAsset: "ETH",
      amount: "",
      wrapAmount: "",
      shieldAmount: "",
      tradeSellPAmount: "",
      tradeSellNAmount: "",
      tradeCreateSide: "P",
      tradeSellAmount: "",
      tradeMinReceive: "",
      tradeMinReceiveAuto: true,
      tradeQuoteToken: "cWETH",
      tradeCreateQuoteToken: "cWETH",
      tradeFillQuoteToken: "cWETH",
      tradeFillPayment: "",
      tradeFillExpected: "",
      tradeFillExpectedAuto: true,
      tradeIntent: "Buy",
      tradeSelectedListingId: "",
      tradeSideFilter: "All",
      tradeActiveFilter: "Active",
      strike: DEFAULT_STRIKE,
      strikeAuto: true,
      maturity: DEFAULT_MATURITY,
      side: "P",
      marketFilter: "All",
      selectedActiveSeriesKey: ""
    },
    tx: [],
    trade: { status: "idle", listings: [], userListings: [], error: "", lastUpdated: 0 },
    bridgeRequests: { status: "idle", rows: [], active: null, error: "", lastUpdated: 0 },
    activeSeries: { status: "idle", rows: [], error: "", lastUpdated: 0 },
    toast: null,
    fhe: { status: "idle", error: "" },
    reveal: {},
    animatePage: true
  };
}

export { createInitialState };
