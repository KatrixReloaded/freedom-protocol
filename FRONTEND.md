# Freedom Protocol — Frontend Spec

## Tech Stack

- **Framework:** React / Next.js
- **Wallet:** wagmi + viem (standard EVM wallet connection)
- **FHE Client:** `@zama-fhe/relayer-sdk` (fhevmjs) for client-side encryption, encrypted inputs, and user decryption (EIP-712 signing) — **Confidential Mode only**
- **Contracts:** viem for contract calls
- **State:** zustand or react-query for async state
- **Indexing:** Direct event log queries (no subgraph)

**Note:** Public Mode requires only wagmi + viem. The FHE SDK is lazy-loaded and only initialized when the user switches to Confidential Mode on the Zama fhEVM network.

---

## Contract Addresses (Config)

```ts
interface FreedomContracts {
  // ---- Public Mode ----
  publicOptionFactory: Address;   // PublicOptionFactory — split, merge, settle, redeem (plaintext)
  publicMarketRouter: Address;    // DEX router / public orderbook (if applicable)
  WETH: Address;                  // Standard WETH

  // ---- Confidential Mode ----
  optionFactory: Address;         // OptionFactory — split, merge, settle, redeem (FHE)
  matchingEngine: Address;        // ConfidentialMatchingEngine — listings, fills
  cWETH: Address;                 // Confidential WETH (ERC-7984 wrapper)
  quoteTokens: Record<string, Address>;  // { cUSDC: "0x...", cDAI: "0x..." }

  // ---- Bridge ----
  unshieldBridge: Address;        // Burns confidential P/N, mints public P/N
}
```

---

## Contract ABIs & Integration Reference

### Public Mode ABIs

#### PublicOptionFactory

```
seriesId(uint256 strike, uint64 maturity) → bytes32                          [pure]
getTokens(uint256 strike, uint64 maturity) → (address stable, address up)    [view]
isSettled(uint256 strike, uint64 maturity) → bool                            [view]
SCALE() → uint64                                                             [view, returns 1_000_000]

createSeries(uint256 strike, uint64 maturity) → (address stable, address up)
split(uint256 strike, uint64 maturity, uint256 amount)
merge(uint256 strike, uint64 maturity, uint256 amount)
settle(uint256 strike, uint64 maturity, uint256 oraclePrice)
redeem(uint256 strike, uint64 maturity)
```

#### Public OptionToken (standard ERC-20)

```
name() → string                                                             [view]
symbol() → string                                                           [view]
decimals() → uint8                                                           [view, returns 6]
balanceOf(address account) → uint256                                         [view]
totalSupply() → uint256                                                      [view]

approve(address spender, uint256 amount) → bool
transfer(address to, uint256 amount) → bool
transferFrom(address from, address to, uint256 amount) → bool

factory() → address                                                          [view]
strike() → uint256                                                           [view]
maturity() → uint64                                                          [view]
isStable() → bool                                                            [view]
```

#### UnshieldBridge

```
unshield(address confidentialToken, uint256 amount)
  // Burns confidential P/N, mints public P/N of the same series
  // One-way: confidential → public only
```

### Confidential Mode ABIs

#### OptionFactory

```
seriesId(uint256 strike, uint64 maturity) → bytes32                          [pure]
getTokens(uint256 strike, uint64 maturity) → (address stable, address up)    [view]
isSettled(uint256 strike, uint64 maturity) → bool                            [view]
SCALE() → uint64                                                             [view, returns 1_000_000]

createSeries(uint256 strike, uint64 maturity) → (address stable, address up)
split(uint256 strike, uint64 maturity, externalEuint64 encAmt, bytes proof)
merge(uint256 strike, uint64 maturity, euint64 amount)
settle(uint256 strike, uint64 maturity, uint256 oraclePrice)
redeem(uint256 strike, uint64 maturity)
```

#### ConfidentialMatchingEngine

```
nextListingId() → uint256                                                    [view]
getListing(uint256 id) → (address seller, address token, address quoteToken,
                          uint256 strike, uint64 maturity, bool active)       [view]

createListing(OptionToken token, IConfidentialQuoteToken quoteToken,
              uint256 strike, uint64 maturity,
              externalEuint64 encAmount, externalEuint64 encMinReceive,
              bytes amountProof, bytes minProof) → uint256 listingId

fill(uint256 listingId,
     externalEuint64 encPayment, externalEuint64 encExpected,
     bytes paymentProof, bytes expectedProof)

cancelListing(uint256 listingId)
```

#### ConfidentialERC20Base (shared by OptionToken, cWETH, cUSDC, etc.)

```
name() → string                                                             [view]
symbol() → string                                                           [view]
decimals() → uint8                                                           [view, returns 6]
balanceOf(address account) → euint64                                         [view, returns handle]

approve(address spender, externalEuint64 encAmount, bytes proof) → bool
transfer(address to, externalEuint64 encAmount, bytes proof) → bool
transferFrom(address from, address to, externalEuint64 encAmount, bytes proof) → bool
```

#### ConfidentialOptionToken (extends ConfidentialERC20Base)

```
factory() → address                                                          [view]
strike() → uint256                                                           [view]
maturity() → uint64                                                          [view]
isStable() → bool                                                            [view]
```

**Key:** All token decimals are **6** (not 18). `SCALE = 1_000_000` represents 1.0. Format all displayed values accordingly.

---

## Encryption Helpers (Confidential Mode Only)

These helpers are only used in Confidential Mode. Public Mode uses standard uint256 amounts with no encryption.

```ts
// Single encrypted value (for split, approve, transfer)
async function encryptSingle(
  contractAddr: Address,
  userAddr: Address,
  value: bigint
): Promise<{ handle: externalEuint64; proof: bytes }> {
  const input = instance.createEncryptedInput(contractAddr, userAddr);
  input.addU64(value);
  const { handles, inputProof } = await input.encrypt();
  return { handle: handles[0], proof: inputProof };
}

// Two encrypted values (for createListing, fill — separate proofs each)
async function encryptPair(
  contractAddr: Address,
  userAddr: Address,
  value1: bigint,
  value2: bigint
): Promise<{
  handle1: externalEuint64; proof1: bytes;
  handle2: externalEuint64; proof2: bytes;
}> {
  const input1 = instance.createEncryptedInput(contractAddr, userAddr);
  input1.addU64(value1);
  const enc1 = await input1.encrypt();

  const input2 = instance.createEncryptedInput(contractAddr, userAddr);
  input2.addU64(value2);
  const enc2 = await input2.encrypt();

  return {
    handle1: enc1.handles[0], proof1: enc1.inputProof,
    handle2: enc2.handles[0], proof2: enc2.inputProof,
  };
}
```

