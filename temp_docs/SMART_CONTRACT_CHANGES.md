# Smart Contract Changes

Historical handoff. This document predates
`temp_docs/POC_10_MINUTE_ABI_HANDOFF.md`; monthly maturity identifiers below
are obsolete and should not be used for the current PoC ABI.

This doc replaces the old "backend-dependent" assumption with a client-first
protocol surface. Core user actions should be formed and submitted from the
frontend wallet. The only backend-like service should be a market watcher/indexer
for large market data.

## Goals

- Keep the factory registry as the canonical source of series existence.
- Deploy P/N option tokens as deterministic clones.
- Let users pay for new series creation when they are first to use a series.
- Batch series creation and deposit/minting where possible.
- Constrain strikes enough to prevent clone explosion while preserving user
  choice.
- Support first-of-month maturities without complicated timestamp UX.

## Series Identity

Use a canonical series key per factory:

```solidity
struct SeriesKey {
    uint256 strikePrice;
    uint32 maturityMonth;
}
```

`maturityMonth` is encoded as `YYYYMM`.

Examples:

```text
202608 = August 2026
202701 = January 2027
```

On-chain mapping key:

```solidity
function seriesId(uint256 strikePrice, uint32 maturityMonth)
    public
    pure
    returns (bytes32)
{
    return keccak256(abi.encode(strikePrice, maturityMonth));
}
```

Off-chain/indexer/frontend cache identity must include:

```text
chainId + factoryAddress + strikePrice + maturityMonth
```

The same strike/maturity can exist independently in ETH, WETH, and cWETH
factories.

## Strike Rules

Valid strike:

```text
positive multiple of $50
```

Contract constant:

```solidity
uint256 public constant STRIKE_TICK = 50;
```

Validation:

```solidity
error InvalidStrike();

function _validateStrike(uint256 strikePrice) internal pure {
    if (strikePrice == 0 || strikePrice % STRIKE_TICK != 0) {
        revert InvalidStrike();
    }
}
```

The frontend default strike should be:

```text
largest multiple of $50 less than or equal to 50% of current ETH market price
```

Example:

```text
ETH = $4,123
50% = $2,061.50
default strike = $2,050
```

Users can still choose any valid multiple of 50, including much farther strikes
for more stability buffer.

## Maturity Rules

User-facing maturity is the first day of any future month.

Current contract representation:

```solidity
uint32 maturityMonth; // YYYYMM
uint64 maturityTimestamp; // first day of that month at 00:00:00 UTC
```

Validation is exact:

```solidity
error InvalidMaturity();

function _validateMaturity(uint32 maturityMonth, uint64 maturityTimestamp) internal view {
    uint32 year = maturityMonth / 100;
    uint32 month = maturityMonth % 100;

    if (year < 2026 || month == 0 || month > 12) revert InvalidMaturity();
    if (maturityTimestamp <= block.timestamp || maturityTimestamp % 1 days != 0) revert InvalidMaturity();

    (uint256 timestampYear, uint256 timestampMonth, uint256 timestampDay) =
        _timestampToDate(maturityTimestamp);
    if (timestampDay != 1 || timestampYear != year || timestampMonth != month) {
        revert InvalidMaturity();
    }
}
```

Examples:

```text
valid before August 2026:
  maturityMonth = 202608
  maturityTimestamp = 1785542400

invalid:
  maturityMonth = 202613
  maturityMonth = 202608 with Sep 1 2026 timestamp
  maturityMonth = 202608 with Aug 2 2026 timestamp
  any non-midnight UTC timestamp
```

The frontend must derive `maturityTimestamp` from the selected month as the
first day of that month at 00:00:00 UTC.

## Factory Registry

Each factory should keep a canonical registry:

```solidity
struct Series {
    address stableToken;       // P
    address upToken;           // N
    uint256 strikePrice;
    uint32 maturityMonth;
    uint64 maturityTimestamp;
    bool exists;
    bool settled;
    uint256 stablePayout;
    uint256 upPayout;
}

mapping(bytes32 => Series) public series;
```

Views:

```solidity
function getSeries(uint256 strikePrice, uint32 maturityMonth)
    external
    view
    returns (Series memory);

function getTokens(uint256 strikePrice, uint32 maturityMonth)
    external
    view
    returns (address stableToken, address upToken);

function seriesExists(uint256 strikePrice, uint32 maturityMonth)
    external
    view
    returns (bool);
```

The frontend should use the registry as truth. Deterministic address prediction
is useful, but not the canonical "exists" check.

## Deterministic Clone Deployment

Switch P/N token deployment from plain `new` to deterministic minimal proxies.

Use OpenZeppelin `Clones.cloneDeterministic`.

Factory state:

```solidity
address public immutable stableTokenImplementation;
address public immutable upTokenImplementation;
```

Salt derivation:

```solidity
function _tokenSalt(bytes32 id, bool isStable) internal pure returns (bytes32) {
    return keccak256(abi.encode(id, isStable));
}
```

Prediction views:

```solidity
function predictTokenAddresses(uint256 strikePrice, uint32 maturityMonth)
    external
    view
    returns (address stableToken, address upToken);
```

Deployment:

```solidity
address stable = Clones.cloneDeterministic(
    stableTokenImplementation,
    _tokenSalt(id, true)
);

address up = Clones.cloneDeterministic(
    upTokenImplementation,
    _tokenSalt(id, false)
);
```

Token contracts need `initialize(...)` instead of constructor args.

Public token initializer:

