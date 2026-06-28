# Freedom Protocol — Backend (Smart Contract) Spec

## Project Layout

```
contracts/
├── foundry.toml               # Solidity 0.8.24, via-ir, optimizer 200
├── src/
│   ├── public/
│   │   ├── PublicOptionToken.sol       # Standard ERC-20 P / N token (plaintext balances)
│   │   ├── PublicOptionFactory.sol     # Plaintext split, merge, settle, redeem
│   │   └── PublicOrderbook.sol         # (Optional) on-chain limit orderbook for public tokens
│   ├── confidential/
│   │   ├── ConfidentialERC20Base.sol   # Abstract encrypted ERC-20 (balances, allowances, transfers)
│   │   ├── OptionToken.sol            # stableETH (P) / upETH (N) — factory-mintable ConfidentialERC20
│   │   ├── OptionFactory.sol          # Core: split, merge, settle, redeem (FHE)
│   │   └── ConfidentialMatchingEngine.sol  # Blind OTC matching for trading P and N tokens
│   └── bridge/
│       └── UnshieldBridge.sol         # One-way confidential → public token bridge
├── test/                      # (empty — needs tests)
├── script/                    # (empty — needs deploy scripts)
└── lib/
    ├── forge-std/
    ├── fhevm/                 # Zama fhEVM Solidity library
    ├── encrypted-types/
    └── openzeppelin-contracts/
```

---

## Protocol Context

Users deposit collateral and mint two complementary tokens — **stableETH (P)** and **upETH (N)** — that always sum back to the deposited collateral. At maturity, an oracle resolves the ETH price and the contract distributes collateral:

```
P receives: min(1, S / x) collateral per token
N receives: max(0, 1 - S / x) collateral per token
```

Where S = strike price, x = oracle price at maturity. P + N = 1 always (no liquidation possible).

**P (stableETH)** tracks $S in USD terms when ETH > S. It's the stable/long-USD side.
**N (upETH)** captures all upside above S. It's a leveraged call option on ETH.

Either token can be sold depending on the user's goal. The contracts are symmetric — they don't enforce which side the user keeps.

**Dual-mode architecture:** The protocol operates in two parallel modes:
- **Public Mode** — Standard Solidity on any EVM. Plaintext balances, standard ERC-20, tradeable on any DEX.
- **Confidential Mode** — Zama fhEVM. Encrypted balances, encrypted matching, privacy-preserving.

Users can move tokens from confidential to public mode via the **Unshield Bridge** (one-way, reveals amounts).

---

## Contract Dependency Graph

```
                        ┌─────────────────────────────────────┐
                        │          PUBLIC MODE                │
                        │                                     │
                        │   OpenZeppelin ERC20                │
                        │         │                           │
                        │         ▼                           │
                        │   PublicOptionToken (P / N)         │
                        │         │                           │
                        │    owned by ──► PublicOptionFactory  │
                        │                    │                │
                        │                    ├── split: WETH → P + N        │
                        │                    ├── merge: P + N → WETH        │
                        │                    ├── settle: oracle → payouts   │
                        │                    └── redeem: burn → claim WETH  │
                        │                                     │
                        │   PublicOrderbook / DEX integration │
                        │     (trades public P/N tokens)      │
                        └──────────────┬──────────────────────┘
                                       │
                                       ▲ mint
                              UnshieldBridge
                                       ▼ burn
                                       │
                        ┌──────────────┴──────────────────────┐
                        │       CONFIDENTIAL MODE             │
                        │                                     │
                        │   ConfidentialERC20Base (abstract)   │
                        │         │                           │
                        │         ▼                           │
                        │   OptionToken (stableETH / upETH)   │
                        │         │                           │
                        │    owned by ──► OptionFactory        │
                        │                    │                │
                        │                    ├── split: cWETH → P + N       │
                        │                    ├── merge: P + N → cWETH       │
                        │                    ├── settle: oracle → payouts   │
                        │                    └── redeem: burn → claim cWETH │
                        │                                     │
                        │   ConfidentialMatchingEngine         │
                        │     (blind OTC matching for P/N)    │
                        └─────────────────────────────────────┘
```

---

## Public Mode Contracts

### PublicOptionToken

**File:** `src/public/PublicOptionToken.sol`
**Role:** Standard ERC-20 representing one side of the split. stableETH (P) when `isStable = true`, upETH (N) when `isStable = false`. Each (strike, maturity, isStable) tuple is a separate deployment.

Inherits OpenZeppelin `ERC20`. Plaintext balances, standard `transfer`/`approve`/`transferFrom`.

#### Immutables

| Field | Type | Description |
|---|---|---|
| `factory` | `address` | The PublicOptionFactory that deployed this token |
| `strike` | `uint256` | Strike price (public) |
| `maturity` | `uint64` | Unix timestamp of maturity (public) |
| `isStable` | `bool` | `true` = stableETH (P), `false` = upETH (N) |

#### Privileged Functions

