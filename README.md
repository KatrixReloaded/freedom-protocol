# Freedom Protocol

Freedom is an ETH-backed options market inspired by Vitalik Buterin's research on building index-tracking assets on top of options instead of debt. Users split ETH/WETH exposure into two complementary tokens:

- **P / stableETH**: the strike-linked stable side.
- **N / upETH**: the residual upside side.

Together, `1 P + 1 N` always represents the deposited collateral. There is no borrow position, liquidation engine, liquidation penalty, or centralized stablecoin issuer.

## Short Description

Freedom is a dual-mode options protocol that turns ETH collateral into stableETH and upETH positions. Public mode creates normal ERC-20 P/N tokens for transparent DeFi use, while confidential mode uses Zama fhEVM so balances, listing sizes, and trade terms stay encrypted during private market making.

## Live Demo

- Frontend: add deployed Vercel URL here
- Backend API: <https://freedom-backend-dowc.onrender.com>
- Network: Ethereum Sepolia / Zama Sepolia testnet

## Why Freedom

Stablecoins like USDC and USDT introduce issuer, banking, censorship, and regulatory risk. CDP-style alternatives like DAI avoid some issuer risk but add liquidation complexity and penalty risk.

Freedom takes a different route: options instead of debt. ETH collateral is split into two complementary claims. P holders choose stable exposure; N holders accept downside risk in exchange for upside. The system remains solvent by construction because payouts are bounded by the deposited collateral.

## Core Mechanism

For a series with strike `S` and maturity `M`, a user deposits collateral and receives equal amounts of P and N.

At maturity, the oracle resolves ETH/USD price `x`:

```text
P payout = min(1, S / x)
N payout = max(0, 1 - S / x)
```

The invariant is:

```text
P payout + N payout = 1 unit of collateral
```

## Modes

### Public Mode

Public mode mints normal ERC-20 P/N tokens backed by ETH or WETH.

Main flow:

1. Deposit ETH or WETH.
2. Mint matching P and N ERC-20 tokens.
3. Trade or transfer tokens openly.
4. Settle after maturity through the oracle adapter.
5. Redeem P or N for ETH/WETH based on the final payout rate.

Public mode is transparent and composable with existing DeFi infrastructure.

### Confidential Mode

Confidential mode uses Zama fhEVM confidential tokens for private balances and private trade terms.

Main flow:

1. Wrap/shield collateral into cWETH or another confidential quote token.
2. Deposit cWETH into a confidential series.
3. Mint encrypted P and N balances.
4. Create private listings with encrypted size and encrypted minimum receive.
5. Buyers submit encrypted offers.
6. The matching engine uses FHE checks to execute only when the offer meets or exceeds the seller's encrypted minimum and the listing has enough encrypted size.

The backend indexes markets and runs keepers, but encrypted trade intents are not posted to the backend.

## Architecture

```text
contracts/   Solidity protocol contracts, factories, tokens, bridge, matching engine
frontend/    Static browser app for deposit, settle, shield, and trade flows
backend/     Fastify indexer API, settlement keeper, unshield keeper, PostgreSQL persistence
temp_docs/   Implementation notes and remaining-work docs
```

## Key Features

- ETH/WETH-backed P/N split tokens.
- Public ERC-20 flow for transparent deposits and redemption.
- Confidential P/N flow on Zama fhEVM.
- Private market listings with encrypted amount and encrypted terms.
- Backend market indexer for active series, listings, bridge requests, and keeper state.
- Settlement keeper for matured series.
- Unshield keeper with Zama public decrypt integration.
- Frontend support for cWETH and cUSDC quote tokens in confidential trade.

## Current Sepolia Configuration

The current deployment tuple is configured through frontend and backend env/config files. The live backend endpoint is:

```text
https://freedom-backend-dowc.onrender.com
```

For the latest contract addresses, check:

- `frontend/deployment-config.mjs`
- `backend/.env.example`
- `contracts/deployments/`

Do not commit private keys or local `.env` files.

## Frontend

The frontend is a static app.

```bash
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix frontend run dev
```

Important env var for hosted frontend:

```env
FREEDOM_MARKET_API_URL=https://freedom-backend-dowc.onrender.com
```

For Vercel:

```text
Root Directory: frontend
Framework Preset: Other
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

## Backend

The backend is a Fastify service backed by PostgreSQL.

```bash
npm --prefix backend install
npm --prefix backend run build
npm --prefix backend start
```

Useful scripts:

```bash
npm --prefix backend run dev
npm --prefix backend run migrate
npm --prefix backend test
```

Required production env:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=10000
DATABASE_URL=postgres://...
CHAINS_JSON={...}
```

Keeper support is configured inside `CHAINS_JSON`:

```json
{
  "settlementKeeperEnabled": true,
  "settlementKeeperPrivateKey": "0x...",
  "bridges": [
    {
      "keeperEnabled": true,
      "keeperPrivateKey": "0x..."
    }
  ]
}
```

Keep these keys only in hosted environment variables.

## Contracts

Contracts use Foundry.

```bash
cd contracts
forge build
forge test
```

The protocol includes:

- public option factory and ERC-20 option tokens;
- confidential option factory and confidential option tokens;
- confidential matching engine;
- shield bridge;
- Chainlink oracle adapter;
- cWETH/cUSDC integration points for confidential collateral and quote tokens.

## Standards And Tooling

- ERC-20 style public tokens.
- ERC-7984-style confidential token flows.
- EIP-712 typed data for Zama user decrypt.
- CREATE2/minimal-clone style deterministic token deployment.
- Zama fhEVM operations including encrypted inputs, `FHE.fromExternal`, `FHE.allow`, `FHE.allowThis`, comparisons, and encrypted transfer flows.
- Zama relayer SDK for user decrypt and public decrypt flows.

## Demo Notes

For a live demo, use Sepolia-funded wallets and expect public testnet RPC latency. Render free instances may spin down after inactivity, so the first backend request can be slow.

The Shield page may be hidden from navigation during the hackathon demo, but the route and backend keeper flow remain part of the protocol.

## Security Notes

- Backend does not custody user keys.
- Frontend submits user transactions directly through the connected wallet.
- Backend indexes chain events and runs keeper transactions only from configured keeper keys.
- Never commit `.env` files, private keys, relayer secrets, or funded wallet credentials.

## Status

This is hackathon software. Public deposit/settle/redeem and confidential market flows are the primary demo paths. Some production-hardening items remain, including deeper retention policies, production monitoring, and final bridge/collateral conversion refinements.
