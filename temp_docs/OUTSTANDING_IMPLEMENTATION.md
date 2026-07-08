# Outstanding Implementation Work

Last updated: 2026-07-08.

This document tracks work that is not yet clearly complete. It is meant as a
handoff list for SC, FE, and BE worker agents.

## Highest Priority

### 1. Confidential Trade Page

Owner: FE

Status: in progress / needs final verification.

The Trade page must stop being a placeholder and become the main hackathon demo
surface for confidential trading.

Required:

- Hide Shield from the navbar only.
- Keep `/shield` directly accessible and do not change Shield behavior.
- Keep Deposit and Settle flows off-limits.
- Use backend market endpoints only for read-only listing discovery.
- Do not POST encrypted amounts, proofs, signatures, or plaintext trade intent
  to the backend.
- Implement confidential listing discovery, create listing, fill listing, and
  cancel own listing.
- Public Trade can remain secondary/minimal for now.

Reference:

- `temp_docs/FRONTEND_CLIENT_ONLY.md`
- `temp_docs/MARKET_INDEXER.md`
- `backend/src/http/server.ts`
- `backend/src/types.ts`
- `contracts/src/confidential/ConfidentialMatchingEngine.sol`

Core contract calls:

```text
createListing(address token, address quoteToken, uint256 strikePrice, uint64 maturityTimestamp, bytes32 encAmount, bytes32 encMinReceive, bytes amountProof, bytes minProof)
fill(uint256 listingId, bytes32 encPayment, bytes32 encExpected, bytes paymentProof, bytes expectedProof)
cancelListing(uint256 listingId)
```

Validation:

```text
node --check <edited frontend files>
npm --prefix frontend run build
/trade loads
/shield is hidden from nav but still directly loads
```

### 2. Shielded Collateral Backing

Owner: SC

Status: not implemented.

Current conceptual problem:

```text
public deposit locks ETH/WETH in public vault
shield burns public P/N and mints confidential P/N
confidential redeem expects cWETH in confidential vault
```

No reserve is moved or converted from WETH/ETH to cWETH during shielding. A
shielded confidential token can therefore become unbacked for confidential
redeem/merge.

Required design decision:

- Either support confidential redeem/merge for shielded public-origin tokens by
  converting backing into cWETH safely, or
- enforce that shielded public-origin confidential tokens must unshield before
  redeeming.

Important constraints:

- Public P/N and confidential P/N must preserve the same economic notional.
- Single-leg shielding must not double-move collateral.
- Redemption-time WETH -> cWETH wrapping may require public decryption of the
  payout amount, which leaks the redeemed amount.
- Existing confidential tokens are fungible, so tracking "came from bridge" vs
  "came from confidential split" is not free.

Acceptance tests:

- Public deposit -> shield P only -> settle -> confidential redeem cannot
  overpay or use unbacked cWETH.
- Public deposit -> shield N only -> same.
- Shield both P and N -> merge/redeem cannot double-spend reserve.
- Remaining public leg can still redeem against remaining public reserve.
- Unshield continues to work.

### 3. Public/Confidential Bridge Unit Conversion

Owner: SC

Status: needs confirmation after public 1:1 accounting change.

The target public model is now:

```text
1.000000 ETH/WETH deposit -> 1.000000 P and 1.000000 N
optionRaw = collateralWei / 1e12
collateralWei = optionRaw * 1e12
```

Public P/N and confidential P/N both display as 6-decimal units, but the bridge
must preserve notional exactly. Confirm `ShieldBridge.shield` and
`finalizeUnshield` no longer use any old `1e6` public accounting assumption.

Required:

- Verify public -> confidential conversion.
- Verify confidential -> public conversion.
- Revert tiny amounts that would round to zero or lose precision.
- Test P and N paths.

Acceptance examples:

```text
1.000000 public P shields to 1.000000 confidential P, assuming both sides now use the 1:1 6-decimal display model.
0.001000 public P shields to 0.001000 confidential P.
Unshield returns the original public raw amount where precision allows.
```

## Product Flow Work

### 4. Partial Public Redeems

Owner: SC + FE + BE

Status: documented, not clearly implemented.

Current public redeem burns the user's entire P and N balances for a selected
series. The intended UX is to let the user redeem separate P and N amounts.

Reference:

- `temp_docs/PARTIAL_PUBLIC_REDEEMS.md`

Required SC:

- Add partial public redeem functions for independent P and N amounts.
- Burn only the user-entered amounts.
- Compute claim from the burned amounts.
- Keep full redeem compatibility if useful.

Required FE:

- Settle page should allow entering amount of P and amount of N to redeem.
- Validate against owned balances.
- Show estimated ETH/WETH claim under percentage payout rates.

Required BE:

- Index partial `Redeemed` events correctly.
- If event shape is unchanged, document that aggregate redeemed collateral is
  tracked but individual P/N burned amounts may not be reconstructable.