| Function | Access | Description |
|---|---|---|
| `mint(to, amount)` | `onlyFactory` or authorized bridge | Mints plaintext amount to `to` |
| `burn(from, amount)` | `onlyFactory` or authorized bridge | Burns plaintext amount from `from` |

#### Design Notes

- Standard ERC-20 — balances are public, events include amounts, tokens are tradeable on any DEX (Uniswap, etc.).
- **Decimals = 6.** Matches `SCALE = 1_000_000`.
- **Mint/burn access** must include both the factory and the UnshieldBridge. Use an `authorized` mapping or role-based access.

---

### PublicOptionFactory

**File:** `src/public/PublicOptionFactory.sol`
**Role:** Core protocol logic for public mode. Same lifecycle as the confidential OptionFactory — series creation, split, merge, settlement, redemption — but all math is plaintext. No FHE operations.

#### Constants

| Name | Value | Description |
|---|---|---|
| `SCALE` | `1_000_000` (1e6) | Fixed-point scale. `SCALE` = 1.0. Payout ratios are `[0, SCALE]`. |

#### Immutables

| Field | Type | Description |
|---|---|---|
| `WETH` | `IWETH` | Standard WETH contract (not confidential) |

#### Storage

```solidity
struct Series {
    PublicOptionToken stableToken;    // P — stableETH
    PublicOptionToken upToken;        // N — upETH
    bool settled;                     // true after oracle settles
    uint256 stablePayout;             // plaintext payout rate for P (SCALE units)
    uint256 upPayout;                 // plaintext payout rate for N (SCALE units)
}

mapping(bytes32 => Series) public series;        // seriesId => Series
mapping(bytes32 => uint256) public reserves;     // seriesId => total WETH locked
```

`seriesId = keccak256(abi.encodePacked(strike, maturity))`

#### Functions

##### `createSeries(strike, maturity) -> (stableAddr, upAddr)`

Deploys two new PublicOptionToken contracts — one P, one N.
- Token names encode strike and maturity: `stableETH-1000-1756684800`
- Reverts if series already exists
- Emits `SeriesCreated(strike, maturity, stableAddr, upAddr)`

##### `split(strike, maturity, amount)`

User deposits WETH, receives equal amounts of public P + N.

```
1. Validate: series exists, not settled
2. WETH.transferFrom(user, this, amount)
3. reserves[id] += amount
4. stableToken.mint(user, amount)
5. upToken.mint(user, amount)
6. Emit Split(user, seriesId, amount)
```

Straightforward plaintext ERC-20 interactions. No FHE.

##### `merge(strike, maturity, amount)`

Reverse of split — burn equal amounts of P + N, reclaim WETH.

```
1. Validate: series exists, not settled
2. stableToken.burn(user, amount)
3. upToken.burn(user, amount)
4. reserves[id] -= amount
5. WETH.transfer(user, amount)
6. Emit Merge(user, seriesId, amount)
```

Requires user to hold at least `amount` of both P and N. Reverts on insufficient balance (standard ERC-20 behavior).

##### `settle(strike, maturity, oraclePrice)`

Called after maturity to set payout ratios. Same math as confidential mode but plaintext.

```
1. Validate: series exists, not settled, block.timestamp >= maturity
2. Compute payout:
   if oraclePrice == 0 OR strike >= oraclePrice:
     stablePay = SCALE   // P takes 100%
   else:
     stablePay = min(SCALE, strike * SCALE / oraclePrice)
   upPay = SCALE - stablePay
3. Store stablePayout, upPayout as uint256 (plaintext)
4. Mark settled
5. Emit Settled(seriesId, oraclePrice, stablePay, upPay)
```

**Payout rate examples (SCALE = 1,000,000):**

| Oracle price | Strike | stablePay | upPay | P gets per token | N gets per token |
|---|---|---|---|---|---|
| $4,000 | $1,000 | 250,000 | 750,000 | 0.25 WETH (~$1000) | 0.75 WETH (~$3000) |
| $2,000 | $1,000 | 500,000 | 500,000 | 0.50 WETH (~$1000) | 0.50 WETH (~$1000) |
| $1,000 | $1,000 | 1,000,000 | 0 | 1.00 WETH (~$1000) | 0.00 WETH |
| $500 | $1,000 | 1,000,000 | 0 | 1.00 WETH (~$500 drift) | 0.00 WETH |

**Currently permissionless** — anyone can call with any price. Needs access control (see Open Items).

##### `redeem(strike, maturity)`

User claims WETH after settlement. Burns entire balance of both P and N.

```
1. Validate: series is settled
2. Read balances: stableBal = stableToken.balanceOf(user), upBal = upToken.balanceOf(user)
3. Burn both token balances
4. Compute payout (plaintext math):
   claim = (stableBal * stablePayout + upBal * upPayout) / SCALE
5. WETH.transfer(user, claim)
6. Emit Redeemed(user, seriesId, claim)
```

**Full redemption only.** Burns entire balance. No partial redeem.

**Division precision:** Integer division truncates. Max rounding loss is ~1 unit (0.000001 token) with SCALE = 1e6.

