# Frontend Client-Only Additions

The frontend should be a website/app that forms core protocol transactions in
the browser and submits them through the user's wallet. It should not depend on
a backend server for deposits, series creation, settlement, or claims.

Use the market watcher only for large market/order datasets.

## Primary Pages

The app keeps these primary pages:

```text
/deposit
/trade
/shield
/settle
```

Every page has:

```text
Public | Confidential
```

mode switch.

## Series Input UX

The user enters strike and maturity manually.

### Strike

Input type:

```text
text or numeric text field
```

Validation:

```text
strike must be a positive multiple of 50
```

Default:

```text
largest multiple of 50 less than or equal to 50% of current ETH market price
```

Frontend helper:

```ts
const STRIKE_TICK = 50;

export function defaultStrike(currentEthPrice: number): number {
  return Math.floor((currentEthPrice * 0.5) / STRIKE_TICK) * STRIKE_TICK;
}

export function isValidStrike(strike: number): boolean {
  return Number.isInteger(strike) && strike > 0 && strike % STRIKE_TICK === 0;
}
```

UX copy:

```text
Lower strike = more stability buffer, lower P target.
Higher strike = higher P target, less downside buffer.
```

Warnings:

```text
Strike must be a multiple of $50.
Strike is above current ETH price. P is already in drift zone.
Higher strike gives less downside buffer.
```

Do not force recommended strikes. Let users choose farther strikes based on how
much stability they want.

### Maturity

Input type:

```text
10-minute slot selector
```

User-facing rule:

```text
10-minute timestamp slot
```

Canonical frontend value:

```ts
type MaturityTimestamp = number; // unix seconds
```

Examples:

```text
next 10-minute boundary after now
one slot after that when too close to expiry
```

Display:

```text
Jul 05 14:20 UTC
Jul 05 14:30 UTC
```

The frontend should derive:

```text
maturityTimestamp = unix seconds aligned to 10 minutes
```

Contracts reject non-future timestamps for creation and timestamps not aligned
to 10 minutes.

## Series Existence Flow

Use factory registry as canonical state.

Frontend flow:

```text
1. User enters strike and maturity.
2. Validate strike and maturity locally.
3. Compute/read seriesId.
4. Call factory.getSeries(strike, maturityTimestamp) or factory.getTokens(...).
5. If exists:
   use returned P/N addresses.
6. If not exists:
   call factory.predictTokenAddresses(strike, maturityTimestamp).
   show predicted addresses and "Series will be created in this transaction."
7. On deposit, submit createSeriesAndSplit if missing.
```

Do not rely only on `eth_getCode(predictedAddress)` as the existence check.

## Deposit Page

### Public ETH

If selected collateral is native ETH and the series does not exist:

```text
createSeriesAndSplit(strike, maturityTimestamp, amount)
```

This should be one wallet transaction.

If series exists:

```text
split(strike, maturityTimestamp, amount, { value: amount })
```

Depending on final contract design, the frontend may use `createSeriesAndSplit`
for both cases if the function is idempotent.

### Public WETH/ERC20

From zero allowance:

```text
approve collateral to factory.vault() -> createSeriesAndSplit
```

With sufficient allowance:

```text
createSeriesAndSplit
```

Do not assume WETH supports permit.

### Confidential cWETH

Confidential deposit is client-side but more involved:

```text
1. User enters amount.
2. Browser initializes FHE SDK.
3. User authorizes factory.vault() on cWETH.
4. Browser encrypts the deposit amount for factoryAddress + userAddress.
5. Wallet submits createSeriesAndSplit(..., encAmt, proof) or split(..., encAmt, proof).
```

Do not send encrypted intended amount/proof to an off-chain server before chain
submission.

If the user lacks cWETH, show an inline cWETH acquisition drawer on Deposit. Do
not make it a primary page.

Authorization modes:

```text
allowance:
  encrypt allowance for cWETHAddress + userAddress
  call cWETH.approve(factory.vault(), encAllowance, allowanceProof)

operator:
  call an ERC7984-style operator authorization such as setOperator(factory.vault(), until)
  no encrypted allowance proof is needed

none:
  dev/testing mode only
```

The frontend must keep this configurable as:

```text
confidential.cwethAuthMode = "allowance" | "operator" | "none"
```

Deposit encryption target:

```text
createEncryptedInput(factoryAddress, userAddress).add64(amount).encrypt()
```

Do not encrypt the deposit amount for the vault or cWETH. The factory consumes
the external input once, then contracts pass internal encrypted handles.

## Trade Page

Use the watcher/indexer for large market data:

```text
GET listings
GET active orders
GET user listings
GET recent fills
```

