# 10-Minute PoC Maturity ABI Handoff

Series identity is now `strikePrice + maturityTimestamp`.

```solidity
seriesId(uint256 strikePrice, uint64 maturityTimestamp) returns (bytes32)
```

`seriesId` is `keccak256(abi.encode(strikePrice, maturityTimestamp))`.

## Maturity Validation

- `maturityTimestamp > block.timestamp`
- `maturityTimestamp % 10 minutes == 0`
- no calendar-date maturity key
- no calendar-date alignment rule

Frontend preset should choose the next future 10-minute boundary.

## Strike Validation

- `strikePrice > 0`
- `strikePrice % 50 == 0`
- deposit/split entrypoints validate `strikePrice <= 50%` of the current
  Chainlink ETH/USD price read by the factory's configured `ethUsdFeed`
- frontend should default to the largest multiple of 50 less than or equal to
  50% of current ETH price, but the factory enforces the limit on-chain

## Public Factory

```solidity
createSeries(uint256 strikePrice, uint64 maturityTimestamp)
createSeriesAndSplit(uint256 strikePrice, uint64 maturityTimestamp, uint256 amount) payable
split(uint256 strikePrice, uint64 maturityTimestamp, uint256 amount) payable
merge(uint256 strikePrice, uint64 maturityTimestamp, uint256 amount)
settle(uint256 strikePrice, uint64 maturityTimestamp, uint256 oraclePrice)
redeem(uint256 strikePrice, uint64 maturityTimestamp)
getSeries(uint256 strikePrice, uint64 maturityTimestamp)
getTokens(uint256 strikePrice, uint64 maturityTimestamp) returns (address stable, address up)
seriesExists(uint256 strikePrice, uint64 maturityTimestamp) returns (bool)
isSettled(uint256 strikePrice, uint64 maturityTimestamp) returns (bool)
predictTokenAddresses(uint256 strikePrice, uint64 maturityTimestamp) returns (address stableToken, address upToken)
authorizeBridge(uint256 strikePrice, uint64 maturityTimestamp)
bridgeMint(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, address to, uint256 amount)
```

## Confidential Factory

```solidity
createSeries(uint256 strikePrice, uint64 maturityTimestamp)
createSeriesAndSplit(uint256 strikePrice, uint64 maturityTimestamp, externalEuint64 encAmt, bytes proof)
split(uint256 strikePrice, uint64 maturityTimestamp, externalEuint64 encAmt, bytes proof)
merge(uint256 strikePrice, uint64 maturityTimestamp, euint64 amount)
settle(uint256 strikePrice, uint64 maturityTimestamp, uint256 oraclePrice)
redeem(uint256 strikePrice, uint64 maturityTimestamp)
createPool(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, address quoteToken, uint64 minPricePerToken)
getPool(uint256 strikePrice, uint64 maturityTimestamp, bool isStable) returns (address)
getSeries(uint256 strikePrice, uint64 maturityTimestamp)
getTokens(uint256 strikePrice, uint64 maturityTimestamp) returns (address stable, address up)
seriesExists(uint256 strikePrice, uint64 maturityTimestamp) returns (bool)
isSettled(uint256 strikePrice, uint64 maturityTimestamp) returns (bool)
predictTokenAddresses(uint256 strikePrice, uint64 maturityTimestamp) returns (address stableToken, address upToken)
authorizeBridge(uint256 strikePrice, uint64 maturityTimestamp)
bridgeMint(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, address to, uint256 amount)
```

## Chainlink Adapter

```solidity
settle(address factory, uint256 strikePrice, uint64 maturityTimestamp)
settlePublic(address factory, uint256 strikePrice, uint64 maturityTimestamp)
settleConfidential(address factory, uint256 strikePrice, uint64 maturityTimestamp)
latestEthUsdPrice() returns (uint256 price, uint256 updatedAt)
```

## Shield Bridge

```solidity
authorizeSeries(uint256 strikePrice, uint64 maturityTimestamp)
unshield(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, uint256 amount) returns (uint256 requestId)
shield(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, uint256 amount)
finalizeUnshield(uint256 requestId, bytes abiEncodedCleartexts, bytes decryptionProof)
```

Events now emit `maturityTimestamp`; the current PoC ABI uses no separate calendar-month field.
