import { GENERATED_DEPLOYMENTS } from "./generated-env.js";

const ANVIL_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;
const ZAMA_SEPOLIA_GATEWAY_ID = 10901;
const ZAMA_SEPOLIA_RELAYER_URL = "https://relayer.testnet.zama.org";
const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const SEPOLIA_WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const ZAMA_SEPOLIA_CWETH_ADDRESS = "0x46208622DA27d91db4f0393733C8BA082ed83158";
const ZAMA_SEPOLIA_CUSDC_ADDRESS = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
const DEFAULT_MARKET_API_URL = "http://127.0.0.1:4010";
const SEPOLIA_PUBLIC_FACTORY = "0x1c98aF677B9680c6A94dF4687bF454648A32e5e2";
const SEPOLIA_CONFIDENTIAL_FACTORY = "0xb1EB5165Bc03847C8789f9b06f121a5Da3ec387c";
const SEPOLIA_SHIELD_BRIDGE = "0xea54b756D2586394029A2f4fBFAe024766E8aaf7";
const SEPOLIA_SERIES_POOL_IMPLEMENTATION = "0x977ea8728b6f05A0f63313970A192160fb41dFC6";
const SEPOLIA_CONFIDENTIAL_MATCHING_ENGINE = "0x4Ac50Eb419cE50dCa6940fF90bFa7DA42fA30Ca9";
const SEPOLIA_ORACLE_ADAPTER = "0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e";
const SCALE = 1_000_000n;
const PUBLIC_COLLATERAL_OPTION_SCALE = 1_000_000_000_000n;
const MIN_PUBLIC_COLLATERAL_RAW = PUBLIC_COLLATERAL_OPTION_SCALE;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STRIKE_TICK = 50;
const POC_MATURITY_INTERVAL_SECONDS = 600;
const POC_MATURITY_MIN_LEAD_SECONDS = 120;
const FALLBACK_ETH_PRICE = 3200;
const DEFAULT_STRIKE = String(Math.floor((FALLBACK_ETH_PRICE * 0.5) / STRIKE_TICK) * STRIKE_TICK);
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
  redeemToEth: "0x20865319",
  redeemToWeth: "0x6f4e81f5",
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

