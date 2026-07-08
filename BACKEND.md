# Freedom Protocol Market Watcher Spec

Freedom no longer needs a general backend server for core protocol actions.
Deposit, series creation, settlement, redeem, and confidential encryption are
client-side wallet flows.

The backend-like service in scope is a market watcher/indexer for data that can
become too large for browser-side event scans, plus a narrow permissionless
keepers for ShieldBridge unshield finalization and matured series settlement.

For the detailed working plan, also see:

- `temp_docs/MARKET_INDEXER.md`
- `temp_docs/FRONTEND_CLIENT_ONLY.md`
- `temp_docs/SMART_CONTRACT_CHANGES.md`

## Scope

In scope:

- Index series creation and settlement events.
- Index public market/order events once public market contracts exist.
- Index confidential listing metadata that is intentionally public.
- Serve read-only market, listing, and series APIs.
- Serve deployment metadata as a convenience.
- Index ShieldBridge unshield requests/finalizations.
- Optionally finalize ShieldBridge unshield requests after public decryption of
  the emitted burned amount handle.
- Optionally settle matured series through the configured Chainlink oracle
  adapter.

Out of scope:

- Transaction builders for deposits, splits, settlement, redeem, or trading.
- Relaying user transactions.
- Custodying keys.
- Decrypting confidential balances.
- Receiving confidential encrypted order intent before chain submission.
- Receiving encrypted confidential deposit amounts/proofs before chain
  submission.
- Acting as a dependency for Deposit or Settle.
- Transaction builders for normal user flows.
- Receiving frontend-submitted unshield clear amounts or decryption proofs.
- Accepting frontend/user-created series rows.
- Fetching or submitting oracle prices from the backend.

## Privacy Boundary

Confidential values are generated in the browser and submitted through the
wallet directly to chain.

Allowed:

```text
browser -> wallet -> chain
watcher -> reads public events from chain
frontend -> reads indexed market metadata from watcher
```

Not allowed:

```text
browser -> watcher: encrypted amount/proof/private order terms
watcher -> chain: relayed confidential transaction
```

Even encrypted payloads can leak useful metadata off-chain through timing,
network origin, request identity, and pre-inclusion order flow.

## Current Contract Model

Series identity is:

```text
chainId + factoryAddress + strikePrice + maturityTimestamp
```

On-chain `seriesId`:

```solidity
keccak256(abi.encode(strikePrice, maturityTimestamp))
```

Rules:

- `strikePrice` is a positive multiple of 50.
- `maturityTimestamp` is a uint64 Unix timestamp aligned to a 10-minute interval for the PoC.
- P/N token decimals are 6.
- `SCALE = 1_000_000`.
- Public `Split.amount` and `Merge.amount` are 6-decimal option-token units.
  Public `Redeemed.claim` is 18-decimal collateral base units for the emitted
  payout asset.

## Confidential Deposit Boundary

The watcher is not involved in confidential deposits.

Current verified sequence:

```text
1. Frontend authorizes factory.vault() on cWETH.
2. Frontend encrypts deposit amount for factoryAddress + userAddress.
3. Wallet calls confidential factory split/createSeriesAndSplit.
4. Factory consumes externalEuint64/proof once.
5. Factory/vault/cWETH pass internal encrypted handles.
```

cWETH authorization can be:

- allowance mode: encrypted `approve(vault, encAllowance, proof)` on cWETH.
- operator mode: ERC7984-style `setOperator(vault, until)`.
- none: dev/testing only.

The watcher should only see resulting public events.

## ShieldBridge Keeper Boundary

Unshield finalization is the one backend transaction path. It is allowed because
`ShieldBridge.unshield(...)` intentionally requests public decryption of the
actual burned amount before public tokens are minted.

Allowed:

```text
user -> wallet -> ShieldBridge.unshield(...)
watcher -> indexes UnshieldRequested(... burnedAmountHandle)
keeper -> public-decrypts burnedAmountHandle
keeper -> calls ShieldBridge.finalizeUnshield(...)
watcher -> indexes UnshieldFinalized
```

Not allowed:

```text
frontend -> watcher: clear amount/proof for finalization
frontend -> watcher: confidential intent or private order data
watcher -> user-decrypt confidential balances
```

