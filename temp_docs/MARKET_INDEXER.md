# Market Watcher / Indexer

The project does not need a general backend server for core protocol actions.
The frontend should form transactions client-side and submit them through the
user's wallet.

The one backend-like service worth keeping is a watcher/indexer for the options
market, because orders/listings/fills can become too large and expensive for a
browser to scan directly.

## Scope

In scope:

- Index public market/order events.
- Index confidential listing metadata that is intentionally public.
- Index series creation events for fast lookup.
- Serve market data to the frontend.
- Serve read-only APIs.

Out of scope:

- Building or signing user transactions.
- Custodying keys.
- Receiving plaintext confidential trade intent.
- Receiving encrypted confidential order parameters before they are submitted
  on-chain.
- Decrypting confidential balances.
- Acting as a required dependency for deposit, split, settle, or redeem.

## Privacy Boundary

For confidential mode, the user's browser should generate encrypted inputs and
proofs locally and submit them directly to the chain through the wallet.

Avoid this pattern:

```text
browser -> server: encrypted amount, encrypted min receive, proof
server -> chain: create listing
```

Even if the data is encrypted, sending intended encrypted order details to an
off-chain server creates metadata risk:

- IP address and timing correlation.
- Address/order association before chain submission.
- Server-side censorship or order flow leakage.
- Extra trust assumption for private strategy flow.

Preferred pattern:

```text
browser -> wallet -> chain
watcher -> reads emitted public metadata from chain
frontend -> reads indexed public market data from watcher
```

The watcher only learns what the chain already reveals.

For confidential deposit specifically, the browser encrypts the deposit amount
for the factory address and submits it directly through the wallet. cWETH
authorization is handled separately by allowance-style encrypted approval or
ERC7984-style operator authorization. The watcher should not receive either
payload before chain inclusion.

## Canonical Identity

Every indexed row should be scoped by:

```text
chainId
factoryAddress
seriesId
strikePrice
maturityTimestamp
```

Do not key only by strike/maturity. WETH and cWETH factories may both have the
same strike/maturity series. Native ETH deposits into the public path are still
indexed as WETH collateral when the factory wraps ETH internally.

## Data Sources

Factories:

- `SeriesCreated`
- `Split`
- `Settled`
- `Redeemed`

Public `Split.amount` and `Merge.amount` are raw 6-decimal option-token units.
Public `Redeemed.claim` is raw 18-decimal collateral base units for the emitted
payout asset. Do not add these fields together without unit-aware conversion.

Public market/order contracts, if present:

- order created
- order cancelled
- order filled
- swap/fill events

Confidential matching engine:

- `ListingCreated`
- `FillAttempted`
- `ListingCancelled`

Confidential listing events should not reveal amount or minimum receive. The
indexer stores only public listing metadata.

## Suggested Database Schema

### `chains`

```text
chain_id bigint primary key
name text not null
rpc_url text not null
last_seen_block bigint
```

### `factories`

```text
id text primary key -- chainId:factoryAddress
chain_id bigint not null
address text not null
mode text not null -- public | confidential
collateral_symbol text not null -- WETH | cWETH
collateral_address text
created_at timestamptz not null
```

### `series`

```text
id text primary key -- chainId:factoryAddress:seriesId
chain_id bigint not null
factory_address text not null
series_id text not null
strike_price numeric not null
maturity_timestamp bigint not null
stable_token text not null
up_token text not null
mode text not null
collateral_symbol text not null
created_block bigint not null
created_tx text not null
settled boolean not null default false
oracle_price numeric
stable_payout numeric
up_payout numeric
settled_block bigint
settled_tx text
```

### `market_listings`

```text
id text primary key -- chainId:engineAddress:listingId
chain_id bigint not null
engine_address text not null
listing_id numeric not null
mode text not null -- public | confidential
series_id text not null
factory_address text
seller text
token text not null
token_side text not null -- P | N
quote_token text
active boolean not null
created_block bigint not null
created_tx text not null
cancelled_block bigint
cancelled_tx text
filled_block bigint
filled_tx text
```

For public markets, optional plaintext fields may be added:

```text
amount numeric
price numeric
min_receive numeric
remaining_amount numeric
```

For confidential markets, do not add plaintext amount fields unless the contract
emits them publicly.

### `indexer_cursors`

```text
chain_id bigint not null
contract_address text not null
event_group text not null
last_indexed_block bigint not null
primary key (chain_id, contract_address, event_group)
```

## API

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
```

Optional:

```text
GET /markets/summary?chainId=&seriesId=
GET /markets/recent-fills?chainId=&seriesId=
```

Do not add transaction builder endpoints for MVP. The frontend should encode
transactions directly from ABI/config.

## Reorg Handling

The watcher should be reorg-aware:

- Index only up to `safe`/confirmed blocks when possible.
- Store block number and transaction hash for every row.
- Use idempotent upserts.
- On startup, rewind a small number of blocks, e.g. 50 to 100.
- If a chain has deeper reorg risk, make confirmation depth configurable.

## Confidential Market Notes

The watcher can index:

- listing id
- seller
- token address
- token side
- quote token
- strike
- maturity timestamp
- active/cancelled/filled status

The watcher must not require:

- encrypted amount from the user before submission
- encrypted min receive from the user before submission
- decrypted amount
- decrypted balances
- private order intent

The frontend can use watcher data to show available listings, but filling a
listing still happens entirely client-side:

```text
user enters fill terms
browser encrypts values
wallet submits fill transaction
watcher later indexes FillAttempted/filled status from chain
```

## Deployment Config

The watcher needs static deployment config:

```json
{
  "chains": [
    {
      "chainId": 31337,
      "name": "local",
      "rpcUrl": "http://127.0.0.1:8545",
      "factories": [
        {
          "address": "0x...",
          "mode": "public",
          "collateralSymbol": "WETH"
        }
      ],
      "matchingEngines": [
        {
          "address": "0x...",
          "mode": "confidential"
        }
      ]
    },
    {
      "chainId": 11155111,
      "name": "sepolia",
      "rpcUrl": "https://...",
      "factories": [],
      "matchingEngines": []
    }
  ]
}
```

The frontend can consume this deployment config from either:

- a checked-in JSON file for local/dev environments, or
- the watcher `/deployments` endpoint.

Core protocol actions should still work if the watcher is unavailable, assuming
the frontend has deployment addresses.

## Recommended Stack

- TypeScript.
- Node.js.
- `viem` for logs and ABI decoding.
- PostgreSQL for persistent indexing.
- Fastify or Hono for read-only HTTP API.

Keep the service small. It is an indexer, not an app server.

## Success Criteria

- Deposits and settlement work without the watcher.
- Trade page market listing discovery uses the watcher when available.
- Confidential user intent is never sent to the watcher before chain submission.
- Indexed market views recover after restarts.
- Series and listing rows are keyed by `chainId + factory/engine + ids`.