```solidity
function initialize(
    string memory name_,
    string memory symbol_,
    address factory_,
    uint256 strikePrice_,
    uint32 maturityMonth_,
    uint64 maturityTimestamp_,
    bool isStable_
) external initializer;
```

Confidential token initializer should do the same, plus any FHE setup needed by
the current implementation.

## Create-And-Split

Add convenience functions that create the series if needed, then deposit
collateral and mint P/N.

Public native ETH:

```solidity
function createSeriesAndSplit(
    uint256 strikePrice,
    uint32 maturityMonth,
    uint64 maturityTimestamp,
    uint256 amount
) external payable returns (address stableToken, address upToken);
```

Behavior:

```text
1. Validate strike and maturity.
2. If series does not exist, deploy deterministic P/N clones.
3. Deposit collateral into vault.
4. Mint equal P and N to msg.sender.
```

For native ETH, this can be a true single transaction.

Public WETH/ERC20:

```text
approve collateral to factory.vault() -> createSeriesAndSplit
```

Canonical WETH generally does not support permit, so do not assume a single
transaction from zero allowance.

Confidential cWETH:

```solidity
function createSeriesAndSplit(
    uint256 strikePrice,
    uint32 maturityMonth,
    uint64 maturityTimestamp,
    externalEuint64 encAmt,
    bytes calldata proof
) external returns (address stableToken, address upToken);
```

Confidential flow:

```text
1. User authorizes factory.vault() on cWETH.
   - Repo/mock allowance-style cWETH:
     cWETH.approve(vault, encryptedAllowance, allowanceProof)
     encryptedAllowance is encrypted for cWETH address + user.
   - Real ERC7984 operator-style cWETH:
     use operator authorization such as setOperator(vault, until).
2. User encrypts the deposit amount for the factory address + user.
3. User calls createSeriesAndSplit(..., encAmt, proof) or split(..., encAmt, proof).
4. Factory converts the external input exactly once with FHE.fromExternal.
5. Factory grants transient access to the vault.
6. Vault receives an internal euint64 handle and calls cWETH.confidentialTransferFrom(user, vault, amount).
7. Vault uses the encrypted amount actually transferred for reserves and P/N minting.
```

Do not pass the same `externalEuint64/proof` into both the vault and cWETH. Real
fhEVM input proofs are target-contract sensitive.

## Existing Split Functions

Keep existing split functions for already-created series:

```solidity
function split(uint256 strikePrice, uint32 maturityMonth, uint256 amount) external payable; // public
function split(uint256 strikePrice, uint32 maturityMonth, externalEuint64 encAmt, bytes calldata proof) external; // confidential
```

Internally, both `split` and `createSeriesAndSplit` should share the same
private `_split` implementation.

## Settlement

Settlement should use the new series key:

```solidity
function settle(
    uint256 strikePrice,
    uint32 maturityMonth,
    uint256 oraclePrice
) external;
```

Settlement checks:

```text
series exists
not already settled
block.timestamp >= maturityTimestamp
msg.sender is oracle/admin
```

Payout formula remains:

```text
if oraclePrice == 0 or strikePrice >= oraclePrice:
  stablePay = SCALE
  upPay = 0
else:
  stablePay = strikePrice * SCALE / oraclePrice
  upPay = SCALE - stablePay
```

## Events

Emit enough for the market watcher and frontend caches:

```solidity
event SeriesCreated(
    bytes32 indexed seriesId,
    uint256 indexed strikePrice,
    uint32 indexed maturityMonth,
    uint64 maturityTimestamp,
    address stableToken,
    address upToken
);

event Split(
    address indexed user,
    bytes32 indexed seriesId,
    uint256 amount
);

event Settled(
    bytes32 indexed seriesId,
    uint256 oraclePrice,
    uint256 stablePayout,
    uint256 upPayout
);

event Redeemed(
    address indexed user,
    bytes32 indexed seriesId,
    uint256 claim
);
```

For confidential events, omit plaintext amounts where privacy requires it.

Required confidential cWETH interface:

```solidity
function confidentialTransferFrom(address from, address to, bytes32 amount) external returns (bytes32);
function confidentialTransfer(address to, bytes32 amount) external returns (bytes32);
function confidentialBalanceOf(address account) external view returns (bytes32);
```

Frontend configuration should expose the cWETH authorization mode because test
tokens may use encrypted allowance while real ERC7984-style tokens may use
operator authorization:

```text
cwethAuthMode = allowance | operator | none
```

## Frontend Existence Check

Recommended frontend logic:

```text
1. User enters strike and maturity month.
2. Validate strike multiple of 50.
3. Call factory.getSeries(strike, maturityMonth).
4. If exists:
   use registered token addresses.
5. If not exists:
   call factory.predictTokenAddresses(strike, maturityMonth).
   show "This series will be created in your transaction."
   submit createSeriesAndSplit.
```

Do not use `eth_getCode(predictedAddress)` as the only existence source.
Registry state remains canonical.

## Security Notes

- Use `abi.encode`, not `abi.encodePacked`, for `seriesId`.
- Validate strike and maturity on-chain, not only in the frontend.
- `createSeriesAndSplit` must be reentrancy-safe around collateral movement.
- If using clone initializers, protect them with `initializer`.
- Deterministic salt must include token side to avoid P/N collision.
- If multiple factories share token implementations, salts are still scoped by
  factory address because CREATE2 deployer is the factory.
- Keep oracle/admin settlement controls separate from user claim flow.