The keeper must only public-decrypt the `burnedAmountHandle` emitted in
`UnshieldRequested`.

## Settlement Keeper Boundary

Factories store series in mappings, so the backend discovers series only by
indexing `SeriesCreated` events. The series table is a cache of contract events,
not a separate source of truth and not populated by user POST requests.

The settlement keeper may call a configured `ChainlinkEthUsdOracleAdapter` for
matured, unsettled indexed series:

```text
watcher -> indexes SeriesCreated
keeper -> reads latest chain block timestamp
keeper -> verifies factory.getSeries(strikePrice, maturityTimestamp)
keeper -> calls adapter.settlePublic(...) or adapter.settleConfidential(...)
watcher -> indexes factory Settled event
```

The backend must not fetch ETH/USD prices, store current prices before
settlement, or submit oracle prices. The adapter reads Chainlink on-chain and
calls the factory settlement method. The settlement keeper wallet only needs
native ETH for gas.

## Market Listing State

Maturity must not remove a listing from the market. Users may sell matured
series tokens, and settled P/N tokens may remain transferable until they are
redeemed or burned.

Market list views should use only:

- All
- Live: `settled = false`; this can include matured-but-not-yet-settled series
- Settled: `settled = true`

Do not expose a separate Matured filter by default. Listing APIs may include
`maturityTimestamp`, `isMatured`, and settlement metadata, but listings become
inactive only when cancelled, filled, explicitly expired by listing terms, or
invalid because the token/balance is no longer available.

## Data To Index

Factories:

- `SeriesCreated`
- `Split`
- `Merge`
- `Settled`
- `Redeemed`

Confidential matching engine:

- `ListingCreated`
- `FillAttempted`
- `ListingCancelled`

ShieldBridge:

- `UnshieldRequested`
- `UnshieldFinalized`
- `Shielded` may be indexed later as history

Future public market contracts:

- order created
- order cancelled
- order filled
- swap/fill events

Confidential events must not be enriched with plaintext amounts unless the
contract itself intentionally emits those values.

## Suggested API

Read-only endpoints:

```text
GET /health
GET /chains
GET /deployments
GET /series?chainId=&factory=&mode=&strike=&maturityTimestamp=
GET /series/:id
GET /markets/listings?chainId=&seriesId=&side=&mode=&active=
GET /markets/listings/:id
GET /markets/user/:address/listings?chainId=&mode=
GET /bridges/requests?chainId=&bridge=&user=&status=
GET /bridges/requests/:id
```

Optional:

```text
GET /markets/summary?chainId=&seriesId=
GET /markets/recent-fills?chainId=&seriesId=
```

No transaction-builder endpoints for MVP.

## Storage

Minimum tables:

- `chains`
- `factories`
- `series`
- `market_listings`
- `indexer_cursors`

Every indexed row should include:

- `chain_id`
- relevant contract address
- block number
- transaction hash
- log index where applicable

Use idempotent upserts so replays are safe.

## Reorg Handling

- Index confirmed/safe blocks where possible.
- Store cursor per chain/contract/event group.
- Rewind a configurable block window on startup.
- Make confirmation depth configurable per chain.

## Deployment Config

Support local Anvil and Sepolia:

```json
{
  "chains": [
    {
      "chainId": 31337,
      "name": "local",
      "rpcUrl": "http://127.0.0.1:8545",
      "factories": []
    },
    {
      "chainId": 11155111,
      "name": "sepolia",
      "rpcUrl": "https://...",
      "factories": []
    }
  ]
}
```

The frontend may use this endpoint for convenience, but Deposit and Settle must
still work from local/runtime deployment config when the watcher is unavailable.

## Recommended Stack

- TypeScript.
- Node.js.
- `viem` for logs and ABI decoding.
- PostgreSQL for persistence.
- Fastify or Hono for read-only HTTP API.

Keep this service small. It is an indexer, not an application server.

## Success Criteria

- Deposit and Settle work without the watcher.
- Trade page can use watcher data once market indexing exists.
- No confidential intent is sent to the watcher before chain submission.
- Indexer can restart and recover from its cursors.
- Series and listings are keyed by chain and source contract, not only by
  strike/maturity.
