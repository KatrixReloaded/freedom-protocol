const GENERATED_DEPLOYMENTS = {
  "marketApiUrl": "",
  "chains": [
    {
      "chainId": 31337,
      "label": "Anvil 31337",
      "rpcUrl": "http://127.0.0.1:8545",
      "bridge": "",
      "oracleAdapter": "",
      "public": {
        "ETH": {
          "factory": "",
          "collateralToken": "0x0000000000000000000000000000000000000000",
          "collateralDecimals": 18,
          "collateralSymbol": "ETH",
          "oracleAdapter": ""
        },
        "WETH": {
          "factory": "",
          "collateralToken": "",
          "collateralDecimals": 18,
          "collateralSymbol": "WETH",
          "oracleAdapter": ""
        }
      },
      "confidential": {
        "factory": "",
        "cWETH": "",
        "collateralDecimals": 6,
        "collateralSymbol": "cWETH",
        "oracleAdapter": "",
        "cwethAuthMode": "allowance",
        "operatorUntil": ""
      }
    },
    {
      "chainId": 11155111,
      "label": "Ethereum Sepolia",
      "rpcUrl": "",
      "bridge": "",
      "oracleAdapter": "",
      "public": {
        "ETH": {
          "factory": "",
          "collateralToken": "0x0000000000000000000000000000000000000000",
          "collateralDecimals": 18,
          "collateralSymbol": "ETH",
          "oracleAdapter": ""
        },
        "WETH": {
          "factory": "",
          "collateralToken": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
          "collateralDecimals": 18,
          "collateralSymbol": "WETH",
          "oracleAdapter": ""
        }
      },
      "confidential": {
        "factory": "",
        "cWETH": "0x46208622DA27d91db4f0393733C8BA082ed83158",
        "collateralDecimals": 6,
        "collateralSymbol": "cWETH",
        "oracleAdapter": "",
        "cwethAuthMode": "operator",
        "operatorUntil": "",
        "fhe": {
          "hostChainId": 11155111,
          "gatewayChainId": 10901,
          "relayerUrl": "https://relayer.testnet.zama.org"
        }
      }
    }
  ]
};

export { GENERATED_DEPLOYMENTS };
