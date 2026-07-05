const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ANVIL_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;
const ZAMA_SEPOLIA_GATEWAY_ID = 10901;
const ZAMA_SEPOLIA_RELAYER_URL = "https://relayer.testnet.zama.org";
const SEPOLIA_WETH_ADDRESS = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const ZAMA_SEPOLIA_CWETH_ADDRESS = "0x46208622DA27d91db4f0393733C8BA082ed83158";

function envValue(env, ...names) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return "";
}

function envNumber(env, fallback, ...names) {
  const raw = envValue(env, ...names);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configFromJsonEnv(env) {
  const raw = envValue(env, "FREEDOM_DEPLOYMENT_CONFIG", "VITE_FREEDOM_DEPLOYMENT_CONFIG");
  if (!raw) return null;
  try {
    const config = JSON.parse(raw);
    return Array.isArray(config?.chains) ? config : null;
  } catch {
    return null;
  }
}

function deploymentConfigFromEnv(env = process.env) {
  const jsonConfig = configFromJsonEnv(env);
  if (jsonConfig) return jsonConfig;

  const localChainId = envNumber(env, ANVIL_CHAIN_ID, "FREEDOM_ANVIL_CHAIN_ID", "VITE_FREEDOM_ANVIL_CHAIN_ID");
  const sepoliaChainId = envNumber(env, SEPOLIA_CHAIN_ID, "FREEDOM_SEPOLIA_CHAIN_ID", "VITE_FREEDOM_SEPOLIA_CHAIN_ID", "FREEDOM_ZAMA_CHAIN_ID", "VITE_FREEDOM_ZAMA_CHAIN_ID");
  const chains = [
    {
      chainId: localChainId,
      label: envValue(env, "FREEDOM_ANVIL_CHAIN_LABEL", "VITE_FREEDOM_ANVIL_CHAIN_LABEL") || "Anvil 31337",
      rpcUrl: envValue(env, "FREEDOM_ANVIL_RPC_URL", "VITE_FREEDOM_ANVIL_RPC_URL") || "http://127.0.0.1:8545",
      bridge: envValue(env, "FREEDOM_ANVIL_SHIELD_BRIDGE", "VITE_FREEDOM_ANVIL_SHIELD_BRIDGE"),
      oracleAdapter: envValue(env, "FREEDOM_ANVIL_ORACLE_ADAPTER", "VITE_FREEDOM_ANVIL_ORACLE_ADAPTER"),
      public: publicConfig(env, {}, "FREEDOM_LOCAL", "VITE_FREEDOM_LOCAL", "FREEDOM", "VITE_FREEDOM"),
      confidential: confidentialConfig(env, {}, "FREEDOM_LOCAL", "VITE_FREEDOM_LOCAL", "FREEDOM", "VITE_FREEDOM")
    },
    {
      chainId: sepoliaChainId,
      label: envValue(env, "FREEDOM_SEPOLIA_CHAIN_LABEL", "VITE_FREEDOM_SEPOLIA_CHAIN_LABEL", "FREEDOM_ZAMA_CHAIN_LABEL", "VITE_FREEDOM_ZAMA_CHAIN_LABEL") || "Ethereum Sepolia",
      rpcUrl: envValue(env, "FREEDOM_SEPOLIA_RPC_URL", "VITE_FREEDOM_SEPOLIA_RPC_URL"),
      bridge: envValue(env, "FREEDOM_SEPOLIA_SHIELD_BRIDGE", "VITE_FREEDOM_SEPOLIA_SHIELD_BRIDGE"),
      oracleAdapter: envValue(env, "FREEDOM_SEPOLIA_ORACLE_ADAPTER", "VITE_FREEDOM_SEPOLIA_ORACLE_ADAPTER"),
      public: publicConfig(env, { defaultWethToken: SEPOLIA_WETH_ADDRESS }, "FREEDOM_SEPOLIA", "VITE_FREEDOM_SEPOLIA", "FREEDOM", "VITE_FREEDOM"),
      confidential: {
        ...confidentialConfig(
          env,
          { defaultCWethToken: ZAMA_SEPOLIA_CWETH_ADDRESS, defaultAuthMode: "operator" },
          "FREEDOM_SEPOLIA",
          "VITE_FREEDOM_SEPOLIA",
          "FREEDOM_ZAMA",
          "VITE_FREEDOM_ZAMA",
          "FREEDOM",
          "VITE_FREEDOM"
        ),
        fhe: {
          hostChainId: sepoliaChainId,
          gatewayChainId: envNumber(env, ZAMA_SEPOLIA_GATEWAY_ID, "FREEDOM_ZAMA_GATEWAY_CHAIN_ID", "VITE_FREEDOM_ZAMA_GATEWAY_CHAIN_ID"),
          relayerUrl: envValue(env, "FREEDOM_ZAMA_RELAYER_URL", "VITE_FREEDOM_ZAMA_RELAYER_URL") || ZAMA_SEPOLIA_RELAYER_URL
        }
      }
    }
  ];

  return {
    marketApiUrl: envValue(env, "FREEDOM_MARKET_API_URL", "VITE_FREEDOM_MARKET_API_URL"),
    chains: mergeChains(chains)
  };
}

function envFromPrefixes(env, suffix, ...prefixes) {
  for (const prefix of prefixes) {
    const value = envValue(env, `${prefix}_${suffix}`);
    if (value) return value;
  }
  return "";
}

function publicConfig(env, options = {}, ...prefixes) {
  const ethFactory = envFromPrefixes(env, "PUBLIC_ETH_FACTORY", ...prefixes);
  const wethFactory = envFromPrefixes(env, "PUBLIC_WETH_FACTORY", ...prefixes) || ethFactory;
  const oracleAdapter = envFromPrefixes(env, "ORACLE_ADAPTER", ...prefixes);
  return {
    ETH: {
      factory: ethFactory,
      collateralToken: ZERO_ADDRESS,
      collateralDecimals: 18,
      collateralSymbol: "ETH",
      oracleAdapter
    },
    WETH: {
      factory: wethFactory,
      collateralToken: envFromPrefixes(env, "WETH_TOKEN", ...prefixes) || options.defaultWethToken || "",
      collateralDecimals: 18,
      collateralSymbol: "WETH",
      oracleAdapter
    }
  };
}

function confidentialConfig(env, options = {}, ...prefixes) {
  return {
    factory: envFromPrefixes(env, "CONFIDENTIAL_FACTORY", ...prefixes),
    cWETH: envFromPrefixes(env, "CWETH_TOKEN", ...prefixes) || options.defaultCWethToken || "",
    collateralDecimals: Number(envFromPrefixes(env, "CWETH_DECIMALS", ...prefixes)) || 6,
    collateralSymbol: "cWETH",
    oracleAdapter: envFromPrefixes(env, "ORACLE_ADAPTER", ...prefixes),
    cwethAuthMode: envFromPrefixes(env, "CWETH_AUTH_MODE", ...prefixes) || options.defaultAuthMode || "allowance",
    operatorUntil: envFromPrefixes(env, "CWETH_OPERATOR_UNTIL", ...prefixes)
  };
}

function mergeChains(chains) {
  const byId = new Map();
  for (const chain of chains) {
    const existing = byId.get(Number(chain.chainId));
    if (!existing) {
      byId.set(Number(chain.chainId), chain);
      continue;
    }
    byId.set(Number(chain.chainId), {
      ...existing,
      ...chain,
      public: { ...(existing.public || {}), ...(chain.public || {}) },
      oracleAdapter: chain.oracleAdapter || existing.oracleAdapter || "",
      confidential: { ...(existing.confidential || {}), ...(chain.confidential || {}) }
    });
  }
  return [...byId.values()];
}

export { deploymentConfigFromEnv };
