# Freedom Protocol

**Dual-mode options protocol: public ERC-20s on any EVM + confidential mode on Zama fhEVM**

Based on [Vitalik's ethresear.ch proposal](https://ethresear.ch/t/building-index-tracking-assets-on-top-of-options-instead-of-debt/25036) — "Building index-tracking assets on top of options instead of debt" (June 1, 2026).

---

## Overview

Freedom replaces collateralized debt positions (CDPs) with an options-based split-token mechanism. No liquidations, no real-time oracles, no debt.

A user deposits ETH (or WETH) and mints two complementary tokens — **stableETH (P)** and **upETH (N)** — parameterized by a strike price S and maturity date M. These two tokens always sum back to the deposited collateral, regardless of price movements. There is no scenario where liabilities exceed assets — the system is solvent by construction, making liquidations impossible.

The protocol operates in **two modes**:

- **Public mode** — Standard ERC-20 tokens on any EVM chain. Plaintext balances, composable with all of DeFi. This is the primary mode for most users and where the stablecoin replacement thesis lives.
- **Confidential mode** — Encrypted tokens on Zama fhEVM. Position sizes, trade terms, and balances are hidden. For users who need privacy: large positions, institutional rebalancing, MEV protection.

Both modes share the same core mechanism (P/N split, settlement formula, P+N=1 invariant). They differ only in token standard and trading infrastructure.

---

## The Stablecoin Replacement Thesis

**Public P tokens are the point of the protocol.** They replace centralized stablecoins like USDC.

Today's dominant stablecoins (USDC, USDT) concentrate counterparty risk in centralized issuers — Circle holds bank deposits, Tether holds treasuries and commercial paper. Every DeFi protocol that uses USDC inherits Circle's regulatory risk, banking risk, and censorship capability. This is the opposite of decentralization.

Vitalik's thesis: "true DeFi" means **transferring USD counterparty risk to willing market makers** (N holders) instead of concentrating it in a centralized issuer. Freedom implements this directly:

- **P is algorithmic** — backed by ETH locked in a smart contract, not a bank account
- **No centralized issuer** — no Circle, no Tether, no single entity that can freeze your stablecoin
- **No regulatory single point of failure** — no bank that can be shut down, no entity that can be sanctioned
- **Counterparty risk is distributed** — N holders voluntarily take on ETH downside risk in exchange for leveraged upside; P holders get stability in exchange for quadratic drift risk in extreme scenarios
- **P is a standard ERC-20** — composable with Uniswap, Aave, Compound, Curve, and every other DeFi protocol

The tradeoff vs. USDC: P is not a hard peg. It drifts in extreme scenarios (ETH drops below the strike). But P holders control this risk through strike selection and rebalancing — they are never liquidated, never frozen, never subject to a centralized issuer's decisions.

**P tokens flow through DeFi like any other ERC-20:**
- Trade P/USDC on Uniswap
- Supply P as collateral on Aave or Compound
- Use P in Curve pools alongside other stablecoins
- LP with P on any AMM
- Use P for payments, settlement, or anywhere you'd use a stablecoin

This composability is why public mode is primary. Confidential P tokens on fhEVM are useful for privacy, but they cannot plug into the existing DeFi ecosystem without unshielding first.

---

## Why Two Modes

| | Public Mode | Confidential Mode |
|---|---|---|
| **Chain** | Any EVM (Ethereum, Arbitrum, Base, etc.) | Zama fhEVM only |
| **Token standard** | Standard ERC-20 (OpenZeppelin) | ConfidentialERC20 (ERC-7984) |
| **Balances** | Plaintext | Encrypted |
| **Trading** | Public orderbook/DEX, AMM pools | Blind matching engine (FHE-verified) |
| **DeFi composability** | Full — works with Uniswap, Aave, Compound, etc. | None (must unshield first) |
| **MEV protection** | None — standard EVM transparency | Full — positions and trades are encrypted |
| **Position privacy** | None — balances are public | Full — nobody sees your position |
| **Contract complexity** | Simple — standard Solidity | Complex — FHE operations |
| **Gas costs** | Standard EVM gas | Higher (FHE computation) |
| **Best for** | Most users, DeFi integration, stablecoin use | Large positions, institutional, rebalancing privacy |

**The tradeoff is composability vs. privacy.** Public P tokens can be used everywhere in DeFi but expose your position. Confidential P tokens hide your position but are trapped on fhEVM until unshielded.

Most users should use public mode. Confidential mode exists for specific use cases where privacy justifies the reduced composability and higher costs:
- Institutional positions large enough that visibility creates MEV risk
- Rebalancing operations where front-running is a concern
- Users who need position privacy for competitive or regulatory reasons

---

## Core Mechanism

The core mechanism is identical in both modes. The only difference is whether values are plaintext or encrypted.

### Parameters

- **T** — Price index denominated in ETH (e.g., USD/ETH)
- **S** — Strike price, chosen at mint time (same units as T)
- **M** — Maturity date (unix timestamp)

### Split and Merge

- **Split:** Lock collateral (WETH or cWETH) → Mint equal amounts of stableETH(S, M) + upETH(S, M)
- **Merge:** Before settlement, burn equal amounts of stableETH(S, M) + upETH(S, M) → redeem collateral

A (P, N) pair can be recombined into collateral at any time before maturity. At maturity, settlement preserves the same pair invariant: **1 P + 1 N redeems for exactly 1 unit of collateral**. There is no debt, no borrow, no collateral ratio.

### Settlement Formula

At maturity M, an oracle resolves T to value x:

```
stableETH (P) receives: min(1, S / x) collateral
upETH (N) receives:     max(0, 1 - S / x) collateral
```

**Key invariant: P + N = deposited collateral, always.** This is why liquidation is impossible — the collateral perfectly backs both sides at all times.

For one matched pair at maturity:

```
P payout + N payout = min(1, S / x) + max(0, 1 - S / x) = 1 collateral
```

---

## Public Mode (Any EVM Chain)

### Deposit Flow

```
Native ETH or WETH/ERC-20 collateral → deposit into Freedom → mint P + N (standard ERC-20s)
```

The public implementation supports native ETH (`collateralToken = address(0)`) or an ERC-20 collateral token such as WETH. No encryption, no shielding. All values are plaintext.

### Token Standard

Public P and N tokens are **standard ERC-20s** built with OpenZeppelin. No FHE, no encrypted balances. They work on any EVM chain — Ethereum mainnet, Arbitrum, Base, Optimism, Polygon, etc.

```
stableETH-1000-AUG26   <-- standard ERC-20
upETH-1000-AUG26       <-- standard ERC-20
```

### Trading

Public P and N tokens trade on **any existing DeFi infrastructure**:

- **DEX/AMM:** List P/USDC or N/USDC pairs on Uniswap, Curve, Balancer
- **Orderbook DEX:** Trade on dYdX, Serum, or any on-chain orderbook
- **OTC:** Direct peer-to-peer transfers (standard ERC-20 `transfer`)
- **Aggregators:** Accessible via 1inch, Paraswap, etc.

All values are plaintext. Prices, amounts, and order terms are visible on-chain. This is standard EVM behavior — no different from trading any other ERC-20.

### Settlement

At maturity, the oracle resolves the final price. Payouts are computed in plaintext:

```
P payout = min(1, S / oraclePrice) collateral per P token
N payout = max(0, 1 - S / oraclePrice) collateral per N token
```

User calls `redeem()` → burns P or N tokens → receives the public collateral asset. Simple, cheap, standard Solidity math.

### Visibility

Everything is public. Balances, trade amounts, order terms, settlement amounts — all plaintext, all on-chain. This is the cost of full DeFi composability.

---

## Confidential Mode (Zama fhEVM Only)

### Deposit Flow

```
Native ETH → wrap to WETH → shield to cWETH (ERC-7984) → deposit into Freedom → mint confidential P + N
```

### Token Standard

Confidential P and N tokens are **ConfidentialERC20** tokens on Zama fhEVM. All balances are encrypted (`euint64`). Each (strike, maturity) pair deploys as its own ConfidentialERC20 contract.

```
stableETH-1000-AUG26   <-- ConfidentialERC20
upETH-1000-AUG26       <-- ConfidentialERC20
```

### Trading: Blind Matching Engine

Instead of pools or a traditional orderbook, confidential mode uses a **blind matching** system where the contract verifies trade compatibility using FHE without either party seeing the other's terms.

Both P and N can be listed for sale against any confidential quote token (cUSDC, cDAI, cWETH, etc.).

#### Flow

```
1. Seller creates a LISTING
   - Public: token type (P or N), series (strike, maturity), quote token
   - Encrypted: locked amount, minimum acceptable payment
   - Open to any buyer — no counterparty specified

2. Buyer submits a FILL attempt
   - Encrypted: payment amount, expected token amount
   - Both escrowed by the contract

3. Contract verifies match via FHE
   - Check 1: buyer's payment >= seller's minimum?
   - Check 2: seller's locked amount >= buyer's expected amount?

4. If both pass: atomic swap, excess refunded
5. If either fails: full refund to both, nothing leaked
```

### Settlement

At maturity, the oracle resolves the final price (plaintext). The contract computes payout rates in plaintext (they are derivable from public strike + public oracle price), then encrypts them for use in per-user redemption. Each user's encrypted balance is multiplied by the rate using FHE, and the result is transferred as encrypted cWETH.

### Why Confidential?

Vitalik's proposal has an acknowledged weakness: users must periodically rebalance (roll into new strikes as price moves), which exposes them to front-running and MEV on transparent chains. Confidential tokens eliminate this — nobody can see your position size, your strike selection, or when you're rolling.

---

## Unshield Bridge: Confidential → Public

The unshield bridge is a one-way operation that converts confidential P or N tokens into their public equivalents. This enables confidential users to access DeFi composability when they choose to.

### Mechanism

```
Confidential P/N (fhEVM) → Burn → Mint equivalent Public P/N (target EVM)
```

1. User calls `unshield()` on the confidential token contract
2. The encrypted amount is decrypted (revealed)
3. The confidential tokens are burned on fhEVM
4. Equivalent public P/N tokens are minted on the target chain
5. The amount is now plaintext — privacy for this position is forfeited

### Properties

- **One-way only:** You can unshield confidential → public, but not re-shield public → confidential. Once the amount is revealed, you cannot un-reveal it.
- **Reveals the amount:** The unshielding operation necessarily exposes the position size. The user is making a deliberate choice to trade privacy for composability.
- **Same series:** The public tokens have the same strike and maturity as the confidential ones. They are fungible with other public tokens of the same series.
- **Cross-chain:** If public mode runs on a different chain than fhEVM, the bridge requires a cross-chain message (burn on fhEVM, mint on target chain). If both run on the same chain, it is a local burn-and-mint.

### Use Cases

- Confidential user wants to LP with their P tokens on Uniswap
- Institutional user has finished accumulating and wants to deploy P into Aave
- User wants to sell P on a public DEX for better liquidity than blind matching offers

---

## How stableETH (P) and upETH (N) Work

### stableETH (P) — The Stable / Long-USD Side

P receives `min(1, S/x)` collateral at maturity.

When ETH price x is **above the strike S**:
- P receives `S/x` collateral
- In USD terms: `(S/x) * x = $S`
- **P perfectly tracks $S in USD value** as long as ETH stays above the strike

When ETH price x **drops below the strike S**:
- P receives the full 1 unit of collateral (capped at 1)
- But that collateral is only worth `$x`, which is less than `$S`
- P **drifts away from its USD target** — smoothly, not suddenly

This smooth degradation is called **quadratic drift**. It is the key tradeoff vs. CDPs: instead of sudden total position loss (liquidation), P experiences a gradual erosion of USD-denominated value. The user retains full control over when to rebalance.

### upETH (N) — The Leveraged / Long-ETH Side

N receives `max(0, 1 - S/x)` collateral at maturity.

When ETH price x is **above the strike S**:
- N receives `(1 - S/x)` collateral
- In USD terms: `(1 - S/x) * x = x - S` dollars
- **N profits as ETH goes up**, capturing all upside above the strike
- N is essentially a **call option on ETH** with strike S

When ETH price x **drops to or below the strike S**:
- N receives 0
- N goes to zero

### P is NOT an accounting stablecoin

P tracks $S in USD terms under normal conditions, but it is **not** "1 P = $1" and should never be treated as such. It drifts in extreme scenarios. You cannot use it for accounting, payments, or anywhere that requires a hard peg. It provides **price stability**, not **unit-of-account precision**.

This is an acceptable tradeoff for eliminating centralized issuer risk. USDC gives you a hard peg but concentrates all risk in Circle. P gives you a soft peg with quadratic drift but distributes risk across willing market participants.

---

## Numerical Example: 5 ETH at $2000, Strike = $1000

The user deposits 5 ETH (as WETH or cWETH) → mints **5 stableETH + 5 upETH** with S = $1000, M = 2 months out.

Strike selection: Vitalik recommends `S < current_price / 2`. At $2000, choosing S = $1000 means ETH must fall 50% before P starts losing USD value.

### Payoffs at maturity

| ETH price (x) | P per token (collateral) | P total (USD) | N per token (collateral) | N total (USD) |
|---|---|---|---|---|
| $4,000 | min(1, 0.25) = 0.25 | $5,000 | 0.75 | $15,000 |
| $2,000 | min(1, 0.50) = 0.50 | $5,000 | 0.50 | $5,000 |
| $1,000 | min(1, 1.00) = 1.00 | $5,000 | 0.00 | $0 |
| $500 | min(1, 2.00) = 1.00 | $2,500 (drift) | 0.00 | $0 |
| $250 | min(1, 4.00) = 1.00 | $1,250 (drift) | 0.00 | $0 |

At $4000, $2000, and $1000: P delivers exactly $5,000 (= 5 x $1,000 strike).
At $500: P holds all 5 units of collateral but that's only worth $2,500 — this is the quadratic drift.
At all prices: **5 P + 5 N = 5 units of collateral at maturity**. Equivalently, each matched `1 P + 1 N` pair redeems for exactly `1` ETH/WETH/cWETH unit. No liquidation.

---

## The Two-Sided Market

When a user mints P + N, they sell whichever side doesn't match their goal:

### Stability seeker (keep P, sell N)

> Deposit ETH → mint P + N → sell N to ETH bulls for USDC/cash → hold P for USD-stable exposure

The buyer of N is an ETH bull. They pay a market price for N (less than 1 ETH, since P claims some of that ETH). In return they get outsized ETH upside — a leveraged call option.

### ETH bull (keep N, sell P)

> Deposit ETH → mint P + N → sell P to stability seekers for USDC/cash → hold N for leveraged ETH exposure

The buyer of P is a stability seeker. They pay a market price for P (approximately $S in value) and get a position that tracks $S as long as ETH stays above the strike.

### Natural matching

These two user types are direct counterparties. The protocol creates a marketplace where stability demand and ETH bullishness are matched on-chain, with no centralized issuer, no lending desk, and no liquidation bot.

In **public mode**, this matching happens on existing DEXs — Uniswap, Curve, orderbook exchanges — wherever liquidity forms around P and N tokens.

In **confidential mode**, this matching happens through the blind matching engine, with position sizes and trade terms encrypted.

---

## How It Replaces Lending

### Traditional flow (CDP):
> Deposit 1 ETH → Borrow stablecoin → Risk liquidation if ETH drops

### Freedom flow (stability seeker):
> Deposit 1 ETH → Mint P + N → Sell N for ~$(price - S) worth of USDC → Hold P (tracks ~$S in USD)

### Freedom flow (ETH bull wanting leverage):
> Deposit 1 ETH → Mint P + N → Sell P for ~$S worth of USDC → Hold N (leveraged call on ETH)

Same economic exposures as lending/borrowing, but:
- No debt
- No liquidation trigger
- No real-time oracle dependency
- No centralized issuer risk (public mode)
- No position visible on-chain (confidential mode)

---

## Rebalancing Strategy

P holders should hold **deep in-the-money** positions (strike well below current price). Vitalik's recommendation:

> If current price is X, hold P with S < X/2 and M 1-2 months out.
> If price drops below S * 1.5, rotate into P with S' < new_price / 2.

**Rotation** means:
1. Sell current P(S, M) tokens on the market
2. Buy new P(S', M') tokens with a lower strike and fresh maturity
3. This keeps USD exposure intact as price moves

In **public mode**, rotation happens on standard DEXs. The tradeoff: your rebalancing is visible, which creates potential MEV. The mitigation is gradual auctions (TWAP orders, batch auctions) rather than instantaneous swaps.

In **confidential mode**, rotation is fully private — nobody sees when you're rolling strikes, what strike you're moving to, or how large your position is. This eliminates the MEV vector entirely.

**Rebalancing cost** is the main practical concern in both modes. If users lose >2% per year from slippage when rolling, the system becomes uncompetitive vs. existing stablecoins. Vitalik notes that "ultra narrow spreads for rolling" are needed, executed via gradual auctions rather than instantaneous swaps.

---

## Quadratic Drift vs. Liquidation

| Property | CDP (Aave/Maker) | Freedom (P/N) |
|---|---|---|
| Normal conditions | Full USD exposure | Full USD exposure |
| Extreme price drop | Sudden, total position loss (liquidation) | Smooth drift away from USD target |
| User control | None — protocol liquidates you | Full — you choose when to rebalance |
| Oracle requirement | Real-time, binding, instant | Slow, resolved only at maturity |
| Flash loan / manipulation | High risk (triggers liquidations) | Low risk (no liquidation trigger) |
| Accounting stablecoin? | Yes (1 DAI = $1 enforced) | No (P drifts, not a hard peg) |
| Centralized issuer risk | Depends (DAI partial, USDC full) | None |

The quadratic drift is the cost of eliminating liquidations. In practice, the P holder avoids drift entirely by rebalancing before price approaches the strike.

---

## Slow Oracles

Because P + N = 1 unit of collateral by construction, the system doesn't need an oracle to decide when to liquidate. The oracle is only needed **once, at maturity M**, to resolve the final price and distribute payouts.

This means the protocol can use **prediction-market-style oracles** which:
- Allow extended dispute windows (hours or days, not seconds)
- Support human recourse in case of manipulation
- Are not vulnerable to flash loan attacks (no instant binding price)
- Are already battle-tested in production

This is categorically safer than real-time Chainlink-style oracles. The entire oracle security model is upgraded as a direct consequence of removing liquidations.

This applies to both public and confidential modes — neither requires a real-time oracle.

---

## Token Design

### ERC-20s, not NFTs

All stableETH/upETH tokens with the **same (strike, maturity)** are fungible. Users can sell partial positions.

**Public mode:** Each (strike, maturity) pair deploys as a standard ERC-20 contract (OpenZeppelin).

```
stableETH-1000-AUG26   <-- standard ERC-20
upETH-1000-AUG26       <-- standard ERC-20
```

**Confidential mode:** Each (strike, maturity) pair deploys as a ConfidentialERC20 contract (ERC-7984).

```
stableETH-1000-AUG26   <-- ConfidentialERC20
upETH-1000-AUG26       <-- ConfidentialERC20
```

### Fragmentation Mitigation

- Standardized strikes at set intervals (e.g., round numbers, S < price/2)
- Rolling maturities — monthly or bi-monthly only
- Factory pattern deploys new pairs on demand (separate factories for public and confidential)

---

## Visibility Map

### Public Mode

#### Deposit & Minting (Split)

| Value | Visibility | Reason |
|---|---|---|
| ETH/ERC-20 collateral deposit amount | **Public** | Native value or standard ERC-20 transfer |
| stableETH minted amount | **Public** | Standard ERC-20 mint |
| upETH minted amount | **Public** | Standard ERC-20 mint |
| Strike price | **Public** | Defines the token series |
| Maturity date | **Public** | Defines the token series |

#### User Balances

| Value | Visibility | Reason |
|---|---|---|
| ETH/ERC-20 collateral balance | **Public** | Native balance or standard ERC-20 |
| stableETH balance | **Public** | Standard ERC-20 |
| upETH balance | **Public** | Standard ERC-20 |

#### Trading

| Value | Visibility | Reason |
|---|---|---|
| All trade values | **Public** | Standard DEX/orderbook, plaintext |

#### Settlement

| Value | Visibility | Reason |
|---|---|---|
| Oracle price at maturity | **Public** | Needed to compute payouts |
| Payout rates | **Public** | Computed from public strike + public oracle price |
| Individual redemption amounts | **Public** | Standard ERC-20 math |

**Summary:** Everything is public. This is the cost of full DeFi composability.

### Confidential Mode

#### Deposit & Minting (Split)

| Value | Visibility | Reason |
|---|---|---|
| cWETH deposit amount | **Encrypted** | Confidential ERC-7984 transfer |
| stableETH minted amount | **Encrypted** | ConfidentialERC20 |
| upETH minted amount | **Encrypted** | ConfidentialERC20 |
| Strike price | **Public** | Defines the token series, needed for fungibility |
| Maturity date | **Public** | Defines the token series, needed for fungibility |

#### User Balances

| Value | Visibility | Reason |
|---|---|---|
| cWETH balance | **Encrypted** | ERC-7984 |
| stableETH balance | **Encrypted** | ConfidentialERC20 |
| upETH balance | **Encrypted** | ConfidentialERC20 |

#### Listing (Seller Posts an Offer)

| Value | Visibility | Reason |
|---|---|---|
| Token being sold (stableETH or upETH) | **Public** | Buyer needs to know what's for sale |
| Strike price | **Public** | Buyer needs to know the series |
| Maturity date | **Public** | Buyer needs to know the series |
| Quote token (cUSDC, cDAI, etc.) | **Public** | Buyer needs to know what to pay with |
| Amount for sale | **Encrypted** | Hides position size |
| Minimum acceptable payment | **Encrypted** | Hides seller's price floor |

#### Fill (Buyer Attempts a Trade)

| Value | Visibility | Reason |
|---|---|---|
| Which listing they're filling | **Public** | Necessary to route the tx |
| Payment amount (cUSDC) | **Encrypted** | Hides buyer's size |
| Expected receive amount | **Encrypted** | Hides buyer's terms |
| Match result (success/fail) | **Encrypted** | Observer can't tell if trade went through |
| Transfer amounts | **Encrypted** | All ConfidentialERC20 transfers |
| Refund amounts | **Encrypted** | Computed via FHE, returned encrypted |

#### Settlement (At Maturity)

| Value | Visibility | Reason |
|---|---|---|
| Oracle price at maturity | **Public** | Needed to compute payouts |
| stableETH payout rate | **Encrypted** | Computed via FHE: min(SCALE, S*SCALE/x) |
| upETH payout rate | **Encrypted** | Computed via FHE: SCALE - stablePayout |
| Individual redemption amounts | **Encrypted** | User's balance * rate, all in FHE |
| cWETH received after redeem | **Encrypted** | ConfidentialERC20 transfer |

**Summary — Public (5 values):** strike, maturity, token type, quote token, oracle price at maturity

**Summary — Encrypted (everything else):** deposit size, balances, listed amounts, prices, bids, match outcomes, payouts, redemptions

### Price Discovery (Confidential Mode)

Buyers bid "blind" — they don't know the seller's minimum. This works because:

1. **Fair value is calculable.** For any (strike, maturity) series, both P and N have deterministic fair values derivable from the public ETH price and the public strike. P ~= $(S) when deep in-the-money. N ~= $(price - S) when in-the-money. Buyers can price rationally.
2. **No-match is free.** Failed bids return full funds and leak nothing about the seller's minimum. Buyer retries with adjusted terms.

---

## Contract Architecture

### Public Mode Contracts

```
+--------------------------------------------------+
|              PublicOptionFactory                   |
|                                                   |
|  createSeries(strike, maturity)                   |
|    → deploys stableETH + upETH (standard ERC-20) |
|                                                   |
|  split(strike, maturity, amount)                   |
|    → vault receives ETH or pulls ERC-20 collateral |
|    → mint equal stableETH + upETH                 |
|                                                   |
|  merge(strike, maturity, amount)                   |
|    → burn both tokens → vault returns collateral  |
|                                                   |
|  settle(strike, maturity, oraclePrice)             |
|    → after maturity, set payout ratios             |
|                                                   |
|  redeem(strike, maturity)                          |
|    → burn tokens, compute payout (plaintext math), |
|      vault transfers collateral to user            |
+--------------------------------------------------+

+--------------------------------------------------+
|          CentralCollateralVault                   |
|                                                   |
|  Holds ETH/ERC-20 reserves for all public series  |
|  Tracks reserve balances by seriesId              |
|  Serves collateral flash loans from pooled liquidity |
|  Blocks reserve changes during flash loans        |
+--------------------------------------------------+

+--------------------------------------------------+
|         Standard ERC-20 Tokens                    |
|                                                   |
|  ETH or WETH/ERC-20 collateral                   |
|  stableETH(S, M) — P token, stable/long-USD side |
|  upETH(S, M) — N token, leveraged/long-ETH side  |
|  All balances plaintext, 18 decimals              |
+--------------------------------------------------+
```

Public mode does not need its own matching engine — P and N tokens trade on existing DEXs and orderbooks.

### Confidential Mode Contracts

```
+--------------------------------------------------+
|           ConfidentialOptionFactory               |
|                                                   |
|  createSeries(strike, maturity)                   |
|    → deploys stableETH + upETH ConfidentialERC20  |
|                                                   |
|  split(strike, maturity, encAmount, proof)         |
|    → pull encrypted cWETH from user               |
|    → mint equal encrypted stableETH + upETH       |
|                                                   |
|  merge(strike, maturity, amount)                   |
|    → burn both encrypted amounts → return cWETH   |
|                                                   |
|  settle(strike, maturity, oraclePrice)             |
|    → after maturity, set payout ratios             |
|                                                   |
|  redeem(strike, maturity)                          |
|    → burn tokens, compute payout via FHE,          |
|      transfer cWETH to user                        |
+--------------------------------------------------+

+--------------------------------------------------+
|          ConfidentialMatchingEngine               |
|                                                   |
|  createListing(token, quoteToken,                 |
|    strike, maturity, encAmount, encMinReceive,     |
|    amountProof, minProof)                          |
|                                                   |
|  fill(listingId, encPayment, encExpected,          |
|    paymentProof, expectedProof)                    |
|    → FHE match verification                       |
|    → atomic swap or full refund                   |
|    → listing deactivated (all-or-nothing)          |
|                                                   |
|  cancelListing(listingId)                          |
|    → return locked tokens to seller               |
+--------------------------------------------------+

+--------------------------------------------------+
|        ConfidentialERC20 Tokens (ERC-7984)        |
|                                                   |
|  cWETH — confidential wrapped ETH (ERC-7984)     |
|  stableETH(S, M) — P token, stable/long-USD side |
|  upETH(S, M) — N token, leveraged/long-ETH side  |
|  All balances encrypted (euint64), 6 decimals     |
+--------------------------------------------------+
```

### Unshield Bridge Contract

```
+--------------------------------------------------+
|              UnshieldBridge                        |
|                                                   |
|  unshield(token, strike, maturity, encAmount)      |
|    → decrypt amount (reveals position size)        |
|    → burn ConfidentialERC20 on fhEVM              |
|    → mint equivalent standard ERC-20 on target    |
|    → one-way: confidential → public only          |
+--------------------------------------------------+
```

### Key FHE Operations Used (Confidential Mode Only)

| Operation | Where Used |
|---|---|
| `FHE.min(a, b)` | Settlement payout, fill amount capping |
| `FHE.sub(a, b)` | Refund calculation, upPayout = SCALE - stablePayout |
| `FHE.mul(a, b)` | Payout computation: balance * rate |
| `FHE.div(a, b)` | Payout computation: (balance * rate) / SCALE |
| `FHE.ge(a, b)` | Match verification: payment >= minimum, locked >= expected |
| `FHE.select(cond, a, b)` | Conditional transfer: match → swap, else → refund |
| `FHE.and(a, b)` | Combining match conditions |
| `FHE.add(a, b)` | Balance updates, reserve tracking |

---

## Oracle Design

Freedom only needs the oracle **at maturity** — not in real-time. This is a fundamental security improvement over CDP-based protocols and applies to both public and confidential modes.

Because P + N = 1 unit of collateral by construction, there is no insolvency scenario that requires real-time intervention. The oracle's only job is to resolve the final price once, after which payouts are computed deterministically.

Suitable oracle types:
- **Prediction-market-style** (slow, dispute-based) — safest, aligns with Vitalik's thesis
- **TWAP** at maturity — resistant to spot manipulation
- **Chainlink with settlement delay** — pragmatic for v1

**Public mode:** The oracle submits the price as plaintext. The contract computes payout rates in plaintext. Users call `redeem()` and receive the public collateral asset. Simple math.

**Confidential mode:** The oracle submits the price as plaintext. The contract computes payout rates in plaintext (they are derivable from public strike + public oracle price anyway), then encrypts them for use in the per-user redemption computation which multiplies the rate by each user's encrypted balance.

---

## Advantages Over Existing Approaches

| | CDP Lending (Aave/Maker) | USDC/USDT | Freedom Public | Freedom Confidential |
|---|---|---|---|---|
| Liquidation risk | Yes — sudden, total loss | N/A | No | No |
| Oracle requirement | Real-time, binding | N/A | At maturity only | At maturity only |
| Extreme price behavior | Liquidation cascade | N/A | Smooth drift | Smooth drift |
| Centralized issuer | Partial (DAI) / Yes (USDC) | Yes | **No** | **No** |
| Censorship risk | Medium | High (freeze function) | **None** | **None** |
| DeFi composability | Full | Full | **Full** | Limited (must unshield) |
| MEV on rebalancing | Yes (visible) | N/A | Yes (visible) | **No** (encrypted) |
| Position privacy | No | No | No | **Yes** |
| Flash loan attack surface | High | Low | **Minimal** | **Minimal** |
| Accounting stablecoin? | Yes | Yes | No | No |
| Deployable on | Any EVM | Any EVM | **Any EVM** | fhEVM only |

---

## Open Questions

1. **Rebalancing slippage** — If users lose >2%/year from rolling costs, the system is uncompetitive. Need "ultra narrow spreads for rolling" — potentially via gradual auctions (TWAP orders, batch auctions) rather than instant swaps. This is especially important in public mode where rebalancing is visible.
2. **Public mode MEV mitigation** — Without encryption, rebalancing is visible. Batch auctions, TWAP orders, and intent-based execution can reduce MEV but not eliminate it. How much MEV leakage is acceptable before users should switch to confidential mode?
3. **Unshield bridge design** — Cross-chain unshielding (fhEVM → Ethereum mainnet) requires a trusted bridge or message relay. What security model is acceptable? Within fhEVM, it is a simple burn-and-mint.
4. **Division precision** — `FHE.div` on encrypted integers with SCALE=1e6 (confidential mode). Rounding dust is ~1 unit (0.000001). Needs testing.
5. **Gas costs** — FHE operations are heavier than plaintext (confidential mode). Public mode has standard EVM gas costs. Settlement is infrequent (maturity only), but confidential matching engine operations happen per trade. Coprocessor offloads heavy FHE.
6. **Multi-collateral** — Public mode supports native ETH or one ERC-20 collateral per factory deployment. Confidential mode uses cWETH-style encrypted collateral with its separate confidential factory/vault path.
7. **Perpetual variant** — Commenters on Vitalik's post proposed perpetual versions with continuous minting/burning and dynamic saturation mechanics instead of fixed expiry. Worth exploring as v2.
8. **Oracle design** — Current contracts gate `settle()` to an immutable oracle address. Production still needs a robust oracle process, ideally dispute-based or TWAP-backed.
9. **P token adoption** — For P to replace USDC, it needs deep liquidity on major DEXs and acceptance as collateral on lending protocols. Bootstrapping this liquidity is a cold-start problem.
10. **Regulatory classification** — P is not a stablecoin in the traditional sense (no issuer, no reserves, no peg mechanism). How regulators classify it affects adoption.

---

## References

- [Vitalik: Building index-tracking assets on top of options instead of debt](https://ethresear.ch/t/building-index-tracking-assets-on-top-of-options-instead-of-debt/25036)
- [Zama Protocol Litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper)
- [Zama ConfidentialERC20](https://github.com/zama-ai/fhevm-contracts/blob/main/contracts/token/ERC20/ConfidentialERC20.sol)
- [ERC-7984 Confidential Token Standard](https://docs.openzeppelin.com/confidential-contracts/token)
- [fhEVM Coprocessor](https://www.zama.org/post/fhevm-coprocessor)
- [Zama Developer Program](https://community.zama.org/t/the-zama-developer-program-is-back-with-3-tracks/4276)
- [First Confidential OTC Trade (GSR + Zama)](https://blockeden.xyz/blog/2026/03/13/zama-fhe-protocol-first-confidential-institutional-otc-trade-encrypted-ethereum/)
- [OpenZeppelin ERC-20](https://docs.openzeppelin.com/contracts/5.x/erc20)
