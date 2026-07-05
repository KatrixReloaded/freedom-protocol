export const publicFactoryAbi = [
  {
    type: "event",
    name: "SeriesCreated",
    inputs: [
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "strikePrice", type: "uint256", indexed: true },
      { name: "maturityTimestamp", type: "uint64", indexed: true },
      { name: "stableToken", type: "address", indexed: false },
      { name: "upToken", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Split",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Merge",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "oraclePrice", type: "uint256", indexed: false },
      { name: "stablePayout", type: "uint256", indexed: false },
      { name: "upPayout", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Redeemed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "claim", type: "uint256", indexed: false },
    ],
  },
] as const;

export const confidentialFactoryAbi = [
  {
    type: "event",
    name: "SeriesCreated",
    inputs: [
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "strikePrice", type: "uint256", indexed: true },
      { name: "maturityTimestamp", type: "uint64", indexed: true },
      { name: "stableToken", type: "address", indexed: false },
      { name: "upToken", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Split",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Merge",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "oraclePrice", type: "uint256", indexed: false },
      { name: "stablePayout", type: "uint256", indexed: false },
      { name: "upPayout", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Redeemed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
    ],
  },
] as const;

export const confidentialMatchingEngineAbi = [
  {
    type: "event",
    name: "ListingCreated",
    inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "quoteToken", type: "address", indexed: false },
      { name: "strikePrice", type: "uint256", indexed: false },
      { name: "maturityTimestamp", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FillAttempted",
    inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ListingCancelled",
    inputs: [{ name: "listingId", type: "uint256", indexed: true }],
  },
] as const;

export const shieldBridgeAbi = [
  {
    type: "event",
    name: "UnshieldRequested",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "strikePrice", type: "uint256", indexed: true },
      { name: "maturityTimestamp", type: "uint64", indexed: false },
      { name: "isStable", type: "bool", indexed: false },
      { name: "requestedAmount", type: "uint64", indexed: false },
      { name: "burnedAmountHandle", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnshieldFinalized",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "strikePrice", type: "uint256", indexed: true },
      { name: "maturityTimestamp", type: "uint64", indexed: false },
      { name: "isStable", type: "bool", indexed: false },
      { name: "amount", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Shielded",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "seriesId", type: "bytes32", indexed: true },
      { name: "strikePrice", type: "uint256", indexed: true },
      { name: "maturityTimestamp", type: "uint64", indexed: false },
      { name: "isStable", type: "bool", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "finalizeUnshield",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "abiEncodedCleartexts", type: "bytes" },
      { name: "decryptionProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requests",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "strikePrice", type: "uint256" },
      { name: "maturityTimestamp", type: "uint64" },
      { name: "isStable", type: "bool" },
      { name: "requestedAmount", type: "uint64" },
      { name: "burnedAmount", type: "uint256" },
      { name: "finalized", type: "bool" },
    ],
  },
] as const;

const getSeriesOutputs = [
  {
    name: "",
    type: "tuple",
    components: [
      { name: "stableToken", type: "address" },
      { name: "upToken", type: "address" },
      { name: "strikePrice", type: "uint256" },
      { name: "maturityTimestamp", type: "uint64" },
      { name: "exists", type: "bool" },
      { name: "settled", type: "bool" },
      { name: "stablePayout", type: "uint256" },
      { name: "upPayout", type: "uint256" },
    ],
  },
] as const;

export const optionFactoryReadAbi = [
  {
    type: "function",
    name: "getSeries",
    stateMutability: "view",
    inputs: [
      { name: "strikePrice", type: "uint256" },
      { name: "maturityTimestamp", type: "uint64" },
    ],
    outputs: getSeriesOutputs,
  },
] as const;

export const chainlinkOracleAdapterAbi = [
  {
    type: "function",
    name: "settlePublic",
    stateMutability: "nonpayable",
    inputs: [
      { name: "factory", type: "address" },
      { name: "strikePrice", type: "uint256" },
      { name: "maturityTimestamp", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleConfidential",
    stateMutability: "nonpayable",
    inputs: [
      { name: "factory", type: "address" },
      { name: "strikePrice", type: "uint256" },
      { name: "maturityTimestamp", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