#### Events

| Event | Fields |
|---|---|
| `SeriesCreated` | `strike (indexed), maturity (indexed), stableToken, upToken` |
| `Split` | `user (indexed), seriesId (indexed), amount` |
| `Merge` | `user (indexed), seriesId (indexed), amount` |
| `Settled` | `seriesId (indexed), oraclePrice, stablePayout, upPayout` |
| `Redeemed` | `user (indexed), seriesId (indexed), claim` |

Events include amounts — unlike confidential mode, there is no privacy concern.

#### View Helpers

| Function | Returns |
|---|---|
| `getTokens(strike, maturity)` | `(stableAddr, upAddr)` |
| `isSettled(strike, maturity)` | `bool` |
| `seriesId(strike, maturity)` | `bytes32` (pure) |

---

### Public Trading

**File:** `src/public/PublicOrderbook.sol` (optional)
**Role:** On-chain limit orderbook for public P/N tokens. Since public tokens are standard ERC-20s, they can also be traded on any existing DEX (Uniswap, Sushiswap, Curve, etc.) without any custom contract.

#### Options

1. **DEX integration (recommended):** No custom contract needed. Public P/N tokens are standard ERC-20 — list on Uniswap V3, create liquidity pools, use existing aggregators. This is the simplest path and leverages existing liquidity infrastructure.

2. **On-chain orderbook (optional):** Simple limit orderbook with plaintext prices and amounts. Makers post limit orders (token, price, amount), takers fill at the listed price. Standard `approve` + `transferFrom` flow.

#### Design Notes

- All amounts and prices are plaintext — no privacy features.
- Public P tokens are particularly useful for DeFi composability (collateral in lending protocols, LP positions, etc.).
- The orderbook is not required — DEX integration is sufficient for most use cases.

---

## Confidential Mode Contracts

### ConfidentialERC20Base

**File:** `src/confidential/ConfidentialERC20Base.sol`
**Role:** Abstract base for all encrypted ERC-20 tokens in the protocol.

#### Storage

| Field | Type | Visibility |
|---|---|---|
| `_name` | `string` | Public (view) |
| `_symbol` | `string` | Public (view) |
| `_totalSupply` | `uint64` | Public (view) — placeholder count, not real encrypted sum |
| `_balances` | `mapping(address => euint64)` | Internal — encrypted per-user balances |
| `_allowances` | `mapping(address => mapping(address => euint64))` | Internal — encrypted allowances |

#### Functions

| Function | Access | Description |
|---|---|---|
| `name()` | Public view | Returns token name |
| `symbol()` | Public view | Returns token symbol |
| `decimals()` | Public pure | Returns `6` (matches SCALE = 1e6) |
| `totalSupply()` | Public view | Plaintext counter (not encrypted sum) |
| `balanceOf(account)` | Public view | Returns `euint64` handle — caller must re-encrypt to read |
| `allowance(owner, spender)` | Public view | Returns encrypted allowance handle |
| `approve(spender, encAmount, proof)` | Public | Set encrypted allowance |
| `transfer(to, encAmount, proof)` | Public | Transfer encrypted amount |
| `transferFrom(from, to, encAmount, proof)` | Public | Transfer with allowance check |

#### Internal Functions

| Function | Description |
|---|---|
| `_approve(owner, spender, amount)` | Stores encrypted allowance, sets ACL for owner + spender + this |
| `_updateAllowance(owner, spender, amount)` | FHE check: `amount <= allowance AND amount <= balance`. Returns `ebool`. Deducts allowance if ok. |
| `_transfer(from, to, amount)` | Checks `amount <= balance`, delegates to conditional transfer |
| `_transfer(from, to, amount, ok)` | Conditional: `moved = ok ? amount : 0`. Updates both balances, sets ACL |
| `_mint(to, amount)` | Adds encrypted amount to balance, sets ACL |
| `_burn(from, amount)` | Subtracts encrypted amount from balance, sets ACL |
| `_transferEncrypted(from, to, amount)` | Direct internal transfer (used by factory for pulls) |

#### Design Notes

- **No revert on insufficient balance.** Transfer of 0 occurs silently (via `FHE.select`). Reverting would leak information about encrypted balances.
- **Events emit no amounts.** `Transfer(from, to)` and `Approval(owner, spender)` only — no value field.
- **Decimals = 6.** Matches `SCALE = 1_000_000` used in OptionFactory settlement math.

---

### OptionToken (Confidential)

**File:** `src/confidential/OptionToken.sol`
**Role:** Concrete ConfidentialERC20 representing one side of the split. stableETH (P) when `isStable = true`, upETH (N) when `isStable = false`. Each (strike, maturity, isStable) tuple is a separate deployment.

#### Immutables

| Field | Type | Description |
|---|---|---|
| `factory` | `address` | The OptionFactory that deployed this token |
| `strike` | `uint256` | Strike price (public) |
| `maturity` | `uint64` | Unix timestamp of maturity (public) |
| `isStable` | `bool` | `true` = stableETH (P), `false` = upETH (N) |