But transaction formation remains client-side.

Market state behavior:

```text
Filters: All | Live | Settled
Default: All
```

Do not expose a separate Matured filter. `Live` means not settled yet, and can
temporarily include matured-but-unsettled series while keeper settlement is
pending. `Settled` means payout ratios are fixed.

Do not hide or deactivate listings only because maturity has passed. Users
should still be able to sell matured or settled P/N tokens if they hold balance
and the token contract/listing lifecycle permits transfer. Disable selling only
for no balance, token interaction failure, invalid listing terms, or actual
listing states such as cancelled, filled, or explicitly expired.

For settled series, show fixed P/N payout info in the market so buyers know what
they are buying. For matured unsettled series, show a small settlement-pending
status and route users to Settle when appropriate.

### Public Trade

The frontend can:

- read market/order data from the watcher,
- validate balances and allowances directly,
- encode approve/order/swap transactions from ABI,
- submit through wallet.

### Confidential Trade

The watcher shows only public listing metadata.

Fill/create listing flow:

```text
1. User chooses listing or creates listing.
2. User enters amount/payment/minimum receive locally.
3. Browser encrypts values locally.
4. Wallet submits transaction directly to chain.
5. Watcher indexes resulting public events later.
```

Avoid off-chain submission of encrypted intent:

```text
Do not POST encrypted amount/minReceive/proof to the watcher.
Do not ask the watcher to relay confidential transactions.
```

Reason:

```text
Encrypted values may hide amounts, but off-chain submission leaks timing,
network metadata, wallet/session behavior, and intent before public chain
inclusion.
```

## Settle Page

Settle does not require the watcher.
Settlement does not require a backend transaction builder. The UI settles
matured series through the Chainlink oracle adapter configured for the selected
chain or discovered from `factory.oracle()`.

Preferred data sources:

```text
1. Direct factory reads for selected/known series.
2. Watcher series list for convenience, if available.
3. Direct event scan fallback when watcher is unavailable.
```

Public claim flow:

```text
1. Read series.
2. Read P/N balances.
3. Read settlement state and payout rates.
4. If matured and unsettled, read adapter.latestEthUsdPrice().
5. Wallet submits adapter.settlePublic(factory, strike, maturityTimestamp).
6. After settlement, estimate claim.
7. Wallet submits redeem(strike, maturityTimestamp).
```

Confidential claim flow:

```text
1. Read encrypted balance handles.
2. Let user reveal local display balance if they want an estimate.
3. If matured and unsettled, read adapter.latestEthUsdPrice().
4. Wallet submits adapter.settleConfidential(factory, strike, maturityTimestamp).
5. Wallet submits redeem(strike, maturityTimestamp).
6. User receives cWETH.
```

Normal users should not enter an oracle price manually and the frontend should
not call factory.settle(strikePrice, maturityTimestamp, oraclePrice) directly.

## Data Layer

Recommended hooks:

```text
useDeploymentConfig()
useMode()
useEthMarketPrice()
useSeriesInput()
useSeries(factory, strike, maturityTimestamp)
usePredictedSeriesAddresses(factory, strike, maturityTimestamp)
useDepositTransaction()
useMarketListings()
useTradeTransaction()
useSettlementPositions()
useFhe()
```

The app should keep enough deployment config locally to work without the
watcher:

```json
{
  "chains": [
    {
      "chainId": 1,
      "factories": [
        {
          "mode": "public",
          "collateral": "ETH",
          "address": "0x..."
        }
      ]
    }
  ]
}
```

Watcher data is an enhancement for market discovery, not a hard dependency for
core actions.

### Sepolia Env

Supported env/runtime config keys:

```text
FREEDOM_SEPOLIA_PUBLIC_ETH_FACTORY=
FREEDOM_SEPOLIA_PUBLIC_WETH_FACTORY=
FREEDOM_SEPOLIA_WETH_TOKEN=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14

FREEDOM_SEPOLIA_CONFIDENTIAL_FACTORY=
FREEDOM_SEPOLIA_CWETH_TOKEN=0x46208622DA27d91db4f0393733C8BA082ed83158
FREEDOM_SEPOLIA_CWETH_AUTH_MODE=operator # allowance | operator | none
FREEDOM_SEPOLIA_CWETH_OPERATOR_UNTIL=      # optional unix timestamp

FREEDOM_ANVIL_SHIELD_BRIDGE=
FREEDOM_SEPOLIA_SHIELD_BRIDGE=
FREEDOM_ANVIL_ORACLE_ADAPTER=
FREEDOM_SEPOLIA_ORACLE_ADAPTER=
FREEDOM_MARKET_API_URL=

FREEDOM_ZAMA_GATEWAY_CHAIN_ID=10901
FREEDOM_ZAMA_RELAYER_URL=https://relayer.testnet.zama.org
```

