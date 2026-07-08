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
      rpcUrl: envValue(env, "FREEDOM_SEPOLIA_RPC_URL", "VITE_FREEDOM_SEPOLIA_RPC_URL") || SEPOLIA_RPC_URL,
      bridge: envValue(env, "FREEDOM_SEPOLIA_SHIELD_BRIDGE", "VITE_FREEDOM_SEPOLIA_SHIELD_BRIDGE") || SEPOLIA_SHIELD_BRIDGE,
      oracleAdapter: envValue(env, "FREEDOM_SEPOLIA_ORACLE_ADAPTER", "VITE_FREEDOM_SEPOLIA_ORACLE_ADAPTER") || SEPOLIA_ORACLE_ADAPTER,
      public: publicConfig(
        env,
        {
          defaultFactory: SEPOLIA_PUBLIC_FACTORY,
          defaultWethToken: SEPOLIA_WETH_ADDRESS,
          defaultOracleAdapter: SEPOLIA_ORACLE_ADAPTER
        },
        "FREEDOM_SEPOLIA",
        "VITE_FREEDOM_SEPOLIA",
        "FREEDOM",
        "VITE_FREEDOM"
      ),
      confidential: {
        ...confidentialConfig(
          env,
          {
            defaultFactory: SEPOLIA_CONFIDENTIAL_FACTORY,
            defaultCWethToken: ZAMA_SEPOLIA_CWETH_ADDRESS,
            defaultCUSdcToken: ZAMA_SEPOLIA_CUSDC_ADDRESS,
            defaultCUSdcDecimals: 6,
            defaultCUSdcAuthMode: "operator",
            defaultAuthMode: "operator",
            defaultOracleAdapter: SEPOLIA_ORACLE_ADAPTER,
            defaultMatchingEngine: SEPOLIA_CONFIDENTIAL_MATCHING_ENGINE,
            defaultSeriesPoolImplementation: SEPOLIA_SERIES_POOL_IMPLEMENTATION
          },
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

  const baseConfig = {
    marketApiUrl: envValue(env, "FREEDOM_MARKET_API_URL", "VITE_FREEDOM_MARKET_API_URL") || DEFAULT_MARKET_API_URL,
    chains: mergeChains(chains)
  };
  return jsonConfig ? mergeDeploymentConfig(baseConfig, jsonConfig) : baseConfig;
}

function envFromPrefixes(env, suffix, ...prefixes) {
  for (const prefix of prefixes) {
    const value = envValue(env, `${prefix}_${suffix}`);
    if (value) return value;
  }
  return "";
}

function publicConfig(env, options = {}, ...prefixes) {
  const canonicalFactory = envFromPrefixes(env, "PUBLIC_FACTORY", ...prefixes);
  const ethFactoryAlias = envFromPrefixes(env, "PUBLIC_ETH_FACTORY", ...prefixes);
  const wethFactoryAlias = envFromPrefixes(env, "PUBLIC_WETH_FACTORY", ...prefixes);
  const factory = canonicalFactory || wethFactoryAlias || ethFactoryAlias || options.defaultFactory || "";
  const oracleAdapter = envFromPrefixes(env, "ORACLE_ADAPTER", ...prefixes) || options.defaultOracleAdapter || "";
  return {
    factory,
    collateralToken: envFromPrefixes(env, "WETH_TOKEN", ...prefixes) || options.defaultWethToken || "",
    collateralDecimals: 18,
    collateralSymbol: "WETH",
    oracleAdapter,
    paymentAssets: ["ETH", "WETH"]
  };
}

function confidentialConfig(env, options = {}, ...prefixes) {
  return {
    factory: envFromPrefixes(env, "CONFIDENTIAL_FACTORY", ...prefixes) || options.defaultFactory || "",
    cWETH: envFromPrefixes(env, "CWETH_TOKEN", ...prefixes) || options.defaultCWethToken || "",
    cUSDC: envFromPrefixes(env, "CUSDC_TOKEN", ...prefixes) || options.defaultCUSdcToken || "",
    cUSDCDecimals: Number(envFromPrefixes(env, "CUSDC_DECIMALS", ...prefixes)) || options.defaultCUSdcDecimals || 6,
    cUSDCAuthMode: envFromPrefixes(env, "CUSDC_AUTH_MODE", ...prefixes) || options.defaultCUSdcAuthMode || "",
    cUSDCOperatorUntil: envFromPrefixes(env, "CUSDC_OPERATOR_UNTIL", ...prefixes),
    collateralDecimals: Number(envFromPrefixes(env, "CWETH_DECIMALS", ...prefixes)) || 6,
    collateralSymbol: "cWETH",
    oracleAdapter: envFromPrefixes(env, "ORACLE_ADAPTER", ...prefixes) || options.defaultOracleAdapter || "",
    cwethAuthMode: envFromPrefixes(env, "CWETH_AUTH_MODE", ...prefixes) || options.defaultAuthMode || "allowance",
    operatorUntil: envFromPrefixes(env, "CWETH_OPERATOR_UNTIL", ...prefixes),
    matchingEngine: envFromPrefixes(env, "CONFIDENTIAL_MATCHING_ENGINE", ...prefixes) || options.defaultMatchingEngine || "",
    seriesPoolImplementation: envFromPrefixes(env, "SERIES_POOL_IMPLEMENTATION", ...prefixes) || options.defaultSeriesPoolImplementation || ""
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
      ...mergeNonEmpty(existing, chain),
      public: mergeNonEmpty(existing.public || {}, chain.public || {}),
      bridge: chain.bridge || existing.bridge || "",
      oracleAdapter: chain.oracleAdapter || existing.oracleAdapter || "",
      confidential: mergeNonEmpty(existing.confidential || {}, chain.confidential || {})
    });
  }
  return [...byId.values()];
}

function mergeDeploymentConfig(baseConfig, overrideConfig) {
  return {
    ...mergeNonEmpty(baseConfig, overrideConfig),
    marketApiUrl: overrideConfig.marketApiUrl || baseConfig.marketApiUrl,
    chains: mergeChains([...(baseConfig.chains || []), ...(overrideConfig.chains || [])])
  };
}

function mergeNonEmpty(baseValue, overrideValue) {
  if (overrideValue == null || overrideValue === "") return baseValue;
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) return overrideValue;
  if (typeof baseValue === "object" && typeof overrideValue === "object") {
    const out = { ...baseValue };
    for (const [key, value] of Object.entries(overrideValue)) {
      out[key] = mergeNonEmpty(baseValue?.[key], value);
    }
    return out;
  }
  return overrideValue;
}

export { deploymentConfigFromEnv };