#### Privileged Functions (onlyFactory)

| Function | Description |
|---|---|
| `mint(to, amount)` | Mints encrypted amount to `to`. Increments placeholder `_totalSupply`. Grants factory FHE access. |
| `burn(from, amount)` | Burns encrypted amount from `from`. Grants factory FHE access. |
| `pullFrom(from, amount)` | Transfers encrypted amount from user to factory address (for merge/escrow flows). |

#### Design Notes

- **Only the factory can mint/burn/pull.** Users can freely `transfer` and `approve` via the inherited ConfidentialERC20Base.
- **`_totalSupply` is a placeholder counter** — increments by 1 per mint call, not by actual amount (which is encrypted).
- **`pullFrom` bypasses allowance** — it's a factory-privileged operation.
- **Bridge access:** The UnshieldBridge also needs burn authorization. Add an `authorized` mapping or extend `onlyFactory` to include the bridge address.

---

### OptionFactory (Confidential)

**File:** `src/confidential/OptionFactory.sol`
**Role:** Core protocol logic. Manages series lifecycle: creation, split, merge, settlement, redemption. Agnostic to which side the user keeps or sells.

#### Constants

| Name | Value | Description |
|---|---|---|
| `SCALE` | `1_000_000` (1e6) | Fixed-point scale. `SCALE` = 1.0. Payout ratios are `[0, SCALE]`. |

#### Immutables

| Field | Type | Description |
|---|---|---|
| `cWETH` | `IConfidentialWETH` | The confidential WETH contract (ERC-7984 wrapped WETH) |

#### Storage

```solidity
struct Series {
    OptionToken stableToken;    // P — stableETH
    OptionToken upToken;        // N — upETH
    bool settled;               // true after oracle settles
    euint64 stablePayout;       // encrypted payout rate for P (SCALE units)
    euint64 upPayout;           // encrypted payout rate for N (SCALE units)
}

mapping(bytes32 => Series) public series;        // seriesId => Series
mapping(bytes32 => euint64) internal _reserves;  // seriesId => total cWETH locked
```

`seriesId = keccak256(abi.encodePacked(strike, maturity))`

#### Functions

##### `createSeries(strike, maturity) -> (stableAddr, upAddr)`

Deploys two new OptionToken contracts — one P (stableETH), one N (upETH).
- Token names encode strike and maturity: `stableETH-1000-1756684800`
- Reverts if series already exists
- Emits `SeriesCreated(strike, maturity, stableAddr, upAddr)`

##### `split(strike, maturity, encAmt, proof)`

User deposits encrypted cWETH, receives equal encrypted amounts of P + N.

```
1. Validate: series exists, not settled
2. FHE.fromExternal(encAmt, proof) -> euint64 amount
3. cWETH.transferFrom(user -> this, encAmt, proof)
4. _reserves[id] += amount (FHE.add, allowThis)
5. stableToken.mint(user, amount) — P tokens
6. upToken.mint(user, amount) — N tokens
7. Emit Split(user, seriesId)
```

##### `merge(strike, maturity, amount)`

Reverse of split — burn equal amounts of P + N, reclaim cWETH.

```
1. Validate: series exists, not settled
2. Verify FHE.isSenderAllowed(amount)
3. stableToken.pullFrom(user -> factory) + burn
4. upToken.pullFrom(user -> factory) + burn
5. _reserves[id] -= amount (FHE.sub, allowThis)
6. cWETH.transfer(user, amount)
7. Emit Merge(user, seriesId)
```

##### `settle(strike, maturity, oraclePrice)`

Called after maturity to set payout ratios.

```
1. Validate: series exists, not settled, block.timestamp >= maturity
2. Compute payout in plaintext:
   if oraclePrice == 0 OR strike >= oraclePrice:
     stablePay = SCALE
   else:
     stablePay = min(SCALE, strike * SCALE / oraclePrice)
   upPay = SCALE - stablePay
3. Encrypt: FHE.asEuint64(stablePay), FHE.asEuint64(upPay)
4. Store encrypted payouts, mark settled
5. Emit Settled(seriesId, oraclePrice)
```

**Oracle price is public** — everyone sees it in the Settled event. The payout rates are technically derivable from public (strike, oraclePrice), but they're encrypted for the per-user redemption computation where they multiply against encrypted balances.

**Currently permissionless** — anyone can call with any price. Needs access control (see Open Items).

##### `redeem(strike, maturity)`

User claims cWETH after settlement. Burns entire balance of both P and N.

```
1. Validate: series is settled
2. Read encrypted balances: stableBal (P), upBal (N)
3. Burn both token balances
4. Compute payout (all FHE):
   stableClaim = stableBal * stablePayout / SCALE
   upClaim     = upBal * upPayout / SCALE
   totalClaim  = stableClaim + upClaim
5. FHE.allow(totalClaim, user)
6. cWETH.transfer(user, totalClaim)
7. Emit Redeemed(user, seriesId)
```

