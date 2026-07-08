# Freedom Market Indexer

Small TypeScript indexer for options market state plus permissionless keepers
for ShieldBridge unshield finalization and matured series settlement.

It watches configured factory, matching-engine, and ShieldBridge contracts,
stores public event read models in PostgreSQL, and serves market-data APIs for
the frontend. Series storage is an indexed cache of `SeriesCreated` events, not
an off-chain source of truth.

It does not build calldata for normal user flows, relay user transactions,
custody user keys, receive confidential order terms, receive plaintext
confidential balances, or decrypt balances.

The only backend transaction paths are optional keeper calls to
`ShieldBridge.finalizeUnshield(...)` and Chainlink oracle adapter settlement
methods. The backend does not build or submit transactions for users.

## Scripts

```sh
npm install
npm run migrate
npm run dev
npm run build
npm test
```

## Config

Copy `.env.example` and set:

- `DATABASE_URL`
- `PORT`
- `HOST`
- `INDEXER_POLL_INTERVAL_MS`
- `KEEPER_POLL_INTERVAL_MS`
- `SETTLEMENT_KEEPER_POLL_INTERVAL_MS`
- `INDEXER_REWIND_BLOCKS`
- `INDEXER_MAX_BLOCK_RANGE`
- `CHAINS_JSON`

`CHAINS_JSON` contains local Anvil/Sepolia chain entries, RPC URLs,
confirmation depths, factory addresses, matching-engine addresses, bridge
addresses, optional contract start blocks, keeper settings, FHE public decrypt
settings, and optional cWETH/collateral addresses.

Settlement chain fields:

- `oracleAdapter`
- `settlementKeeperEnabled`
- `settlementKeeperPrivateKey`
- `settlementKeeperMinConfirmations`

Bridge config fields:

- `address`
- `publicFactory`
- `confidentialFactory`
- `startBlock`
- `keeperEnabled`
- `keeperPrivateKey`
- `minConfirmationsBeforeFinalize`

Keeper private keys are never returned from `/deployments`.

## Position Model

Public position responses include:

- event-derived activity from public `Split`, `Merge`, and `Redeemed` events
- live ERC20 `balanceOf` reads for indexed P/N token addresses

Event activity is not treated as complete when tokens can transfer outside
indexed factory events.

Public event amounts are exposed as raw integer strings. `Split.amount` and
`Merge.amount` are 6-decimal option-token units; `Redeemed.claim` is
18-decimal collateral base units for the configured payout asset.

Confidential balances are not tracked or inferred. Confidential APIs expose
only public series/listing/status metadata.

## Market Listings

Listings are not hidden, rejected, or deactivated just because the underlying
series is matured or settled. Maturity only makes a series eligible for
settlement, and settlement only fixes payout ratios. P/N tokens may remain
transferable until redeemed or burned.

Listing responses include indexed series metadata when available:

- `maturityTimestamp`
- `isMatured`
- `settled`
- `marketStatus`: `live` or `settled`
- `settlementPending`
- payout fields after settlement

Listing filters expose `settled=true|false` only. There is no separate Matured
market category. `settled=false` is Live and may temporarily include
matured-but-not-yet-settled series while the keeper catches up.

## Unshield Keeper

The keeper loop:

1. indexes `UnshieldRequested`
2. waits for configured confirmations
3. public-decrypts the emitted `burnedAmountHandle`
4. submits `finalizeUnshield(requestId, abiEncodedCleartexts, decryptionProof)`
5. waits for `UnshieldFinalized` indexing before marking the request finalized

The default public decrypt implementation is a service boundary that throws
`public decrypt unavailable / SDK not configured`. Wire a real Zama public
decrypt SDK implementation behind `publicDecryptHandle(...)` before enabling a
live keeper.

## Settlement Keeper

The settlement keeper:

1. uses indexed `SeriesCreated` rows as candidates
2. checks latest chain block timestamp, not local server time
3. verifies factory `getSeries(strikePrice, maturityTimestamp)` on-chain
4. calls the configured Chainlink adapter:
   - public: `settlePublic(factory, strikePrice, maturityTimestamp)`
   - confidential: `settleConfidential(factory, strikePrice, maturityTimestamp)`
5. waits for indexed factory `Settled` events to mark DB rows settled

The backend does not fetch, submit, or store current ETH prices before
settlement. The adapter owns price discovery by reading Chainlink on-chain.

The settlement keeper wallet only needs native ETH for gas. No LINK handling is
implemented.

Series maturities use the 10-minute PoC ABI: `maturityTimestamp` is the identity
field, and `seriesId = keccak256(abi.encode(strikePrice, maturityTimestamp))`.
The series table is an indexed cache of `SeriesCreated`/`Settled` events, not an
off-chain source of truth.
