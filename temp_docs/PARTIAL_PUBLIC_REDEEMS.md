# Partial Public Redeems

## Problem

Public `redeem`, `redeemToEth`, and `redeemToWeth` currently redeem the
caller's entire settled P and N balances for a series.

That is correct from a custody perspective: redemption only burns tokens held by
`msg.sender`. If Alice sold her P to Bob, Alice's redeem cannot burn Bob's P.
Alice can redeem only her remaining N, and Bob can redeem his P separately.

The UX problem is that Alice cannot choose to redeem only part of her remaining
wallet balance. The Settle page should allow users to enter the P amount and N
amount they want to redeem.

## Unit Model

Public collateral is ETH/WETH with 18 decimals. Public P/N tokens have 6
decimals.

```text
1 displayed P or N = 0.000001 ETH/WETH notional
1 raw P or N unit  = 0.000000000001 ETH/WETH notional
collateralWei      = optionRawAmount * 1_000_000
optionRawAmount    = collateralWei / 1_000_000
```

Examples:

```text
0.00011 ETH deposit -> 110.000000 P and 110.000000 N
1 ETH deposit       -> 1,000,000.000000 P and 1,000,000.000000 N
```

Settlement payouts are rates scaled by `1_000_000`.

```text
479954 raw rate = 0.479954 = 47.9954%
```

## Smart Contract Change

Add amount-based public redemption entrypoints. Prefer distinct function names
instead of overloaded `redeem(...)` functions because the frontend currently uses
handwritten selectors.

Recommended API:

```solidity
function redeemAmounts(
    uint256 strikePrice,
    uint64 maturityTimestamp,
    uint256 stableAmount,
    uint256 upAmount
) external;

function redeemAmountsToEth(
    uint256 strikePrice,
    uint64 maturityTimestamp,
    uint256 stableAmount,
    uint256 upAmount
) external;

function redeemAmountsToWeth(
    uint256 strikePrice,
    uint64 maturityTimestamp,
    uint256 stableAmount,
    uint256 upAmount
) external;
```

Keep existing full-balance functions for backward compatibility:

```solidity
redeem(uint256 strikePrice, uint64 maturityTimestamp)
redeemToEth(uint256 strikePrice, uint64 maturityTimestamp)
redeemToWeth(uint256 strikePrice, uint64 maturityTimestamp)
```

The existing functions should call the new internal implementation with the
caller's full P and N balances.

Internal flow:

```text
1. Load series by strikePrice + maturityTimestamp.
2. Require series is settled.
3. Require stableAmount > 0 or upAmount > 0.
4. Burn stableAmount from msg.sender's P token.
5. Burn upAmount from msg.sender's N token.
6. Compute claimOptionRaw:
   (stableAmount * stablePayout + upAmount * upPayout) / 1_000_000
7. Convert to collateral:
   claimCollateralWei = claimOptionRaw * 1_000_000
8. Withdraw claimCollateralWei as native ETH or WETH.
9. Emit redemption event.
```

The function must not use `transferFrom` to pull tokens from other holders. It
must burn only `msg.sender` balances.

## Event Semantics

Current event:

```solidity
event Redeemed(
    address indexed user,
    bytes32 indexed seriesId,
    uint256 claim,
    address indexed payoutAsset
);
```

For partial redeems, this event can still work if `claim` remains the collateral
amount paid out in wei.

Recommended addition for indexer clarity:

```solidity
event Redeemed(
    address indexed user,
    bytes32 indexed seriesId,
    uint256 stableAmount,
    uint256 upAmount,
    uint256 claim,
    address indexed payoutAsset
);
```

If the event shape changes, backend ABI and event processing must be updated. If
the event shape does not change, backend can track collateral redeemed, but it
cannot reconstruct exactly how much P and N were burned from the redeem event
alone without also indexing token burn `Transfer` events.

## Contract Tests

Required SC tests:

```text
1. Partial P redeem burns only requested P and leaves remaining P untouched.
2. Partial N redeem burns only requested N and leaves remaining N untouched.
3. Mixed P+N partial redeem burns both requested amounts.
4. Redeeming zero P and zero N reverts.
5. Redeeming more P/N than the caller holds reverts through token burn checks.
6. redeemAmounts pays native ETH correctly.
7. redeemAmountsToEth pays native ETH correctly.
8. redeemAmountsToWeth pays WETH correctly.
9. Existing full-balance redeem functions still work.
10. Sold-token scenario:
    - Alice has P+N.
    - Alice transfers P to Bob.
    - Alice redeems N only.
    - Bob redeems P only.
    - Neither user can burn the other's tokens.
```

## Frontend Change

After SC confirms selectors, update the Settle page.

The Settle page should not require the user to manually enter a series. It
should list protocol series where the connected wallet owns P and/or N, then let
the user choose the series and enter partial redeem amounts.

### Owned Series Discovery

Preferred source:

```text
1. Ask the backend/indexer for series positions owned by the connected wallet.
2. Filter to the selected chain, mode, and factory.
3. Include only rows where the wallet has P balance, N balance, or both.
4. Show settled rows as redeemable and matured/unsettled rows as settlement
   pending.
```

If the backend does not yet expose an owner-position endpoint, add one rather
than relying only on user-entered strike and maturity.