### 5. Owned-Series Discovery on Settle

Owner: BE + FE

Status: documented, not clearly implemented.

Settle should list the connected wallet's protocol-owned P/N series instead of
forcing manual strike/maturity entry.

Reference:

- `temp_docs/PARTIAL_PUBLIC_REDEEMS.md`

Required:

- Backend endpoint such as:

```text
GET /series/owned?chainId=&mode=&owner=&factory=
```

- FE should fetch owned P/N balances for the connected address.
- Token names like `eth-PRICE-TIMESTAMP` are only hints.
- FE must validate discovered tokens against backend/indexed protocol series so
  random tokens are not treated as protocol positions.

## Frontend Fixes

### 6. Public Deposit Minted Amount Display

Owner: FE

Status: bug reported; fix not yet confirmed.

Bug:

```text
0.001 ETH deposit preview showed 1000.000000 P/N
```

Correct display:

```text
0.001 ETH -> optionRaw 1000 -> 0.001000 P/N
1 ETH     -> optionRaw 1000000 -> 1.000000 P/N
```

Likely files:

- `frontend/src/views.js`
- `frontend/src/protocol-actions.js`

Required:

- Format public option raw units with 6 decimals.
- Do not append `.000000` to raw option units.
- Keep calldata unchanged: public deposit still sends 18-decimal collateral wei.

### 7. cWETH Acquisition / Wrap Unit Help

Owner: FE

Status: not clearly implemented.

Observed:

- cWETH wrapper: `0x46208622DA27d91db4f0393733C8BA082ed83158`
- Underlying: `0xff54739b16576FA5402F211D0b938469Ab9A5f3F`
- Underlying decimals: 18
- cWETH decimals: 6
- `wrap(address,uint256)` expects the 18-decimal underlying amount.

Implication:

```text
10.000000 cWETH -> wrap amount 10000000000000000000
0.001000 cWETH -> wrap amount 1000000000000000
```

Required:

- Any FE helper text or helper transaction for cWETH wrapping must parse the
  display amount as 18-decimal underlying units when calling `wrap`.
- Reveal logic should remain unchanged.

## Backend / Indexer Checks

### 8. Deployment Config and Start Blocks After Redeploys

Owner: BE + FE

Status: needs ongoing verification after each SC redeploy.

Current FE config appears to have newer Sepolia addresses:

```text
Public factory:        0xfCEdAb313542d11cd859fd586218C38d7669F6a5
Confidential factory:  0x1774cAc50c97aFbed216E3CF372DC5F612ba3D49
ShieldBridge:          0x9d5372311820Ea27Ec9f607878282CD22D05fe3F
SeriesPool impl:       0x5E525Be04B3B4A2471514B13202Efe98a702D4b0
Matching engine:       0xc951997fCb8F64ae27dad74f27295A8b3001d433
Oracle adapter:        0xA5405757cF0Ae0a116de2e5298c4A2Da3ab2CC7e
cWETH:                 0x46208622DA27d91db4f0393733C8BA082ed83158
```

Required after each redeploy:

- FE `config.js` / `generated-env.js` match the active deployment.
- BE `env.ts` / `.env.example` match active deployment.
- Start blocks are correct.
- Indexer cursors are not stuck before new deployment blocks.
- `/deployments`, `/series`, and `/markets/listings` reflect the active tuple.

### 9. Active Series / Market Indexing Regression Checks

Owner: BE

Status: active-series UI was reported implemented, but indexer correctness must
be rechecked after redeploys.

Required:

- Created series should appear in active-series API/UI after indexer catches up.
- Confidential matching engine listings should appear in `/markets/listings`.
- Filled/cancelled listing lifecycle should update.
- Settled/matured series should not be incorrectly hidden from market views.

## Deferred / Lower Priority

### 10. Backend Start Script

Owner: BE

Status: deferred.

Previously observed:

```text
npm run start expected dist/main.js
build emitted dist/src/main.js
```

We agreed to ignore this for now and use dev/one-shot scripts during testing.

### 11. Shield Page UX

Owner: FE

Status: working enough for direct access; hidden from navbar for demo.

Do not delete the Shield page. It remains an additional feature and should be
directly accessible. User-facing nav should emphasize Deposit / Trade / Settle
until the backing/conversion work is complete.

## Already Reported Fixed

These should not be reworked unless regression testing disproves them:

- Public factory accepts ETH and WETH through one factory config.
- Public P/N 1:1 accounting source change is present in checked-in contracts.
- Backend real Zama public decrypt path for unshield was implemented.
- Old failed unshield request was finalized.
- Confidential redeem ACL failure was fixed in contract source with token-side
  `burnBalance(address)`.
- Confidential reveal returning `0.000000` after an unshield can be correct.
- Active series list on Deposit was reported implemented.
- Public payout rate display as percentage plus ETH/WETH estimate was reported
  implemented.
- Temporary reveal diagnostics cleanup was reported requested/handled.