---

## Mode Toggle

```
┌────────────────────────────────────────────────────────────┐
│  Freedom Protocol                          [Connect Wallet]│
│                                                            │
│  ┌──────────────────────────────────┐                      │
│  │  [ Public ]  |  Confidential     │                      │
│  └──────────────────────────────────┘                      │
│                                                            │
│  Public mode is selected by default.                       │
│  Confidential mode requires Zama fhEVM network.            │
│  Switching to Confidential prompts network switch if       │
│  user is not already on the fhEVM chain.                   │
└────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Default: Public mode — standard Web3 UX, no FHE, no encryption
- Toggle persisted in localStorage
- Switching to Confidential: prompt wallet to switch to Zama fhEVM network, lazy-load FHE SDK
- Switching to Public: no network requirement beyond standard EVM
- Navigation tabs update to show the appropriate pages for each mode

---

## Pages

---

### Public Mode Pages

Public Mode is the default experience. All balances and amounts are plaintext. No FHE, no encryption helpers, no reveal buttons. Standard Web3 UX.

---

#### Public 1. Deposit & Split

The entry point for Public Mode. User deposits ETH or WETH and splits into public P + N tokens (standard ERC-20).

```
┌─────────────────────────────────────────────────┐
│  Deposit & Split                                │
│                                                 │
│  From: ETH or WETH                              │
│  Amount: [________] ETH           [MAX]         │
│  Balance: 4.2 ETH                               │
│                                                 │
│  Strike: [ ▼ dropdown ]                         │
│    $500 | $750 | $1000 | $1500                  │
│    Recommended: S < current_price / 2           │
│                                                 │
│  Maturity: [ ▼ dropdown ]                       │
│    AUG 2026 | SEP 2026 | OCT 2026              │
│                                                 │
│  Series status: [Active / Not created]          │
│                                                 │
│  You will receive:                              │
│  • stableETH-1000-AUG26 (P): X tokens          │
│  • upETH-1000-AUG26 (N): X tokens              │
│                                                 │
│  Current ETH price: $2,050 (from oracle)        │
│  At this strike ($1000) and current price:      │
│                                                 │
│  P (stableETH) ≈ 0.488 WETH/token ≈ $1,000     │
│    Tracks $1,000 in USD while ETH > $1000       │
│    ETH must fall 51% before P starts drifting   │
│                                                 │
│  N (upETH) ≈ 0.512 WETH/token ≈ $1,050         │
│    Leveraged call — all upside above $1000      │
│    Goes to zero if ETH falls to $1000           │
│                                                 │
│  [Deposit & Split]                              │
│  2-tx: approve WETH → split                    │
└─────────────────────────────────────────────────┘
```

**Frontend logic:**

```
1. User enters ETH/WETH amount (plaintext)
2. If ETH: TX 0: WETH.deposit{value: amount}()
3. User selects strike and maturity
4. Check series: publicFactory.getTokens(strike, maturity)
   if stableAddr == ZeroAddress → show "Not created" + create button
5. If series doesn't exist:
   TX 1: publicFactory.createSeries(strike, maturity)
6. TX 2: WETH.approve(publicFactoryAddr, amount)
7. TX 3: publicFactory.split(strike, maturity, amount)
8. Show new P + N balances (plaintext, standard balanceOf)
```

**Notes:**
- All amounts are VISIBLE — no encryption, no reveal buttons
- Standard ERC-20 approval flow
- Output tokens are standard ERC-20, composable with all DeFi

---

#### Public 2. Portfolio

Standard ERC-20 balance display. No encrypted values, no reveal buttons.

```
┌─────────────────────────────────────────────────────────────┐
│  My Portfolio                                               │
│                                                             │
│  Balances                                                   │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  WETH                                        1.200000  │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  stableETH-1000-AUG26 (P)                   2.000000  │ │
│  │  upETH-1000-AUG26 (N)                       2.000000  │ │
│  │  ↳ P tracks ~$1,000 | N = leveraged call above $1,000 │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  stableETH-1500-SEP26 (P)                   0.500000  │ │
│  │  upETH-1500-SEP26 (N)                       0.500000  │ │
│  │  ↳ P tracks ~$1,500 | N = leveraged call above $1,500 │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Actions:                                                   │
│  [ Deposit More ]  [ Split ]  [ Merge ]  [ Trade P or N ]  │
│                                                             │
│  Stablecoin Usage (P tokens)                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Your public P tokens are standard ERC-20. Use them:   │ │
│  │  • Provide liquidity on Uniswap (P/USDC pair)          │ │
│  │  • Deposit as collateral on Aave                       │ │
│  │  • Use as stablecoin replacement across DeFi           │ │
│  │  P tracks ~$S in USD — it IS the stablecoin.           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Settled Positions (claimable)                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  stableETH-750-JUL26 (P)  SETTLED                     │ │
│  │  Oracle price: $3,012 | P payout: 0.249 WETH/token    │ │
│  │  Your balance: 3.000000 P                              │ │
│  │  You will receive: 0.747 WETH                          │ │
│  │  [Redeem All] → WETH                                   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**How to discover user's series:**

```
1. Query SeriesCreated events from PublicOptionFactory
2. For each series, call token.balanceOf(userAddr) for both P and N
3. Filter to non-zero balances (balances are plaintext — can filter)
4. Display with standard balance formatting (6 decimals)
```

**Merge flow (from portfolio):**

```
1. User must hold equal amounts of BOTH P and N for the same series
2. TX: publicFactory.merge(strike, maturity, amount)
   - Standard uint256 amount, no encryption
```

---

#### Public 3. Market

Standard orderbook or DEX integration. All amounts and prices visible.