**Full redemption only.** Burns entire balance. No partial redeem.

**Division precision:** `FHE.div(FHE.mul(bal, rate), SCALE)` — integer division truncates. Max rounding loss is ~1 unit (0.000001 token) with SCALE = 1e6.

#### Events

| Event | Fields (all public) |
|---|---|
| `SeriesCreated` | `strike (indexed), maturity (indexed), stableToken, upToken` |
| `Split` | `user (indexed), seriesId (indexed)` |
| `Merge` | `user (indexed), seriesId (indexed)` |
| `Settled` | `seriesId (indexed), oraclePrice` |
| `Redeemed` | `user (indexed), seriesId (indexed)` |

No amounts in any event.

#### View Helpers

| Function | Returns |
|---|---|
| `getTokens(strike, maturity)` | `(stableAddr, upAddr)` |
| `isSettled(strike, maturity)` | `bool` |
| `seriesId(strike, maturity)` | `bytes32` (pure) |

---

### ConfidentialMatchingEngine

**File:** `src/confidential/ConfidentialMatchingEngine.sol`
**Role:** Blind OTC matching. Sellers list P or N tokens for sale against a confidential quote token. Buyers submit encrypted bids. Contract verifies match via FHE without revealing terms.

The engine is agnostic to whether the seller is listing P or N. Both sides of the split are traded the same way.

#### Storage

```solidity
struct Listing {
    address seller;
    OptionToken token;              // P (stableETH) or N (upETH) being sold
    IConfidentialQuoteToken quoteToken;  // payment token (cUSDC, cDAI, etc.)
    uint256 strike;                 // public — series identifier
    uint64 maturity;                // public — series identifier
    euint64 lockedAmount;           // encrypted: tokens in escrow
    euint64 minReceive;             // encrypted: seller's price floor
    bool active;
}

uint256 public nextListingId;
mapping(uint256 => Listing) public listings;
```

#### Functions

##### `createListing(token, quoteToken, strike, maturity, encAmount, encMinReceive, amountProof, minProof) -> listingId`

Seller escrows encrypted P or N tokens and sets an encrypted minimum payment.

```
1. FHE.fromExternal both encrypted inputs
2. token.pullFrom(seller -> this) to escrow tokens
3. Store listing with encrypted fields
4. FHE.allowThis on both encrypted values
5. FHE.allow(minReceive, seller) — seller can re-encrypt to view their own floor
6. Emit ListingCreated(listingId, seller, token, quoteToken, strike, maturity)
```

##### `fill(listingId, encPayment, encExpected, paymentProof, expectedProof)`

Buyer submits encrypted payment and expected receive. Contract verifies match via FHE.

```
1. Validate: listing is active
2. FHE.fromExternal buyer's payment and expected amount
3. Escrow buyer's quote tokens via transferFrom

4. FHE match verification:
   c1 = FHE.ge(payment, listing.minReceive)       // buyer pays enough?
   c2 = FHE.ge(listing.lockedAmount, expected)     // seller has enough?
   matched = FHE.and(c1, c2)

5. Compute transfer amounts (all FHE):
   tokenOut  = matched ? min(lockedAmount, expected) : 0
   quoteOut  = matched ? min(payment, minReceive) : 0
   tokenBack = lockedAmount - tokenOut     // seller refund
   quoteBack = payment - quoteOut          // buyer refund

6. Execute 4 transfers:
   token  -> buyer     (tokenOut — P or N tokens)
   token  -> seller    (tokenBack — unsold)
   quote  -> seller    (quoteOut — payment)
   quote  -> buyer     (quoteBack — excess)

7. Deactivate listing (l.active = false)
8. Emit FillAttempted(listingId, buyer)
```

**Match or refund is indistinguishable on-chain.** Whether the trade succeeded or failed, the same 4 transfers occur — amounts are encrypted zeros on failure.

**All-or-nothing.** Listing is always deactivated after a fill attempt. No partial fills.

##### `cancelListing(listingId)`

Seller withdraws escrowed tokens. Must be active, must be seller.

##### View: `getListing(listingId)`

Returns public fields only: `(seller, token, quoteToken, strike, maturity, active)`.

#### Events

| Event | Fields (all public) |
|---|---|
| `ListingCreated` | `listingId (indexed), seller (indexed), token, quoteToken, strike, maturity` |
| `FillAttempted` | `listingId (indexed), buyer (indexed)` |
| `ListingCancelled` | `listingId (indexed)` |

No amounts, prices, or match outcomes in any event.

---

## Unshield Bridge

**File:** `src/bridge/UnshieldBridge.sol`
**Role:** One-way bridge from confidential to public tokens. Burns confidential P/N and mints equivalent public P/N. Reveals the amount — users opt in to transparency when they unshield.

### Immutables

| Field | Type | Description |
|---|---|---|
| `confidentialFactory` | `OptionFactory` | The confidential OptionFactory (for token lookups) |
| `publicFactory` | `PublicOptionFactory` | The public OptionFactory (for token lookups) |

### Functions

