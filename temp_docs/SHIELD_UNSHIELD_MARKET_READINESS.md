# Shield/Unshield Market Readiness

## Requirement

Shield and unshield must work before the market can be considered ready.

The market has two liquidity surfaces:

```text
public P/N        -> visible ERC-20 balances and public trading
confidential P/N  -> encrypted balances and confidential trading
```

Without a working bridge, liquidity is fragmented. Users can enter one surface
but cannot reliably move positions to the other. That breaks the core product
promise that public and confidential P/N are the same economic position with
different privacy properties.

## Expected User Flows

Public to confidential:

```text
1. User holds public P or N.
2. User opens Shield.
3. User selects series and side.
4. User enters amount.
5. Frontend calls ShieldBridge.shield(...).
6. Public token is burned.
7. Confidential token is minted to the user.
8. User can reveal their own confidential balance through user-decrypt.
```

Confidential to public:

```text
1. User holds confidential P or N.
2. User opens Shield.
3. User selects series and side.
4. User enters amount.
5. Frontend calls ShieldBridge.unshield(...).
6. Confidential token is burned up to the requested amount.
7. Backend/indexer indexes UnshieldRequested.
8. Backend keeper public-decrypts the burned amount handle.
9. Backend keeper calls ShieldBridge.finalizeUnshield(...).
10. Public token is minted to the user.
11. Backend/indexer indexes UnshieldFinalized.
12. Frontend shows the final status.
```

## Current Critical Dependency

`finalizeUnshield` is a backend keeper responsibility.

The keeper must have a real Zama public-decrypt service. A placeholder service
that returns:

```text
public decrypt unavailable / SDK not configured
```

means unshield is not market-ready, even if `UnshieldRequested` is indexed.

## Readiness Checklist

Smart contracts:

```text
1. Public factory and confidential factory both authorize the active ShieldBridge.
2. ShieldBridge.publicFactory() points to the active public factory.
3. ShieldBridge.confidentialFactory() points to the active confidential factory.
4. shield(...) burns public P/N and mints confidential P/N.
5. unshield(...) burns confidential P/N and emits UnshieldRequested.
6. finalizeUnshield(...) verifies public decrypt proof and mints public P/N.
7. Series identity is strikePrice + maturityTimestamp across both factories.
```

Backend:

```text
1. Indexer tracks the active ShieldBridge from its deployment block.
2. UnshieldRequested is persisted with requestId, bridge, user, side, series,
   requestedAmount, burnedAmountHandle, request block, and tx hash.
3. Keeper retries requested and failed requests.
4. Keeper uses a real public-decrypt service when configured.
5. Keeper passes abiEncodedCleartexts and decryptionProof to finalizeUnshield.
6. Keeper marks finalize_submitted only after tx submission.
7. Keeper marks finalized only after indexing UnshieldFinalized.
8. API exposes request status for the frontend.
```

Frontend:

```text
1. Shield page supports public -> confidential and confidential -> public.
2. User selects owned protocol series rather than manually typing series in the
   normal path.
3. Amounts are validated as 6-decimal P/N units.
4. Public balances are read through ERC-20 balanceOf.
5. Confidential balances are revealed with browser user-decrypt.
6. Zero encrypted handle displays 0 without requesting a signature.
7. Nonzero encrypted handle requests a MetaMask typed-data signature.
8. Unshield status comes from backend /bridges/requests.
9. Failed keeper states show the backend error and a retry-oriented message.
```

## Sepolia Deployment Tuple

Current Sepolia tuple used for testing:

```text
Public factory:        0xfCEdAb313542d11cd859fd586218C38d7669F6a5
Confidential factory:  0x1774cAc50c97aFbed216E3CF372DC5F612ba3D49
ShieldBridge:          0x9d5372311820Ea27Ec9f607878282CD22D05fe3F
Matching engine:       0xc951997fCb8F64ae27dad74f27295A8b3001d433
cWETH:                 0x46208622DA27d91db4f0393733C8BA082ed83158
Zama relayer:          https://relayer.testnet.zama.org
```

## Blocking Issues To Resolve

Public-decrypt backend:

```text
Unshield cannot complete until backend public decrypt is implemented and wired.
The current placeholder service means requests can be indexed but not finalized.
```

Confidential reveal:

```text
Reveal must work for confidential P/N and cWETH before manual testing can rely
on encrypted balances. A zero handle should show 0. A nonzero handle should
prompt MetaMask for a typed-data signature and decrypt through the configured
Zama Sepolia relayer.
```

Indexer:

```text
The active bridge and factories must be indexed from the current deployment
blocks. If the indexer DB has old cursors only, bridge and series status will be
stale even when transactions succeeded on-chain.
```

## Manual Test Gate

Before calling the market ready, complete this Sepolia smoke flow:

```text
1. Deposit public ETH/WETH into a fresh active series.
2. Confirm public P/N balances.
3. Shield a small P amount.
4. Reveal confidential P balance.
5. Unshield part of that confidential P amount.
6. Confirm backend indexes UnshieldRequested.
7. Confirm keeper submits finalizeUnshield.
8. Confirm backend indexes UnshieldFinalized.
9. Confirm public P balance increases.
10. Repeat for N.
```