```
┌──────────────────────────────────────────────────────────────┐
│  Trade                                                       │
│                                                              │
│  ┌─── Swap P or N tokens ────────────────────────────────┐  │
│  │                                                        │  │
│  │  Sell: [ ▼ stableETH-1000-AUG26 (P) ]                 │  │
│  │  Amount: [________]                                    │  │
│  │  Balance: 2.000000                                     │  │
│  │                                                        │  │
│  │  Buy: [ ▼ USDC / WETH / upETH-1000-AUG26 (N) ]       │  │
│  │  Estimated output: 1,985.42 USDC                      │  │
│  │  Price impact: 0.12%                                   │  │
│  │                                                        │  │
│  │  Route: Uniswap V3 (P/USDC 0.3%)                      │  │
│  │                                                        │  │
│  │  [ Approve & Swap ]                                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Fair value guidance (current ETH = $2,050):                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  P (stableETH-1000-AUG26): ≈ $1,000/token             │  │
│  │  N (upETH-1000-AUG26): ≈ $1,050/token                 │  │
│  │  P + N = 1 WETH always (before maturity)               │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Liquidity Pools                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Pool               TVL         APR       Action       │  │
│  │  P-1000-AUG26/USDC  $2.4M      8.2%      [Add LP]     │  │
│  │  N-1000-AUG26/WETH  $1.1M      12.4%     [Add LP]     │  │
│  │  P-1500-SEP26/USDC  $890K      6.8%      [Add LP]     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Frontend logic:**

```
1. Standard approve + swap via DEX router (Uniswap, etc.)
2. All amounts plaintext — standard Web3 trading UX
3. Can also show an onchain orderbook if one exists
4. P tokens tradeable as stablecoin on any DEX
```

**Fair value guidance logic (client-side):**

```ts
function fairValueHint(isStable: boolean, strike: number, currentPrice: number): string {
  if (isStable) {
    if (currentPrice > strike) return `≈ $${strike}/token (tracks strike in USD)`;
    return `≈ $${currentPrice}/token (in drift — below strike)`;
  } else {
    const nValue = Math.max(0, currentPrice - strike);
    return `≈ $${nValue}/token (leveraged upside above $${strike})`;
  }
}
```

---

#### Public 4. Settle & Redeem

Plaintext payout math. Standard claim flow.

```
┌───────────────────────────────────────────────────────────┐
│  Settle & Redeem                                          │
│                                                           │
│  ┌──────────────── Unsettled ──────────────────────────┐  │
│  │  stableETH/upETH-1000-AUG26                         │  │
│  │  Maturity: Aug 15, 2026 (PAST)                      │  │
│  │  Status: MATURED — awaiting settlement               │  │
│  │                                                      │  │
│  │  Oracle price (USD): [________]                      │  │
│  │  [ Settle Series ]                                   │  │
│  │                                                      │  │
│  │  ⚠ Settlement is currently permissionless.           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌──────────────── Settled ────────────────────────────┐  │
│  │  stableETH/upETH-750-JUL26                          │  │
│  │  Oracle price: $3,012 | Strike: $750                │  │
│  │                                                      │  │
│  │  Payout rates (SCALE = 1,000,000):                   │  │
│  │  P (stableETH): min(1, 750/3012) = 0.249 WETH/tok   │  │
│  │    → ≈ $750 per P token (tracks strike)              │  │
│  │  N (upETH): 1 - 0.249 = 0.751 WETH/tok              │  │
│  │    → ≈ $2,262 per N token (captured upside)          │  │
│  │                                                      │  │
│  │  Your holdings:                                      │  │
│  │  stableETH-750-JUL26 (P): 3.000000                  │  │
│  │  upETH-750-JUL26 (N):     0.000000                  │  │
│  │                                                      │  │
│  │  Estimated payout: 0.747 WETH (≈ $2,250)            │  │
│  │                                                      │  │
│  │  [ Redeem All ]                                      │  │
│  │  Burns your ENTIRE balance of both P and N.          │  │
│  │  Partial redemption not supported.                   │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

**Settle flow:**

```
1. Query SeriesCreated events to find all series
2. Check: block.timestamp >= maturity AND !publicFactory.isSettled(strike, maturity)
3. User enters oracle price (uint256, same scale as strike)
4. TX: publicFactory.settle(strike, maturity, oraclePrice)
   - Computes: stablePay = min(SCALE, strike * SCALE / oraclePrice)
   - Emits Settled(seriesId, oraclePrice)
5. ⚠ Currently permissionless — production needs oracle access control
```

**Redeem flow:**

```
1. Verify publicFactory.isSettled(strike, maturity) == true
2. Read balances: pBal = pToken.balanceOf(user), nBal = nToken.balanceOf(user)
3. TX: publicFactory.redeem(strike, maturity)
   - Burns ENTIRE balance of both P and N
   - claim = (pBal * stablePay + nBal * upPay) / SCALE
   - Transfers WETH to user (plaintext)
4. No partial redeem — full balance consumed
```

---

#### Public 5. Stablecoin Usage

Dedicated section showing how public P tokens serve as stablecoin replacements.

```
┌───────────────────────────────────────────────────────────┐
│  P Token as Stablecoin                                    │
│                                                           │
│  Your stableETH-1000-AUG26 (P) tokens track ~$1,000      │
│  in USD value. They are standard ERC-20 tokens usable     │
│  across all of DeFi.                                      │
│                                                           │
│  Use cases:                                               │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Uniswap: Provide P/USDC liquidity       [Go →]    │  │
│  │  Aave: Deposit P as collateral            [Go →]    │  │
│  │  Transfer: Send P as payment              [Send]    │  │
│  │  Hold: P tracks ~$S while ETH > S         —         │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  Why P replaces USDC:                                     │
│  • Backed by ETH locked in Freedom contracts              │
│  • No custodian, no issuer, no bank account               │
│  • Redeemable for ETH at maturity                         │
│  • Value derived from ETH/USD price math, not a peg       │
│                                                           │
│  Risk: If ETH falls below strike ($1,000), P starts       │
│  drifting below $1,000. Choose a low strike for safety.   │
└───────────────────────────────────────────────────────────┘
```

---

### Confidential Mode Pages

Confidential Mode uses FHE encryption via the Zama fhEVM. All balances are encrypted on-chain. Only the token holder can decrypt and view their balances. Requires the FHE SDK and Zama fhEVM network.

---

#### Confidential 1. Shield & Split (Deposit)

The entry point for Confidential Mode. User converts ETH into cWETH, then splits into confidential P + N.

##### Step 1: Wrap & Shield

```
┌─────────────────────────────────────────────────┐
│  Shield ETH                                     │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  From: ETH                                │  │
│  │  Amount: [________] ETH        [MAX]      │  │
│  │  Balance: 4.2 ETH                         │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│           ↓  wraps to WETH, then shields        │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  To: cWETH (confidential)                 │  │
│  │  Amount: [encrypted — hidden after tx]    │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  [ Shield ETH ]                                 │
│                                                 │
│  3-tx flow:                                     │
│  1. ETH → WETH (wrap)                           │
│  2. Approve WETH to ERC-7984 wrapper             │
│  3. WETH → cWETH (shield via ERC-7984 wrapper)   │
│                                                 │
│  After shielding, your balance is encrypted.    │
│  Only you can view it.                          │
└─────────────────────────────────────────────────┘
```

**Frontend logic:**