#### `unshield(strike, maturity, isStable, amount)`

Moves tokens from confidential mode to public mode. The `amount` is plaintext — the user explicitly reveals how many tokens they are unshielding.

```
1. Look up confidential OptionToken for (strike, maturity, isStable) from confidentialFactory
2. Look up public PublicOptionToken for (strike, maturity, isStable) from publicFactory
3. Validate: both tokens exist (series must be created in both factories)
4. Burn `amount` of confidential OptionToken from msg.sender
   - Internally: encrypts `amount`, calls confidential token's burn
   - The confidential token's burn uses FHE to subtract from encrypted balance
5. Mint `amount` of PublicOptionToken to msg.sender
   - Standard plaintext mint
6. Emit Unshielded(user, strike, maturity, isStable, amount)
```

### Flow Detail

```
User                    UnshieldBridge           Confidential P    Public P
 |                           |                        |               |
 |-- unshield(s,m,true,100)->|                        |               |
 |                           |-- burn(user, 100) ---->|               |
 |                           |   (encrypts 100,       |               |
 |                           |    subtracts from       |               |
 |                           |    encrypted balance)   |               |
 |                           |                        |               |
 |                           |-- mint(user, 100) -----|-------------->|
 |                           |   (plaintext mint)      |               |
 |<-- Unshielded event ------|                        |               |
```

### Authorization Requirements

The bridge contract needs special permissions on both sides:

| Contract | Required Authorization | Why |
|---|---|---|
| Confidential OptionToken | Bridge must be authorized to call `burn` | `onlyFactory` must be extended to include bridge |
| Public PublicOptionToken | Bridge must be authorized to call `mint` | `onlyFactory` must be extended to include bridge |

Both factories need to register the bridge as an authorized minter/burner for matching series.

### Design Notes

- **One-way only.** Confidential to public. There is no "reshield" (public to confidential) — once amounts are revealed, they cannot be made private again.
- **Amount is revealed.** This is expected and documented. The user chooses to sacrifice privacy for composability (DEX trading, DeFi integration, etc.).
- **Series must exist in both factories.** The bridge cannot create series — both the confidential and public series must be created independently before unshielding.
- **No reserve transfer.** The bridge does not move WETH/cWETH between factories. The confidential factory retains its cWETH reserves; the public factory must have sufficient WETH reserves (or be funded separately). This is a key design consideration — see Open Items.

### Events

| Event | Fields |
|---|---|
| `Unshielded` | `user (indexed), strike (indexed), maturity, isStable, amount` |

---

## FHE Operations Summary (Confidential Mode Only)

| Operation | Contract | Usage |
|---|---|---|
| `FHE.asEuint64(plaintext)` | Factory, Engine | Convert plaintext to encrypted (payouts, zero values) |
| `FHE.fromExternal(einput, proof)` | Factory, Engine, Base | Decrypt user-submitted encrypted input |
| `FHE.add(a, b)` | Base, Factory | Balance increment, reserve tracking |
| `FHE.sub(a, b)` | Base, Factory, Engine | Balance decrement, refund computation |
| `FHE.mul(a, b)` | Factory | Payout: `balance * rate` |
| `FHE.div(a, b)` | Factory | Payout: `(balance * rate) / SCALE` |
| `FHE.min(a, b)` | Engine | Cap transfer amounts |
| `FHE.le(a, b)` | Base | Balance/allowance sufficiency |
| `FHE.ge(a, b)` | Engine | Match: payment >= min, locked >= expected |
| `FHE.and(a, b)` | Base, Engine | Combine boolean conditions |
| `FHE.select(cond, a, b)` | Base, Engine | Conditional: `cond ? a : b` |
| `FHE.allowThis(handle)` | All | Grant contract ACL |
| `FHE.allow(handle, addr)` | All | Grant address ACL for re-encryption |
| `FHE.isSenderAllowed(handle)` | Base, Factory | Verify caller has ACL |

---

## Data Flow Diagrams

### Public Mode: Split (Deposit & Mint)

```
User                    PublicOptionFactory               WETH         Public P       Public N
 |                               |                          |            |              |
 |-- split(strike,mat,amount) -->|                          |            |              |
 |                               |-- transferFrom(user,this)|            |              |
 |                               |<-- ok -------------------|            |              |
 |                               |-- reserves += amount     |            |              |
 |                               |-- mint(user, amount) ----|----------->|              |
 |                               |-- mint(user, amount) ----|-------------------------->|
 |<-- Split event (with amount)--|                          |            |              |
 |                               |                          |            |              |
 | User now holds public P + N. Can trade on Uniswap,      |            |              |
 | list on any DEX, or use in DeFi protocols.               |            |              |
```

### Public Mode: Settlement & Redeem