const MATCHING_ENGINE_SELECTORS = {
  createListing: "0xd8009e9c",
  fill: "0xcd2502ee",
  cancelListing: "0x305a67a8"
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
  marketApiUrl: DEFAULT_MARKET_API_URL,
  chains: [
    {
      chainId: ANVIL_CHAIN_ID,
      label: "Anvil 31337",
      rpcUrl: "http://127.0.0.1:8545",
      bridge: "",
      oracleAdapter: "",
      public: {
        factory: "",
        collateralToken: "",
        collateralDecimals: 18,
        collateralSymbol: "WETH",
        paymentAssets: ["ETH", "WETH"]
      },
      confidential: { factory: "", cWETH: "", cUSDC: "", cUSDCDecimals: 6, collateralDecimals: 6, collateralSymbol: "cWETH", cwethAuthMode: "allowance" }
    },
    {
      chainId: SEPOLIA_CHAIN_ID,
      label: "Ethereum Sepolia",
      rpcUrl: SEPOLIA_RPC_URL,
      bridge: SEPOLIA_SHIELD_BRIDGE,
      oracleAdapter: SEPOLIA_ORACLE_ADAPTER,
      public: {
        factory: SEPOLIA_PUBLIC_FACTORY,
        collateralToken: SEPOLIA_WETH_ADDRESS,
        collateralDecimals: 18,
        collateralSymbol: "WETH",
        oracleAdapter: SEPOLIA_ORACLE_ADAPTER,
        paymentAssets: ["ETH", "WETH"]
      },
      confidential: {
        factory: SEPOLIA_CONFIDENTIAL_FACTORY,
        cWETH: ZAMA_SEPOLIA_CWETH_ADDRESS,
        cUSDC: ZAMA_SEPOLIA_CUSDC_ADDRESS,
        cUSDCDecimals: 6,
        cUSDCAuthMode: "operator",
        collateralDecimals: 6,
        collateralSymbol: "cWETH",
        cwethAuthMode: "operator",
        oracleAdapter: SEPOLIA_ORACLE_ADAPTER,
        matchingEngine: SEPOLIA_CONFIDENTIAL_MATCHING_ENGINE,
        seriesPoolImplementation: SEPOLIA_SERIES_POOL_IMPLEMENTATION,
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
    chains: chains.map((chain) => {
      const oracleAdapter = String(chain.oracleAdapter || "");
      return {
        ...chain,
        chainId: Number(chain.chainId),
        oracleAdapter,
        public: normalizePublicFactoryConfig(chain.public, oracleAdapter),
        confidential: chain.confidential || null
      };
    })
  };
}

function normalizePublicFactoryConfig(publicConfig, chainOracleAdapter = "") {
  if (!publicConfig) return null;
  if (publicConfig.factory || publicConfig.collateralToken || publicConfig.paymentAssets) {
    return {
      ...publicConfig,
      factory: String(publicConfig.factory || ""),
      collateralToken: String(publicConfig.collateralToken || ""),
      collateralDecimals: Number(publicConfig.collateralDecimals || 18),
      collateralSymbol: publicConfig.collateralSymbol || "WETH",
      oracleAdapter: publicConfig.oracleAdapter || chainOracleAdapter || "",
      paymentAssets: normalizePaymentAssets(publicConfig.paymentAssets)
    };
  }
  const eth = publicConfig.ETH || {};
  const weth = publicConfig.WETH || {};
  const factory = weth.factory || eth.factory || "";
  const collateralToken = weth.collateralToken && !isZeroAddress(weth.collateralToken) ? weth.collateralToken : eth.collateralToken && !isZeroAddress(eth.collateralToken) ? eth.collateralToken : "";
  return {
    factory,
    collateralToken,
    collateralDecimals: Number(weth.collateralDecimals || eth.collateralDecimals || 18),
    collateralSymbol: weth.collateralSymbol || "WETH",
    oracleAdapter: weth.oracleAdapter || eth.oracleAdapter || chainOracleAdapter || "",
    paymentAssets: normalizePaymentAssets(publicConfig.paymentAssets)
  };
}

function normalizePaymentAssets(assets) {
  const configured = Array.isArray(assets) ? assets : ["ETH", "WETH"];
  const normalized = configured.map((asset) => String(asset).toUpperCase()).filter((asset) => asset === "ETH" || asset === "WETH");
  return normalized.length ? [...new Set(normalized)] : ["ETH", "WETH"];
}

function isZeroAddress(value) {
  return /^0x0{40}$/i.test(String(value || ""));
}

function modeDeployment(chain, mode) {
  if (!chain) return null;
  if (mode === "confidential") return chain.confidential || null;
  return chain.public?.factory || chain.public?.collateralToken || chain.public?.paymentAssets ? chain.public : null;
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
  DEFAULT_DEPLOYMENTS,
  DEFAULT_MATURITY,
  DEFAULT_MARKET_API_URL,
  DEFAULT_STRIKE,
  FALLBACK_ETH_PRICE,
  SCALE,
  SELECTORS,
  ORACLE_ADAPTER_SELECTORS,
  POC_MATURITY_INTERVAL_SECONDS,
  POC_MATURITY_MIN_LEAD_SECONDS,
  MIN_PUBLIC_COLLATERAL_RAW,
  MATCHING_ENGINE_SELECTORS,
  PUBLIC_COLLATERAL_OPTION_SCALE,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CONFIDENTIAL_FACTORY,
  SEPOLIA_CONFIDENTIAL_MATCHING_ENGINE,
  SEPOLIA_ORACLE_ADAPTER,
  SEPOLIA_PUBLIC_FACTORY,
  SEPOLIA_SERIES_POOL_IMPLEMENTATION,
  SEPOLIA_SHIELD_BRIDGE,
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