```
1. User enters ETH amount (plaintext — last time it's visible)
2. TX 1: WETH.deposit{value: amount}()
3. TX 2: WETH.approve(erc7984Wrapper, amount)
4. TX 3: erc7984Wrapper.shield(amount)
   - SDK encrypts client-side: encryptSingle(wrapperAddr, userAddr, amount)
   - Submits (externalEuint64, inputProof) to wrapper
5. UI updates: "cWETH balance: [Reveal]"
```

##### Step 2: Split into P + N

```
┌─────────────────────────────────────────────────────┐
│  Split cWETH into Options                           │
│                                                     │
│  cWETH Balance: ●●●●●● [Reveal]                    │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Amount to split: [________] cWETH            │  │
│  │                                               │  │
│  │  Strike price:  [ ▼ dropdown ]                │  │
│  │    $500 | $750 | $1000 | $1500                │  │
│  │    Recommended: S < current_price / 2         │  │
│  │                                               │  │
│  │  Maturity:      [ ▼ dropdown ]                │  │
│  │    AUG 2026 | SEP 2026 | OCT 2026            │  │
│  │                                               │  │
│  │  Series status: [Active / Not created]        │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  You will receive:                                  │
│  ┌───────────────────────────────────────────────┐  │
│  │  stableETH-1000-AUG26 (P): [encrypted amt]   │  │
│  │  upETH-1000-AUG26 (N):     [encrypted amt]   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Current ETH price: $2,050 (from oracle)            │
│  At this strike ($1000) and current price:          │
│                                                     │
│  P (stableETH) ≈ 0.488 cWETH/token ≈ $1,000/token  │
│    Tracks $1,000 in USD while ETH stays above $1000 │
│    ETH must fall 51% before P starts drifting        │
│                                                     │
│  N (upETH) ≈ 0.512 cWETH/token ≈ $1,050/token      │
│    Leveraged call — captures all upside above $1000  │
│    Goes to zero if ETH falls to $1000 at maturity    │
│                                                     │
│  [ Approve & Split ]                                │
└─────────────────────────────────────────────────────┘
```

**Frontend logic:**

```
1. User selects strike and maturity
2. Check series: factory.getTokens(strike, maturity)
   if stableAddr == ZeroAddress → show "Not created" + create button
3. If series doesn't exist:
   TX 0: factory.createSeries(strike, maturity)
4. User enters split amount (plaintext, 6 decimals)
5. Encrypt: encryptSingle(factoryAddr, userAddr, scaledAmount)
6. TX 1: cWETH.approve(factoryAddr, encAmount, proof)
7. TX 2: factory.split(strike, maturity, encAmount, proof)
8. Clear input. Show new P + N balances as ●●●●●● [Reveal]
```

**Payout estimate calculation (client-side, for display only):**

```ts
function estimatePayouts(strike: number, currentPrice: number) {
  const pPerToken = Math.min(1, strike / currentPrice); // cWETH
  const nPerToken = Math.max(0, 1 - strike / currentPrice); // cWETH
  const pUSD = pPerToken * currentPrice; // ≈ strike when deep ITM
  const nUSD = nPerToken * currentPrice; // ≈ currentPrice - strike
  const buffer = ((currentPrice - strike) / currentPrice) * 100; // % drop before drift
  return { pPerToken, nPerToken, pUSD, nUSD, buffer };
}
```

---

#### Confidential 2. Portfolio

User's encrypted positions across all series.