`npm --prefix frontend run build` currently regenerates
`frontend/src/generated-env.js` from env. There is no frontend lint script at
the time of writing.

Sepolia token defaults:

```text
Public WETH defaults to WETH9 at 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14.
WETH acquisition uses WETH9.deposit() payable; it is not a faucet mint.

Confidential cWETH defaults to Zama Sepolia cWETHMock at
0x46208622DA27d91db4f0393733C8BA082ed83158 from:
https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia

The Zama docs list cWETHMock underlying mint as public on the underlying mock
token, but the cWETH mint/deposit wrapper ABI must be verified before wiring a
frontend mint helper.
```

ShieldBridge:

```text
ShieldBridge replaces UnshieldBridge.
Use shield(strikePrice, maturityTimestamp, isStable, amount) for public -> confidential.
Use unshield(strikePrice, maturityTimestamp, isStable, amount) for confidential -> public requests.
The backend keeper may public-decrypt the burned amount handle and call
finalizeUnshield(...). The frontend reads keeper status from
GET /bridges/requests when FREEDOM_MARKET_API_URL is configured.
If the backend URL is missing, the UI leaves the request as submitted and tells
the user finalization requires keeper/public decrypt.
The frontend must not submit clear amounts, proofs, signatures, encrypted
handles, or plaintext balances to the backend.
The old bridge reserve capacity/fundBridgeReserve flow is removed.
```

Confidential reveal status:

```text
confidentialBalanceOf(address) is preferred for reading encrypted handles.
Reveal uses browser-only Zama user decrypt:
1. read encrypted handle with confidentialBalanceOf(address)
2. request a wallet EIP-712 signature
3. decrypt through the loaded Zama SDK/relayer path
4. keep the formatted plaintext only in in-memory UI state until Hide,
   account change, chain change, or disconnect

Supported SDK shapes:
- modern generateTransportKeyPair + signDecryptionPermit + decrypt
- userDecryptSingleHandle when exposed by the loaded instance
- legacy generateKeypair + createEIP712 + userDecrypt

Never display fake decrypted values.
Never send handles, signatures, decrypted values, or plaintext balances to the
backend/localStorage.
```

## Transaction Stepper

Required for all multi-step flows.

Examples:

Public WETH new series:

```text
Approve WETH
Create series + deposit + mint
```

Public ETH new series:

```text
Create series + deposit + mint
```

Confidential new series:

```text
Authorize cWETH vault
Encrypt deposit amount for factory
Create series + deposit + mint
```

Confidential listing:

```text
Encrypt listing details
Submit private listing
```

## Confidential Client-Side Feasibility

Client-side confidential interactions are reasonable for MVP if:

- FHE SDK is lazy-loaded only in Confidential mode.
- Encryption is done in the browser.
- User-decryption/reveal happens in the browser through wallet signatures.
- The UI clearly handles slow encryption/proof generation.
- The app supports retry on encryption or wallet rejection failures.

Potential rough edges:

- FHE SDK bundle size may be large.
- Encryption/proof generation may feel slower than normal DeFi actions.
- Mobile wallets may have weaker support/performance.
- User-decryption flows add extra signatures.
- Some confidential allowance flows may require more user education.

Despite those rough edges, avoid sending intended encrypted order details to an
off-chain server. If performance becomes a problem, optimize loading and UX
first before introducing a relayer.

## UI Notes

Keep the frontend aligned with `FRONTEND.md`:

- Website/app, not landing page.
- Three primary pages only.
- Minimal dark greyscale UI.
- Bumblebee-yellow accents.
- Monospace typography.
- Micro-animations for mode switch, form focus, tx stepper, balance reveal, and
  market updates.

## Success Criteria

- User can choose any strike that is a multiple of 50.
- Default strike is derived from current ETH price at 50% rounded down to the
  nearest 50.
- User can choose 10-minute PoC maturity slots.
- Frontend reads factory registry to verify series existence.
- Frontend shows predicted addresses for missing deterministic clone series.
- Native ETH can create series and deposit/mint in one transaction.
- WETH/ERC20 uses approve plus create/deposit/mint when allowance is missing.
- Confidential mode encrypts locally and does not send encrypted intent to the
  watcher before chain submission.
- Confidential deposit encrypts the deposit amount for the factory address.
- cWETH authorization supports allowance, operator, or dev-only none modes.
- Core deposit/settle flows work without the watcher.
- Trade market discovery uses the watcher when available.
