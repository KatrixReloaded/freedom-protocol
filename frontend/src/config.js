import { GENERATED_DEPLOYMENTS } from "./generated-env.js";

const ANVIL_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;
const ZAMA_SEPOLIA_GATEWAY_ID = 10901;
const ZAMA_SEPOLIA_RELAYER_URL = "https://relayer.testnet.zama.org";
const SEPOLIA_WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const ZAMA_SEPOLIA_CWETH_ADDRESS = "0x46208622DA27d91db4f0393733C8BA082ed83158";
const SCALE = 1_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STRIKE_TICK = 50;
const POC_MATURITY_INTERVAL_SECONDS = 600;
const POC_MATURITY_MIN_LEAD_SECONDS = 120;
const CURRENT_ETH_PRICE = 3200;
const DEFAULT_STRIKE = String(Math.floor((CURRENT_ETH_PRICE * 0.5) / STRIKE_TICK) * STRIKE_TICK);
const MAX_STRIKE = Math.floor((CURRENT_ETH_PRICE * 0.75) / STRIKE_TICK) * STRIKE_TICK;
const DEFAULT_MATURITY = String(defaultPocMaturityTimestamp());

const SELECTORS = {
  getSeries: "0x84daf1fa",
  seriesExists: "0x3941399c",
  predictTokenAddresses: "0xae6ccff4",
  getTokens: "0xc4c244a2",
  publicCreateSeriesAndSplit: "0xe2b0a0ba",
  publicSplit: "0x18dc1cee",
  confidentialCreateSeriesAndSplit: "0x9c50f78f",
  confidentialSplit: "0xb309b63a",
  redeem: "0x1c706885",
  settle: "0x99323f5d",
  vault: "0xfbfa77cf",
  collateralToken: "0xb2016bd4",
  cWETH: "0x1ee8aa1f",
  oracle: "0x7dc0d1d0",
  approve: "0x095ea7b3",
  confidentialApprove: "0xb32c1001",
  setOperator: "0xd4febb96",
  confidentialBalanceOf: "0x344ff101",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e"
};

const WETH_SELECTORS = {
  deposit: "0xd0e30db0"
};

const SHIELD_BRIDGE_SELECTORS = {
  shield: "0x4cbd82d3",
  unshield: "0x6b65da56",
  finalizeUnshield: "0xccd85b34",
  authorizeSeries: "0x3977ae03"
};

const SHIELD_BRIDGE_EVENTS = {
  unshieldRequested: "0x65b28f0e4f2a0035786b6f89b240a1993dca92ca0e7a434e084cfe3f82c745fc"
};

const ORACLE_ADAPTER_SELECTORS = {
  latestEthUsdPrice: "0x083e6477",
  settlePublic: "0x8c50ecf4",
  settleConfidential: "0xbb22b457",
  settle: "0x5fbe8010"
};

function defaultPocMaturityTimestamp(nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  let next = Math.ceil((now + 1) / POC_MATURITY_INTERVAL_SECONDS) * POC_MATURITY_INTERVAL_SECONDS;
  if (next - now < POC_MATURITY_MIN_LEAD_SECONDS) next += POC_MATURITY_INTERVAL_SECONDS;
  return next;
}

const DEFAULT_DEPLOYMENTS = {
  marketApiUrl: "",
  chains: [
    {
      chainId: ANVIL_CHAIN_ID,
      label: "Anvil 31337",
      rpcUrl: "http://127.0.0.1:8545",
      bridge: "",
      oracleAdapter: "",
      public: {
        ETH: { factory: "", collateralToken: ZERO_ADDRESS, collateralDecimals: 18, collateralSymbol: "ETH" },
        WETH: { factory: "", collateralToken: "", collateralDecimals: 18, collateralSymbol: "WETH" }
      },
      confidential: { factory: "", cWETH: "", collateralDecimals: 6, collateralSymbol: "cWETH", cwethAuthMode: "allowance" }
    },
    {
      chainId: SEPOLIA_CHAIN_ID,
      label: "Ethereum Sepolia",
      rpcUrl: "",
      bridge: "",
      oracleAdapter: "",
      public: {
        ETH: { factory: "", collateralToken: ZERO_ADDRESS, collateralDecimals: 18, collateralSymbol: "ETH" },
        WETH: { factory: "", collateralToken: SEPOLIA_WETH_ADDRESS, collateralDecimals: 18, collateralSymbol: "WETH" }
      },
      confidential: {
        factory: "",
        cWETH: ZAMA_SEPOLIA_CWETH_ADDRESS,
        collateralDecimals: 6,
        collateralSymbol: "cWETH",
        cwethAuthMode: "operator",
        fhe: {
          hostChainId: SEPOLIA_CHAIN_ID,
          gatewayChainId: ZAMA_SEPOLIA_GATEWAY_ID,
          relayerUrl: ZAMA_SEPOLIA_RELAYER_URL
        }
      }
    }
  ]
};

const routes = [
  { path: "/deposit", label: "Deposit" },
  { path: "/trade", label: "Trade" },
  { path: "/settle", label: "Settle" },
  { path: "/shield", label: "Shield" }
];

function loadDeploymentConfig() {
  const runtimeConfig = typeof window !== "undefined" ? window.__FREEDOM_CONFIG__ : null;
  return normalizeDeploymentConfig(structuredClone(runtimeConfig || GENERATED_DEPLOYMENTS || DEFAULT_DEPLOYMENTS));
}

function normalizeDeploymentConfig(config) {
  const chains = Array.isArray(config?.chains) ? config.chains : [];
  return {
    marketApiUrl: String(config?.marketApiUrl || ""),
    chains: chains.map((chain) => ({
      ...chain,
      chainId: Number(chain.chainId),
      oracleAdapter: String(chain.oracleAdapter || ""),
      public: chain.public || {},
      confidential: chain.confidential || null
    }))
  };
}

function modeDeployment(chain, mode) {
  if (!chain) return null;
  if (mode === "confidential") return chain.confidential || null;
  return chain.public && Object.keys(chain.public).length ? chain.public : null;
}

function chainSupportsMode(chain, mode) {
  return Boolean(modeDeployment(chain, mode));
}

function chainsForMode(deployments, mode) {
  return (deployments?.chains || []).filter((chain) => chainSupportsMode(chain, mode));
}

function normalizeRoute(path) {
  if (path === "/") return "/deposit";
  return routes.some((route) => route.path === path) ? path : "/deposit";
}

export {
  ANVIL_CHAIN_ID,
  CURRENT_ETH_PRICE,
  DEFAULT_DEPLOYMENTS,
  DEFAULT_MATURITY,
  DEFAULT_STRIKE,
  MAX_STRIKE,
  SCALE,
  SELECTORS,
  ORACLE_ADAPTER_SELECTORS,
  POC_MATURITY_INTERVAL_SECONDS,
  POC_MATURITY_MIN_LEAD_SECONDS,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_WETH_ADDRESS,
  SHIELD_BRIDGE_EVENTS,
  SHIELD_BRIDGE_SELECTORS,
  STRIKE_TICK,
  WETH_SELECTORS,
  ZAMA_SEPOLIA_CWETH_ADDRESS,
  ZAMA_SEPOLIA_GATEWAY_ID,
  ZAMA_SEPOLIA_RELAYER_URL,
  ZERO_ADDRESS,
  chainSupportsMode,
  chainsForMode,
  defaultPocMaturityTimestamp,
  loadDeploymentConfig,
  modeDeployment,
  normalizeRoute,
  routes
};