```
┌─────────────────────────────────────────────────────────────┐
│  My Portfolio (Confidential)                                │
│                                                             │
│  Confidential Balances          [Reveal All] [Hide All]     │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  cWETH                           ●●●●●● [Reveal]      │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  stableETH-1000-AUG26 (P)        ●●●●●● [Reveal]      │ │
│  │  upETH-1000-AUG26 (N)            ●●●●●● [Reveal]      │ │
│  │  ↳ P tracks ~$1,000 | N = leveraged call above $1,000  │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  stableETH-1500-SEP26 (P)        ●●●●●● [Reveal]      │ │
│  │  upETH-1500-SEP26 (N)            ●●●●●● [Reveal]      │ │
│  │  ↳ P tracks ~$1,500 | N = leveraged call above $1,500  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  Actions:                                                   │
│  [ Shield More ]  [ Split ]  [ Merge ]  [ Sell P or N ]     │
│                                                             │
│  Settled Positions (claimable)                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  stableETH-750-JUL26 (P)  SETTLED                     │ │
│  │  Oracle price: $3,012 | P payout: 0.249 cWETH/token   │ │
│  │  [Redeem All] → cWETH                                  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**How to discover user's series:**

```
1. Query SeriesCreated events from OptionFactory
2. For each series, call token.balanceOf(userAddr) for both P and N
3. Display all series (balances are encrypted — can't filter by non-zero)
4. User reveals individual balances to see which ones they hold
```

**Reveal flow:**

```
1. User clicks [Reveal]
2. Read handle: token.balanceOf(userAddr) → euint64
3. SDK: userDecrypt(handle, eip712Signature)
4. Display formatted value (6 decimals)
5. Auto-hide after 30s
```

**Merge flow (from portfolio):**

```
1. User must hold equal amounts of BOTH P and N for the same series
2. If they've sold one side, merge is not possible — they must wait
   for settlement and redeem instead
3. TX: factory.merge(strike, maturity, euint64 amount)
   - Takes an already-resolved euint64 handle (not externalEuint64)
   - Requires FHE.isSenderAllowed(amount)
```

---

#### Confidential 3. Market (Options Trading)

Three tabs: **Sell**, **Buy**, **My Listings**.

Both P and N tokens can be listed for sale. The market is symmetric.

**Common use cases:**
- Stability seeker sells N (upETH) for cUSDC → keeps P for USD stability
- ETH bull sells P (stableETH) for cUSDC → keeps N for leveraged upside
- Rebalancer sells old P, buys new P with lower strike

##### Sell Tab

```
┌─────────────────────────────────────────────────────┐
│  Sell                                               │
│                                                     │
│  What are you selling?                              │
│  Token: [ ▼ stableETH-1000-AUG26 (P) ]             │
│         [ ▼ upETH-1000-AUG26 (N) ]                  │
│  Balance: ●●●●●● [Reveal]                          │
│                                                     │
│  Amount to sell:   [________]                       │
│  I want to receive: [ ▼ cUSDC / cDAI / cWETH ]     │
│  Minimum total:    [________]                       │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Fair value guidance (current ETH = $2,050):  │  │
│  │                                               │  │
│  │  If selling P (stableETH-1000-AUG26):         │  │
│  │    P ≈ $1,000/token (tracks strike in USD)    │  │
│  │                                               │  │
│  │  If selling N (upETH-1000-AUG26):             │  │
│  │    N ≈ $1,050/token (current_price - strike)  │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Summary                                      │  │
│  │  Public on-chain:                             │  │
│  │  • Token type (P or N), series, quote token   │  │
│  │  • Your address (seller)                      │  │
│  │                                               │  │
│  │  Encrypted on-chain:                          │  │
│  │  • Amount for sale                            │  │
│  │  • Minimum payment                            │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [ Approve & List ]                                 │
└─────────────────────────────────────────────────────┘
```

**Frontend logic:**

```
1. User selects token (P or N) from their holdings
2. User types sell amount and minimum payment (plaintext, 6 decimals)
3. Encrypt as separate inputs (contract expects two proofs):
   encryptPair(engineAddr, userAddr, sellAmount, minPayment)
4. TX 1: optionToken.approve(engineAddr, encSellAmount, proof)
   NOTE: Contract issue — engine calls pullFrom() which is onlyFactory.
   Frontend should be ready for transferFrom-based fix.
5. TX 2: engine.createListing(
     tokenAddr, quoteTokenAddr, strike, maturity,
     handle1, handle2, proof1, proof2
   )
6. ListingCreated event emitted with public metadata
```

##### Buy Tab

```
┌──────────────────────────────────────────────────────────────┐
│  Buy                                                         │
│                                                              │
│  Filters:                                                    │
│  Token: [ ▼ stableETH (P) / upETH (N) / All ]              │
│  Strike: [ ▼ All / 500 / 750 / 1000 / 1500 ]                │
│  Maturity: [ ▼ All / AUG26 / SEP26 / OCT26 ]                │
│  Quote: [ ▼ cUSDC / cDAI / cWETH ]                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Active Listings                                       │  │
│  │                                                        │  │
│  │  #   Token                    Quote   Seller    Action │  │
│  │  12  upETH-1000-AUG26 (N)    cUSDC   0xab..cd  [Fill] │  │
│  │  15  stableETH-1000-AUG26(P) cUSDC   0xef..12  [Fill] │  │
│  │  18  upETH-1500-SEP26 (N)    cDAI    0x34..56  [Fill] │  │
│  │                                                        │  │
│  │  Amount and min price are encrypted.                   │  │
│  │  Submit what you think is fair. If it meets the        │  │
│  │  seller's minimum, the trade executes. If not, you     │  │
│  │  get a full refund. Listing is consumed either way.    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Fill Listing #12 — upETH-1000-AUG26 (N)                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  You are buying: N (leveraged ETH call, strike $1000)  │  │
│  │  N ≈ $1,050/token at current ETH price ($2,050)        │  │
│  │  N goes to zero if ETH ≤ $1,000 at maturity            │  │
│  │                                                        │  │
│  │  I want to buy:  [________] upETH                      │  │
│  │  I will pay:     [________] cUSDC                      │  │
│  │                                                        │  │
│  │  ⚠ Both values encrypted before submission.            │  │
│  │  All-or-nothing: listing deactivated after any fill.   │  │
│  │                                                        │  │
│  │  [ Approve & Fill ]                                    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Listing data loading:**

```
1. Query ListingCreated events:
   event ListingCreated(uint256 indexed listingId, address indexed seller,
                        address token, address quoteToken,
                        uint256 strike, uint64 maturity)
2. Filter out: ListingCancelled and FillAttempted events
3. Or call getListing(id) to confirm active status
4. Resolve P/N from OptionToken: token.isStable() → true = P, false = N
5. Resolve series from OptionToken: token.strike(), token.maturity()
```

**Fill flow:**

```
1. User enters desired amount and payment (plaintext, 6 decimals)
2. Encrypt as separate inputs:
   encryptPair(engineAddr, userAddr, paymentAmount, expectedAmount)
3. TX 1: quoteToken.approve(engineAddr, encPayment, paymentProof)
4. TX 2: engine.fill(listingId, handle1, handle2, proof1, proof2)
5. Contract runs FHE match → 4 encrypted transfers regardless of outcome
6. Listing deactivated (all-or-nothing)
```

**Post-fill UX:**

```
┌─────────────────────────────────────────────────┐
│  Fill submitted for listing #12                 │
│                                                 │
│  Match result is encrypted — a match and a      │
│  refund look identical on-chain (4 encrypted    │
│  transfers either way).                         │
│                                                 │
│  Reveal your balances to check:                 │
│  upETH-1000-AUG26 (N): ●●●●●● [Reveal]         │
│  cUSDC:                 ●●●●●● [Reveal]         │
│                                                 │
│  [ View Portfolio ]                             │
└─────────────────────────────────────────────────┘
```

##### My Listings

```
┌─────────────────────────────────────────────────────────────┐
│  My Listings                                                │
│                                                             │
│  #   Token                     Quote   Status      Action   │
│  12  upETH-1000-AUG26 (N)     cUSDC   Active      [Cancel] │
│  19  stableETH-1500-SEP26 (P) cDAI    Filled/Exp. —        │
│  23  upETH-750-AUG26 (N)      cUSDC   Cancelled   —        │
│                                                             │
│  All-or-nothing: after a fill attempt, the listing          │
│  deactivates regardless of match outcome. Reveal            │
│  balances to check what happened.                           │
└─────────────────────────────────────────────────────────────┘
```

**Status derivation:**
- `Active`: getListing(id).active == true
- `Filled/Exp.`: !active AND FillAttempted event exists
- `Cancelled`: !active AND ListingCancelled event exists

---

#### Confidential 4. Settle & Redeem

```
┌───────────────────────────────────────────────────────────┐
│  Settle & Redeem (Confidential)                           │
│                                                           │
│  ┌──────────────── Unsettled ──────────────────────────┐  │
│  │  stableETH/upETH-1000-AUG26                         │  │
│  │  Maturity: Aug 15, 2026 (PAST)                      │  │
│  │  Status: MATURED — awaiting settlement               │  │
│  │                                                      │  │
│  │  Oracle price (USD): [________]                      │  │
│  │  [ Settle Series ]                                   │  │
│  │                                                      │  │
│  │  ⚠ Settlement is currently permissionless.           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌──────────────── Settled ────────────────────────────┐  │
│  │  stableETH/upETH-750-JUL26                          │  │
│  │  Oracle price: $3,012 | Strike: $750                │  │
│  │                                                      │  │
│  │  Payout rates (SCALE = 1,000,000):                   │  │
│  │  P (stableETH): min(1, 750/3012) = 0.249 cWETH/tok  │  │
│  │    → ≈ $750 per P token (tracks strike)              │  │
│  │  N (upETH): 1 - 0.249 = 0.751 cWETH/tok             │  │
│  │    → ≈ $2,262 per N token (captured upside)          │  │
│  │                                                      │  │
│  │  Your holdings:                                      │  │
│  │  stableETH-750-JUL26 (P): ●●●●●● [Reveal]           │  │
│  │  upETH-750-JUL26 (N):     ●●●●●● [Reveal]           │  │
│  │                                                      │  │
│  │  [ Redeem All ]                                      │  │
│  │  Burns your ENTIRE balance of both P and N.          │  │
│  │  Partial redemption not supported.                   │  │
│  │                                                      │  │
│  │  If you sold one side, that balance is 0 —           │  │
│  │  you only receive payout from the side you held.     │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

**Settle flow:**

```
1. Query SeriesCreated events to find all series
2. Check: block.timestamp >= maturity AND !factory.isSettled(strike, maturity)
3. User enters oracle price (uint256, same scale as strike)
4. TX: factory.settle(strike, maturity, oraclePrice)
   - Computes: stablePay = min(SCALE, strike * SCALE / oraclePrice)
   - Emits Settled(seriesId, oraclePrice)
5. ⚠ Currently permissionless — production needs oracle access control
```

**Redeem flow:**

```
1. Verify factory.isSettled(strike, maturity) == true
2. TX: factory.redeem(strike, maturity)
   - Burns ENTIRE balance of both P and N
   - FHE: claim = (pBal * stablePay + nBal * upPay) / SCALE
   - Transfers encrypted cWETH to user
   - Emits Redeemed(user, seriesId)
3. If user sold N earlier: nBal = 0, only P payout received
4. If user sold P earlier: pBal = 0, only N payout received
5. No partial redeem — full balance consumed
```

---

#### Confidential 5. Unshield cWETH (Exit)

```
┌─────────────────────────────────────────────────┐
│  Unshield cWETH                                 │
│                                                 │
│  cWETH Balance: ●●●●●● [Reveal]                │
│                                                 │
│  Amount to unshield: [________]                 │
│                                                 │
│  You will receive:                              │
│  ┌───────────────────────────────────────────┐  │
│  │  WETH (plaintext, visible on-chain)       │  │
│  │  [ ] Auto-unwrap to ETH                   │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ⚠ Unshielding makes the amount public.         │
│  Only unshield what you need.                   │
│                                                 │
│  [ Unshield ]                                   │
└─────────────────────────────────────────────────┘
```

---

### Bridge Page

Available from both modes. Converts confidential P/N tokens to public P/N tokens.

#### Unshield P/N: Confidential → Public

One-way bridge: burns confidential P or N tokens and mints the equivalent public P or N tokens of the same series. Cannot go public → confidential for P/N (though cWETH shielding is a separate flow).

```
┌─────────────────────────────────────────────────────────────┐
│  Unshield P/N Tokens                                        │
│                                                             │
│  Convert confidential P or N tokens to public (standard     │
│  ERC-20) tokens. This reveals the amount on-chain.          │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Token: [ ▼ select confidential token ]                 ││
│  │    stableETH-1000-AUG26 (P) — confidential              ││
│  │    upETH-1000-AUG26 (N) — confidential                   ││
│  │    stableETH-1500-SEP26 (P) — confidential               ││
│  │                                                         ││
│  │  Confidential balance: ●●●●●● [Reveal]                  ││
│  │                                                         ││
│  │  Amount to unshield: [________]                          ││
│  │                                                         ││
│  │  You will receive:                                       ││
│  │  stableETH-1000-AUG26 (P) — public (standard ERC-20)    ││
│  │                                                         ││
│  │  ⚠ This is one-way. You cannot re-shield P/N tokens.    ││
│  │  ⚠ The amount will be visible on-chain after unshield.   ││
│  │                                                         ││
│  │  Why unshield?                                           ││
│  │  • Use P as stablecoin in DeFi (Uniswap, Aave, etc.)    ││
│  │  • Trade N on public DEXes for better liquidity          ││
│  │  • Standard ERC-20 composability                         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  [ Approve & Unshield ]                                     │
│  2-tx: approve confidential token → unshield via bridge     │
└─────────────────────────────────────────────────────────────┘
```

**Frontend logic:**

```
1. User selects which confidential P or N token to unshield
2. User enters amount (plaintext — this is intentional, unshielding reveals the amount)
3. TX 1: confidentialToken.approve(unshieldBridgeAddr, encAmount, proof)
4. TX 2: unshieldBridge.unshield(confidentialTokenAddr, amount)
   - Burns confidential token
   - Mints equivalent public token of the same series
5. User now holds public (standard ERC-20) P or N tokens
6. These can be used across all DeFi protocols
```

**Key constraints:**
- One-way only: confidential → public. Cannot re-shield P/N tokens.
- cWETH shielding/unshielding is a separate flow on the Confidential Unshield page.
- The amount entered is plaintext — the user is intentionally revealing it.

---

## Encryption Boundary (Confidential Mode Only)

```
                    Browser (plaintext)
                         │
         instance.createEncryptedInput(contractAddr, userAddr)
              .addU64(amount)        // 6-decimal scaled uint64
              .encrypt()
                         │
                    ─── encryption boundary ───
                         │
              (externalEuint64, bytes proof)
                         │
                    Chain (ciphertext)
```

---

## Component Hierarchy

```
App
├── Header
│   ├── WalletConnect (wagmi)
│   ├── NetworkIndicator (Ethereum mainnet / Sepolia / Zama fhEVM)
│   └── ModeToggle
│       ├── [Public] (default, active state)
│       └── [Confidential] (requires Zama fhEVM network)
│
├── ─── PUBLIC MODE ───────────────────────────────────
│
├── PublicDepositPage
│   ├── DepositForm
│   │   ├── AmountInput (decimals: 6)
│   │   ├── StrikeSelector (dropdown — recommended S < price/2)
│   │   ├── MaturitySelector (dropdown)
│   │   ├── SeriesStatus (exists? publicFactory.getTokens)
│   │   ├── CreateSeriesButton (if not exists)
│   │   ├── PayoutEstimate (P tracks ~$S, N ≈ $(price-S), buffer %)
│   │   ├── TxStepper (wrap ETH? → approve WETH → split)
│   │   └── ConfirmationBanner
│   └── StablecoinUsageCard (links to DeFi integrations for P)
│
├── PublicPortfolioPage
│   ├── BalanceList
│   │   └── BalanceRow (per token)
│   │       ├── TokenLabel (P/N indicator from isStable())
│   │       ├── SeriesAnnotation ("P tracks ~$S" or "N = call above $S")
│   │       └── PlaintextBalance (standard balanceOf, 6 decimals)
│   ├── StablecoinUsageSection (how to use P in DeFi)
│   ├── SettledPositions (filtered by publicFactory.isSettled)
│   │   ├── PayoutInfo (oracle price, rate, USD values, estimated payout)
│   │   └── RedeemButton (full balance only)
│   └── ActionBar (Deposit / Split / Merge / Trade P or N)
│
├── PublicMarketPage
│   ├── SwapPanel (DEX integration — Uniswap, etc.)
│   │   ├── TokenSelector (P or N)
│   │   ├── AmountInput (6 decimals)
│   │   ├── OutputEstimate (price, impact)
│   │   └── ApproveAndSwapButton
│   ├── FairValueGuidance (P ≈ $S, N ≈ $(price-S))
│   └── LiquidityPoolsTable (TVL, APR, add LP links)
│
├── PublicSettlePage
│   ├── UnsettledSeries (matured but !isSettled)
│   │   ├── OraclePriceInput
│   │   ├── PermissionlessWarning
│   │   └── SettleButton
│   ├── SettledSeries
│   │   ├── PayoutRates (P rate, N rate, USD equivalents)
│   │   ├── PlaintextHoldings (balanceOf)
│   │   ├── EstimatedPayout (calculated from balances + rates)
│   │   └── RedeemAllButton
│   └── EmptyState
│
├── ─── CONFIDENTIAL MODE ────────────────────────────
│
├── ShieldPage
│   ├── WrapAndShieldForm
│   │   ├── AmountInput (decimals: 6)
│   │   ├── TxStepper (wrap → approve → shield)
│   │   └── ConfirmationBanner
│   └── SplitForm
│       ├── AmountInput (decimals: 6)
│       ├── StrikeSelector (dropdown — recommended S < price/2)
│       ├── MaturitySelector (dropdown — unix timestamps as uint64)
│       ├── SeriesStatus (exists? factory.getTokens)
│       ├── CreateSeriesButton (if not exists)
│       ├── PayoutEstimate (P tracks ~$S, N ≈ $(price-S), buffer %)
│       ├── TxStepper (createSeries? → approve cWETH → split)
│       └── ConfirmationBanner
│
├── ConfidentialPortfolioPage
│   ├── BalanceList
│   │   └── BalanceRow (per token)
│   │       ├── TokenLabel (P/N indicator from isStable())
│   │       ├── SeriesAnnotation ("P tracks ~$S" or "N = call above $S")
│   │       ├── EncryptedBalance (6 decimals)
│   │       └── RevealButton
│   ├── SettledPositions (filtered by factory.isSettled)
│   │   ├── PayoutInfo (oracle price, rate, USD values)
│   │   └── RedeemButton (full balance only)
│   └── ActionBar (Shield / Split / Merge / Sell P or N)
│
├── ConfidentialMarketPage
│   ├── Tabs: [Sell] [Buy] [My Listings]
│   ├── SellTab
│   │   ├── TokenSelector (P or N from user's holdings)
│   │   ├── AmountInput (6 decimals)
│   │   ├── QuoteTokenSelector
│   │   ├── MinReceiveInput (6 decimals)
│   │   ├── FairValueGuidance (P ≈ $S, N ≈ $(price-S))
│   │   ├── VisibilitySummary
│   │   ├── TxStepper (approve → createListing)
│   │   └── CreateListingButton
│   ├── BuyTab
│   │   ├── ListingFilters (P/N, strike, maturity, quote)
│   │   ├── ListingTable (from events + getListing for active check)
│   │   │   └── P/N resolved via token.isStable()
│   │   └── FillPanel
│   │       ├── TokenDescription (what P or N means at this strike)
│   │       ├── DesiredAmountInput (6 decimals)
│   │       ├── PaymentInput (6 decimals)
│   │       ├── FairValueHint
│   │       ├── AllOrNothingNotice
│   │       ├── TxStepper (approve quoteToken → fill)
│   │       └── SubmitBidButton
│   └── MyListingsTab
│       ├── ListingRow (status from events)
│       └── CancelButton (active only)
│
├── ConfidentialSettlePage
│   ├── UnsettledSeries (matured but !isSettled)
│   │   ├── OraclePriceInput
│   │   ├── PermissionlessWarning
│   │   └── SettleButton
│   ├── SettledSeries
│   │   ├── PayoutRates (P rate, N rate, USD equivalents)
│   │   ├── EncryptedHoldings
│   │   ├── SoldSideNote ("If you sold N, nBal = 0, only P payout")
│   │   └── RedeemAllButton
│   └── EmptyState
│
├── UnshieldCWETHPage
│   ├── AmountInput (6 decimals)
│   ├── AutoUnwrapCheckbox
│   ├── PrivacyWarning
│   └── UnshieldButton
│
├── ─── BRIDGE (both modes) ──────────────────────────
│
├── BridgePage (Unshield P/N)
│   ├── ConfidentialTokenSelector (P or N tokens held in confidential mode)
│   ├── EncryptedBalance + RevealButton
│   ├── AmountInput (plaintext — intentional)
│   ├── OneWayWarning ("cannot re-shield P/N")
│   ├── PrivacyWarning ("amount becomes public")
│   ├── UnshieldRationale (DeFi composability)
│   ├── TxStepper (approve → unshield)
│   └── UnshieldButton
│
└── Shared
    ├── ModeToggle (Public / Confidential)
    ├── EncryptedValue (●●●●●● with [Reveal], 6 decimals, 30s auto-hide)
    │   └── (Confidential Mode only)
    ├── PlaintextBalance (standard balance display, 6 decimals)
    │   └── (Public Mode only)
    ├── RevealTimer
    ├── TxStepper
    ├── FairValueTooltip
    ├── PrivacyBadge ("encrypted" / "public")
    ├── ModeBadge ("Public" / "Confidential")
    ├── AllOrNothingBadge
    └── TokenTypeBadge ("P — stable" / "N — leveraged")
```

---

## Shared Component: EncryptedValue (Confidential Mode Only)

```
Props:
  - contractAddress: address of the token contract
  - handle: the FHE ciphertext handle from balanceOf()
  - label: display name (e.g. "cWETH", "stableETH-1000-1756684800")
  - decimals: number (always 6)
  - autoHideMs: time before re-hiding (default 30000)

States:
  - hidden:    ●●●●●● [Reveal]
  - loading:   ●●●●●● [Revealing...]  (EIP-712 sign + gateway)
  - revealed:  1.450000 cWETH [Hide]  (countdown: 28s)
  - error:     ●●●●●● [Retry]

Flow:
  1. Click [Reveal]
  2. EIP-712 signature via wallet
  3. SDK: userDecrypt(handle, signature)
  4. Gateway re-encrypts, returns uint64 plaintext
  5. Format: value / 10^6, display with 6 decimal places
  6. Auto-hide after timeout or page blur
```

---

## Event-Driven Data Loading

### Events from PublicOptionFactory

```solidity
event SeriesCreated(uint256 indexed strike, uint64 indexed maturity,
                    address stableToken, address upToken);
event Split(address indexed user, bytes32 indexed seriesId, uint256 amount);
event Merge(address indexed user, bytes32 indexed seriesId, uint256 amount);
event Settled(bytes32 indexed seriesId, uint256 oraclePrice);
event Redeemed(address indexed user, bytes32 indexed seriesId, uint256 amount);
```

### Events from OptionFactory (Confidential)

```solidity
event SeriesCreated(uint256 indexed strike, uint64 indexed maturity,
                    address stableToken, address upToken);
event Split(address indexed user, bytes32 indexed seriesId);
event Merge(address indexed user, bytes32 indexed seriesId);
event Settled(bytes32 indexed seriesId, uint256 oraclePrice);
event Redeemed(address indexed user, bytes32 indexed seriesId);
```

### Events from ConfidentialMatchingEngine

```solidity
event ListingCreated(uint256 indexed listingId, address indexed seller,
                     address token, address quoteToken,
                     uint256 strike, uint64 maturity);
event FillAttempted(uint256 indexed listingId, address indexed buyer);
event ListingCancelled(uint256 indexed listingId);
```

### Events from UnshieldBridge

```solidity
event Unshielded(address indexed user, address indexed confidentialToken,
                 address indexed publicToken, uint256 amount);
```

### View function calls

**Public Mode:**
- `publicFactory.getTokens(strike, maturity)` → token addresses
- `publicFactory.isSettled(strike, maturity)` → settlement status
- `publicToken.balanceOf(userAddr)` → uint256 (plaintext)
- `publicToken.name()`, `.symbol()`, `.isStable()`, `.strike()`, `.maturity()`

**Confidential Mode:**
- `factory.getTokens(strike, maturity)` → token addresses
- `factory.isSettled(strike, maturity)` → settlement status
- `engine.getListing(id)` → (seller, token, quoteToken, strike, maturity, active)
- `engine.nextListingId()` → total listings
- `token.name()`, `token.symbol()`, `token.isStable()`, `token.strike()`, `token.maturity()`
- `token.balanceOf(userAddr)` → euint64 handle for re-encryption

---

## Transaction Summary

### Public Mode

| Flow | Steps | Notes |
|---|---|---|
| Deposit & Split (new series) | wrap ETH? → createSeries → approve WETH → split | 2-4 txs |
| Deposit & Split (existing) | wrap ETH? → approve WETH → split | 1-3 txs |
| Merge | merge | 1 tx (uint256 amount) |
| Swap on DEX | approve token → swap | 2 txs, standard DEX flow |
| Settle | settle | 1 tx, plaintext oracle price |
| Redeem | redeem | 1 tx, plaintext math |

### Confidential Mode

| Flow | Steps | Notes |
|---|---|---|
| Shield | wrap → approve WETH → shield | 3 txs |
| Split (new series) | createSeries → approve cWETH → split | 3 txs, first deploys 2 contracts |
| Split (existing) | approve cWETH → split | 2 txs |
| Merge | merge | 1 tx (euint64 handle) |
| Create Listing | approve token → createListing | 2 txs, 2 encrypted inputs |
| Fill | approve quoteToken → fill | 2 txs, 2 encrypted inputs + FHE matching |
| Cancel Listing | cancelListing | 1 tx |
| Settle | settle | 1 tx, plaintext oracle price |
| Redeem | redeem | 1 tx, FHE mul/div |
| Unshield cWETH | unshield | 1 tx (+ optional unwrap) |

### Bridge

| Flow | Steps | Notes |
|---|---|---|
| Unshield P/N | approve confidential token → unshield | 2 txs, one-way only |

---

## Known Integration Issues

### 1. OptionToken.pullFrom() — onlyFactory modifier

The matching engine calls `token.pullFrom()` but pullFrom is `onlyFactory`. The engine is not the factory — this will revert. Frontend preparation: approve → createListing flow is correct for a `transferFrom`-based fix. (Confidential Mode only.)

### 2. Settle is permissionless

Anyone can call `settle()` with any oracle price. Show warning banner. (Both modes.)

### 3. No partial fills (Confidential Mode)

Listing deactivates after any fill attempt. Sellers wanting to sell in chunks must create multiple listings.

### 4. No partial redemption (Both modes)

`redeem()` burns full balance. Users wanting partial redemption must transfer some tokens to another address first.

---

## Key UX Principles

### General (Both Modes)

1. **Label P and N clearly everywhere.** P = "stable, tracks $S in USD." N = "leveraged call, captures upside above $S, goes to zero if ETH <= S." Users must understand what they're holding and selling.

2. **Show fair value guidance.** P ~ $S when deep ITM. N ~ $(price - S). Display these as estimates with the current oracle price.

3. **Strike recommendation.** When creating a split, suggest S < current_price / 2 and show the buffer percentage ("ETH must fall X% before P starts drifting").

4. **Explain the sold-side outcome.** On the redeem page, note that if the user sold one side, that balance is 0 and they only receive payout from the side they kept.

5. **6 decimals everywhere.** Matches contract decimals() and SCALE = 1e6.

6. **Quadratic drift awareness.** If a user holds P and ETH price is near or below their strike, show a warning: "P is approaching drift zone — consider rebalancing to a lower strike."

### Public Mode

7. **Public mode is the default.** Most users should start here. No FHE complexity, standard Web3 UX.

8. **P is the stablecoin.** Promote P token usage across DeFi — liquidity provision, collateral, payments. This is the killer feature.

9. **Standard balances, no reveal buttons.** All balances are plaintext `uint256`. Display them normally. Never show `------` or `[Reveal]` in public mode.

10. **DeFi composability.** Show links to Uniswap pools, Aave markets, and other protocols where P/N tokens can be used.

### Confidential Mode

11. **Never show encrypted data as "0" or blank** — always `------` with [Reveal].

12. **Post-fill ambiguity is a feature.** Match/refund look identical on-chain. Direct users to reveal balances.

13. **All-or-nothing is prominent.** Every fill panel and listing card states this.

14. **Privacy warning on unshield.** Unshielding makes amounts public on-chain.

### Bridge

15. **One-way is clear.** The unshield bridge is confidential → public only. Users cannot re-shield P/N tokens. Make this very prominent in the UI.

16. **Unshield rationale.** Explain WHY a user would unshield: DeFi composability, better liquidity, use P as stablecoin. The bridge exists to unlock public mode benefits for users who started in confidential mode.