Recommended endpoint:

```text
GET /series/owned?chainId=11155111&mode=public&owner=0x...
```

Response should include:

```text
chainId
mode
factoryAddress
seriesId
strikePrice
maturityTimestamp
stableToken
upToken
stableBalanceRaw
upBalanceRaw
settled
stablePayout
upPayout
marketStatus
```

For public tokens, backend can compute `stableBalanceRaw` and `upBalanceRaw` by
calling `balanceOf(owner)` on the indexed P/N token addresses. For confidential
tokens, the backend should not decrypt balances; the frontend can list indexed
series and use user-decrypt for balances.

Frontend fallback/discovery may also inspect wallet token metadata where
available. Protocol token names/symbols encode the series:

```text
stableETH-PRICE-TIMESTAMP
upETH-PRICE-TIMESTAMP
stETH-PRICE-TIMESTAMP
```

If the UI labels tokens as `eth-PRICE-TIMESTAMP`, parse the same
`PRICE-TIMESTAMP` suffix. Parsing the name is only a hint. The UI must validate
the parsed token against the backend/indexer response before treating it as a
Freedom protocol position.

Validation rules:

```text
1. Parse side, strikePrice, and maturityTimestamp from token metadata when
   available.
2. Query backend series by chainId + factory + strikePrice + maturityTimestamp,
   or by token address.
3. Accept the token only if the backend row exists and the token address matches
   the row's stableToken or upToken.
4. Reject/look past similarly named tokens that are not in the backend series
   table.
5. If backend is unavailable, show an inline "positions unavailable" state and
   keep manual entry as a fallback, but do not auto-trust token names.
```

This prevents random ERC-20s named like `stableETH-850-1783413600` or
`eth-850-1783413600` from being shown as protocol positions.

Public mode should show editable inputs:

```text
P amount to redeem
N amount to redeem
```

Behavior:

```text
1. Show a list/table of owned protocol series for the connected wallet.
2. Selecting a row sets strikePrice and maturityTimestamp internally.
3. Do not make the user manually enter strike/maturity for the normal path.
4. Default redeem amounts may be full wallet balances for the selected row.
5. User can redeem only P, only N, or both.
6. Validate at least one amount is greater than zero.
7. Validate P amount <= wallet P balance for the selected row.
8. Validate N amount <= wallet N balance for the selected row.
9. Parse inputs with 6 P/N decimals.
10. Estimated claim must use entered amounts, not full balances.
11. Claim asset selector remains ETH / WETH.
12. ETH path calls redeemAmountsToEth or redeemAmounts.
13. WETH path calls redeemAmountsToWeth.
14. Refresh owned-series balances after confirmation.
```

Display payout rates as percentages and estimated claim as ETH/WETH.

Formula:

```text
pClaimRaw = pAmountRaw * pPayoutRaw / 1_000_000
nClaimRaw = nAmountRaw * nPayoutRaw / 1_000_000
claimOptionRaw = pClaimRaw + nClaimRaw
claimCollateralWei = claimOptionRaw * 1_000_000
```

Example:

```text
Wallet enters: 110.000000 P
P payout rate: 47.9954%

pAmountRaw = 110_000000
pPayoutRaw = 479954
pClaimRaw = 52_794940
claimCollateralWei = 52_794940 * 1_000_000
display = 0.000052794940 ETH
```

## Backend Change

Backend/indexer impact depends on the final event shape.

The backend should also expose owned series/positions for the Settle page so the
frontend does not have to make users manually enter strike and maturity.

Recommended public endpoint:

```text
GET /series/owned?chainId=&mode=&owner=&factory=
```

For public mode:

```text
1. Start from indexed series rows.
2. Filter by chainId, mode, and optional factory.
3. For each row, call balanceOf(owner) on stableToken and upToken.
4. Return rows where either balance is greater than zero, unless an
   includeZero=true query param is explicitly requested.
5. Include raw balances as strings.
6. Sort by marketStatus, maturityTimestamp, and strikePrice.
```

The endpoint is also the authority used to validate token-name parsing on the
frontend. A token parsed as `stableETH-PRICE-TIMESTAMP`,
`upETH-PRICE-TIMESTAMP`, `stETH-PRICE-TIMESTAMP`, or UI-formatted
`eth-PRICE-TIMESTAMP` must still match an indexed series row and token address
before the UI treats it as redeemable.

If `Redeemed` event shape changes:

```text
1. Update backend ABI.
2. Update event processor.
3. Store/index stableAmount and upAmount if schema supports it, or document if
   only aggregate redeemed collateral is stored.
4. Update docs to state claim is collateral wei.
5. Run backend build and tests.
```

If event shape does not change:

```text
1. No keeper transaction logic change should be needed.
2. ABI remains unchanged.
3. Docs should clarify that Redeemed.claim is collateral wei and partial P/N
   burn amounts are not directly available from the factory Redeemed event.
4. If exact per-leg redemption activity is needed, index P/N token Transfer burn
   events as a separate feature.
```

Settlement keeper should continue calling `settlePublic` / `settleConfidential`.
Bridge keeper should continue treating public/confidential P/N amounts as
6-decimal option-token units.