```
Oracle/Anyone           PublicOptionFactory           WETH          Public P       Public N
 |                               |                     |               |              |
 |-- settle(s,m,price) -------->|                     |               |              |
 |                               |-- compute plaintext:|               |              |
 |                               |   stablePay, upPay  |               |              |
 |                               |-- store uint256     |               |              |
 |<-- Settled event (with rates)|                     |               |              |

User (holds P only,             |                     |               |              |
 sold N on Uniswap)             |                     |               |              |
 |-- redeem(strike, mat) ------>|                     |               |              |
 |                               |-- balanceOf(user) --|-------------->|              |
 |                               |-- balanceOf(user) --|---------------------------- >|
 |                               |-- burn P balance ---|-------------->|              |
 |                               |-- burn N balance ---|------------------------------>|
 |                               |-- claim = (pBal*stablePay + nBal*upPay) / SCALE    |
 |                               |-- transfer(user, claim) ->|        |              |
 |<-- Redeemed event (with amt)-|                     |               |              |
```

### Confidential Mode: Split (Deposit & Mint)

```
User                        OptionFactory                 cWETH            P (stableETH)  N (upETH)
 |                               |                          |                |              |
 |-- split(strike,mat,enc,proof)->|                         |                |              |
 |                               |-- transferFrom(user,this)->|              |              |
 |                               |<-- ok -------------------|               |              |
 |                               |-- _reserves += amount     |               |              |
 |                               |-- mint(user, amount) -----|-------------->|              |
 |                               |-- mint(user, amount) -----|------------------------------>|
 |<-- Split event (no amount) --|                           |               |              |
 |                               |                           |               |              |
 | User now holds equal P + N. Sells whichever side they    |               |              |
 | don't want on the ConfidentialMatchingEngine.            |               |              |
```

### Confidential Mode: Sell N (stability seeker lists upETH for cUSDC)

```
Seller                  ConfidentialMatchingEngine          N (upETH)     cUSDC
 |                               |                            |            |
 |-- createListing(N, cUSDC, ...)->|                          |            |
 |                               |-- pullFrom(seller) ------->|            |
 |                               |   (N tokens escrowed)      |            |
 |<-- ListingCreated event ------|                            |            |

Buyer (ETH bull)                 |                            |            |
 |-- fill(id, encPay, encExp) -->|                            |            |
 |                               |-- transferFrom(buyer) -----|----------->|
 |                               |-- FHE match checks         |            |
 |                               |-- if matched:              |            |
 |                               |   mint(buyer, N tokens) -->|            |
 |                               |   transfer(seller, cUSDC) -|----------->|
 |                               |   refund excess to both    |            |
 |<-- FillAttempted event -------|                            |            |
```

### Confidential Mode: Settlement & Redeem

```
Oracle/Anyone           OptionFactory                 cWETH          P              N
 |                           |                          |            |              |
 |-- settle(s,m,price) ---->|                          |            |              |
 |                           |-- compute:               |            |              |
 |                           |   stablePay = min(SCALE,  |            |              |
 |                           |     strike*SCALE/price)   |            |              |
 |                           |   upPay = SCALE-stablePay |            |              |
 |                           |-- encrypt & store        |            |              |
 |<-- Settled event ---------|                          |            |              |

User (holds P only,          |                          |            |              |
 sold N earlier)             |                          |            |              |
 |-- redeem(strike, mat) -->|                          |            |              |
 |                           |-- read stableBal (P) ----|----------->|              |
 |                           |-- read upBal (N) = 0 ----|-------------------------->|
 |                           |-- burn P balance ---------|----------->|              |
 |                           |-- burn N balance (0) -----|-------------------------->|
 |                           |-- FHE: claim = P_bal * stablePay / SCALE              |
 |                           |-- transfer(user, claim) ->|           |              |
 |<-- Redeemed event --------|                          |            |              |
```

### Unshield (Confidential -> Public)

```
User                    UnshieldBridge           Confidential P         Public P
 |                           |                        |                    |
 |-- unshield(s,m,P,100) -->|                        |                    |
 |                           |                        |                    |
 |                           |-- burn(user, 100) ---->|                    |
 |                           |   (encrypted balance   |                    |
 |                           |    decremented by 100) |                    |
 |                           |                        |                    |
 |                           |-- mint(user, 100) -----|------------------>|
 |                           |   (plaintext balance   |                    |
 |                           |    incremented by 100) |                    |
 |                           |                        |                    |
 |<-- Unshielded event ------|                        |                    |
 |   (amount = 100, public)  |                        |                    |
 |                           |                        |                    |
 | User can now trade 100 public P on Uniswap,       |                    |
 | use as collateral in DeFi, etc.                    |                    |
```

---

## Access Control

### Public Mode

| Action | Who Can Call | Enforcement |
|---|---|---|
| `createSeries` | Anyone | No restriction — permissionless |
| `split` | Any user with WETH | Standard ERC-20 balance check (reverts on insufficient) |
| `merge` | Any user with equal P + N | Standard ERC-20 balance check (reverts on insufficient) |
| `settle` | **Anyone** | Only checks `block.timestamp >= maturity` |
| `redeem` | Any user with tokens in settled series | Balance read + burn |
| `mint` / `burn` (PublicOptionToken) | Factory + Bridge only | `onlyAuthorized` modifier |

