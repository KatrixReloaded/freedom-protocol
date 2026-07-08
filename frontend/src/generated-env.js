const GENERATED_DEPLOYMENTS = {
  "marketApiUrl": "http://127.0.0.1:4010",
  "chains": [
    {
      "chainId": 31337,
      "label": "Anvil 31337",
      "rpcUrl": "http://127.0.0.1:8545",
      "bridge": "",
      "oracleAdapter": "",
      "public": {
        "factory": "",
        "collateralToken": "",
        "collateralDecimals": 18,
        "collateralSymbol": "WETH",
        "oracleAdapter": "",
        "paymentAssets": [
          "ETH",
          "WETH"
        ]
      },
      "confidential": {
        "factory": "",
        "cWETH": "",
        "cUSDC": "",
        "cUSDCDecimals": 6,
        "cUSDCAuthMode": "",
        "cUSDCOperatorUntil": "",
        "collateralDecimals": 6,
        "collateralSymbol": "cWETH",
        "oracleAdapter": "",
        "cwethAuthMode": "allowance",
        "operatorUntil": "",
        "matchingEngine": "",
        "seriesPoolImplementation": ""
      }
    },
    {
      "chainId": 11155111,
      "label": "Ethereum Sepolia",
      "rpcUrl": "https://ethereum-sepolia-rpc.publicnode.com",
      "bridge": "0xea54b756D2586394029A2f4fBFAe024766E8aaf7",
      "oracleAdapter": "0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e",
      "public": {
        "factory": "0x1c98aF677B9680c6A94dF4687bF454648A32e5e2",
        "collateralToken": "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
        "collateralDecimals": 18,
        "collateralSymbol": "WETH",
        "oracleAdapter": "0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e",
        "paymentAssets": [
          "ETH",
          "WETH"
        ]
      },
      "confidential": {
        "factory": "0xb1EB5165Bc03847C8789f9b06f121a5Da3ec387c",
        "cWETH": "0x46208622DA27d91db4f0393733C8BA082ed83158",
        "cUSDC": "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639",
        "cUSDCDecimals": 6,
        "cUSDCAuthMode": "operator",
        "cUSDCOperatorUntil": "",
        "collateralDecimals": 6,
        "collateralSymbol": "cWETH",
        "oracleAdapter": "0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e",
        "cwethAuthMode": "operator",
        "operatorUntil": "",
        "matchingEngine": "0x4Ac50Eb419cE50dCa6940fF90bFa7DA42fA30Ca9",
        "seriesPoolImplementation": "0x977ea8728b6f05A0f63313970A192160fb41dFC6",
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