### Confidential Mode

| Action | Who Can Call | Enforcement |
|---|---|---|
| `createSeries` | Anyone | No restriction — permissionless |
| `split` | Any user with cWETH | Balance check via FHE |
| `merge` | Any user with equal P + N | `FHE.isSenderAllowed` + balance check |
| `settle` | **Anyone** | Only checks `block.timestamp >= maturity` |
| `redeem` | Any user with tokens in settled series | Balance read + burn |
| `mint` / `burn` / `pullFrom` (OptionToken) | Factory + Bridge only | `onlyAuthorized` modifier |
| `createListing` | Any user with P or N tokens | Balance check via FHE |
| `fill` | Any user with quote tokens | Balance check via FHE |
| `cancelListing` | Seller only | `msg.sender == listing.seller` |

### Bridge

| Action | Who Can Call | Enforcement |
|---|---|---|
| `unshield` | Any user with confidential tokens | Burns from encrypted balance, mints public |

---

## Open Items

### 1. Oracle Access Control (Critical)

`settle()` is callable by anyone with any price — in both public and confidential factories. Needs:
- Trusted oracle address whitelist, OR
- Chainlink/Pyth integration with on-chain price verification, OR
- Commit-reveal with dispute period (aligns with Vitalik's "slow oracle" thesis)

Both factories must use the same oracle to ensure consistent settlement across modes.

### 2. Partial Fills (Confidential Mode)

Current engine is all-or-nothing — listing deactivates after one fill attempt. For better liquidity:
- Keep listing active after partial fills
- Track remaining: `l.lockedAmount = tokenBack`
- Challenge: can't check encrypted zero to auto-deactivate
- Alternative: seller re-lists with remaining amount

### 3. OptionToken.pullFrom() Access (Confidential Mode)

The matching engine calls `token.pullFrom()` which has `onlyFactory` modifier. The engine is not the factory, so this reverts. Fix options:
- Add engine authorization to OptionToken
- Switch engine to use `transferFrom` with standard approval flow

### 4. Bridge Reserve Accounting

The UnshieldBridge burns confidential tokens but does not move cWETH/WETH between factories. Options:
- **Option A:** Bridge also transfers cWETH from confidential factory to public factory (requires factory to support reserve withdrawal by bridge)
- **Option B:** Public factory is pre-funded with WETH and the bridge is trusted to keep accounting consistent
- **Option C:** Single collateral pool shared by both factories (more complex but cleanest accounting)

This is a critical design decision — the public factory needs WETH reserves to pay out redeemers.

### 5. Deploy Scripts

`script/` is empty. Needs:
- `DeployPublicFactory.s.sol` — deploy PublicOptionFactory with WETH address
- `DeployConfidentialFactory.s.sol` — deploy OptionFactory with cWETH address
- `DeployEngine.s.sol` — deploy ConfidentialMatchingEngine
- `DeployBridge.s.sol` — deploy UnshieldBridge, authorize on both factories
- `CreateSeries.s.sol` — create initial series in both factories

### 6. Test Suite

`test/` is empty. Priority tests:

**Public mode:**
- Split/merge roundtrip (deposit and withdraw equal WETH)
- Settlement math: price = 0, price = strike, price >> strike, price << strike
- Redeem with one side sold, redeem with both sides held
- Standard ERC-20 behavior (transfer, approve, transferFrom)

**Confidential mode:**
- Split/merge roundtrip (deposit and withdraw equal cWETH)
- Settlement math: same edge cases as public
- Matching engine: successful match, failed match (underpay), failed match (over-request)
- Refund correctness: encrypted zeros on failed match
- Access control: only factory can mint/burn

**Bridge:**
- Unshield P tokens, verify confidential balance decreases and public balance increases
- Unshield N tokens
- Attempt unshield with insufficient balance
- Attempt unshield for non-existent series

### 7. Reentrancy Protection

No reentrancy guards. Add `ReentrancyGuard` to:
- `split`, `merge`, `redeem` (both factories)
- `fill`, `cancelListing` (ConfidentialMatchingEngine)
- `unshield` (UnshieldBridge)

### 8. Pausability

No pause mechanism. Add OpenZeppelin `Pausable` for emergency stops across all contracts.

### 9. `_totalSupply` Tracking (Confidential Mode)

Increments by 1 per mint call regardless of encrypted amount. Options:
- Remove entirely (return 0)
- Accept as known limitation (current approach)

Not applicable to public mode — PublicOptionToken uses standard ERC-20 with accurate `totalSupply`.

### 10. EIP-712 / Permit Support

No gasless approval. Adding `permit` to both token types would let users approve + split or approve + list in a single meta-transaction. PublicOptionToken can use OpenZeppelin's `ERC20Permit` directly.

### 11. Series Synchronization

Both factories must have matching series (same strike/maturity) for the bridge to work. Options:
- Manual creation in both factories
- Bridge or coordinator contract that creates series in both factories atomically
- Factory event listener that auto-creates matching series
