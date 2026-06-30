# Freedom Protocol Backend Server Build Spec

This file is the backend server handoff document. A new agent should be able to
build the off-chain API service, event indexer, deployment registry loader, and
transaction-builder layer from this document plus the contracts under
`contracts/src`.

Scope for this spec:

- Backend API server used by the frontend.
- Contract ABI/config loading from existing backend artifacts.
- Event indexing and read-model persistence.
- Transaction-building endpoints for user-signed wallet transactions.
- Bridge request/finalization tracking for the async KMS proof flow.
- Operational architecture, data model, and integration boundaries.

Out of scope for this pass:

- Writing new Solidity protocol contracts.
- Writing Foundry deployment scripts.
- Writing Foundry contract tests.
- Custodying user funds or private keys.
- Server-side decryption of confidential balances without an explicit
  user-authorized proof/decryption flow.

## Mental Model

Freedom creates two option tokens for each `(strike, maturity)` series:

- `stableETH` or `P`: the floor side.
- `upETH` or `N`: the upside side.

Splitting 1 unit of collateral mints exactly `1 P + 1 N`. Before maturity,
merging exactly `1 P + 1 N` returns exactly 1 unit of collateral. At maturity,
settlement sets payout rates such that:

```text
P payout + N payout = 1 collateral
```

So a matched pair still redeems to exactly 1 ETH/WETH/cWETH at maturity.

The same payoff formula is used in public and confidential factories:

```text
SCALE = 1_000_000

if oraclePrice == 0 or strike >= oraclePrice:
  stablePay = SCALE
  upPay = 0
else:
  stablePay = min(SCALE, strike * SCALE / oraclePrice)
  upPay = SCALE - stablePay
```

Example with strike `2000` and maturity price `4000`:

```text
1 P = 0.5 collateral
1 N = 0.5 collateral
1 P + 1 N = 1.0 collateral
```

Example with strike `2000` and maturity price `1600`:

```text
1 P = 1.0 collateral
1 N = 0.0 collateral
1 P + 1 N = 1.0 collateral
```

## Architecture

The backend has three protocol surfaces.

### Public Collateral Stack

Use this stack for native ETH, WETH, or any normal ERC20 collateral.

- `PublicOptionFactory`
  - One deployment per collateral asset.
  - Constructor: `constructor(address collateralToken_, address oracle_)`.
  - `collateralToken_ == address(0)` means native ETH.
  - Any nonzero `collateralToken_` is treated as an ERC20 like WETH.
  - Deploys and owns one `CentralCollateralVault`.
- `CentralCollateralVault`
  - Holds all collateral for all public series created by its factory.
  - Tracks per-series reserves and aggregate reserves.
  - Provides public flash loans from idle vault liquidity.
  - Locks reserve-changing operations while a flash loan is active.
- `PublicOptionToken`
  - Plain ERC20 option token.
  - `decimals() == 6`.
  - Mint/burn restricted to authorized contracts.

Native ETH and WETH use the same public implementation. The only difference is
whether the factory was deployed with `address(0)` or a WETH token address.

### Confidential Collateral Stack

Use this stack for cWETH. It is intentionally separate from the public ETH/WETH
implementation because collateral, balances, allowances, reserves, and payouts
are encrypted.

- `OptionFactory`
  - One deployment per cWETH asset and oracle.
  - Constructor: `constructor(address cWETH_, address oracle_)`.
  - Deploys and owns one `ConfidentialCollateralVault`.
  - Deploys encrypted `OptionToken` pairs.
  - Can create one `SeriesPool` per series side.
- `ConfidentialCollateralVault`
  - Holds encrypted cWETH for all confidential series created by its factory.
  - Tracks encrypted reserves per series.
  - Does not expose flash loans.
- `OptionToken`
  - Confidential ERC20-like token backed by fhEVM encrypted handles.
  - `decimals() == 6`.
  - `totalSupply()`, `balanceOf()`, and `allowance()` return encrypted `euint64`.
- `ConfidentialERC20Base`
  - Shared encrypted token accounting.
  - Events do not reveal amounts.
  - Failed encrypted transfers move zero instead of reverting when the failure
    condition must remain private.

### Bridge Stack

The bridge is an unshielding path from confidential option tokens to public
option tokens.

- `UnshieldBridge`
  - Burns confidential `OptionToken`.
  - Mints public `PublicOptionToken`.
  - Amount is plaintext and deliberately revealed by the caller.
  - Does not move cWETH into ETH/WETH.
  - Requires public bridge capacity to be pre-funded in the public factory.

The bridge is not a collateral bridge. It is a representation bridge:

```text
confidential option token burned -> public option token minted
```

Public collateral backing for these mints must already exist in
`PublicOptionFactory.bridgeMintable`.

## Contract Inputs

The server consumes the existing contract tree and generated ABIs. It should not
put its primary deliverables under `contracts/script` or `contracts/test`.

Contract source tree:

```text
contracts/
  src/
    base/
      OptionFactoryBase.sol
      OptionTokenBase.sol
    public/
      PublicOptionFactory.sol
      PublicOptionToken.sol
      CentralCollateralVault.sol
    confidential/
      ConfidentialERC20Base.sol
      OptionFactory.sol
      OptionToken.sol
      ConfidentialCollateralVault.sol
      ConfidentialMatchingEngine.sol
      SeriesPool.sol
    bridge/
      UnshieldBridge.sol
    interfaces/
      IOptionFactory.sol
```

Backend server tree to create:

```text
backend/
  package.json
  tsconfig.json
  src/
    server.ts
    env.ts
    config/
      chains.ts
      deployments.ts
      abis.ts
    db/
      schema.sql
      migrations/
      client.ts
    indexer/
      worker.ts
      public.ts
      confidential.ts
      bridge.ts
      matching.ts
      pools.ts
    routes/
      health.ts
      config.ts
      series.ts
      public.ts
      confidential.ts
      bridge.ts
      matching.ts
      pools.ts
      oracle.ts
    tx/
      public.ts
      confidential.ts
      bridge.ts
      matching.ts
      pools.ts
      oracle.ts
    services/
      chain.ts
      registry.ts
      kms.ts
      readModels.ts
    types/
      api.ts
      contracts.ts
    openapi.ts
  test/
    routes/
    tx/
    indexer/
  .env.example
  README.md
```

Recommended stack:

- TypeScript plus Node.js.
- Fastify or Express for HTTP.
- `viem` preferred for chain reads, event indexing, and calldata encoding.
- PostgreSQL for persistent indexing. SQLite is acceptable for a local-only
  first pass if the schema can migrate to PostgreSQL cleanly.
- OpenAPI generation or a typed client package for frontend consumption.

## Shared Base Contracts

### `OptionFactoryBase`

Responsibilities:

- Defines `SCALE = 1_000_000`.
- Computes `seriesId = keccak256(abi.encodePacked(strike, maturity))`.
- Computes settlement payout rates.
- Exposes `getTokens(strike, maturity)` and `isSettled(strike, maturity)`.

Backend assumptions:

- `strike` and `oraclePrice` must use the same units.
- `maturity` is a Unix timestamp.
- Series identity is only `(strike, maturity)`, not collateral address. If the
  same strike/maturity exists across ETH, WETH, and cWETH factories, distinguish
  them by factory address in off-chain systems.

### `OptionTokenBase`

Responsibilities:

- Stores immutable `factory`, `strike`, `maturity`, and `isStable`.
- Maintains `authorized[address]`.
- Restricts privileged token operations through `onlyAuthorized`.
- Allows only the factory to call `setAuthorized`.

Implementation rule:

- Any backend component that needs to mint, burn, pull, or transfer option tokens
  must be authorized by the factory on each relevant token.

## Public Contracts

### `PublicOptionToken`

Type: OpenZeppelin ERC20 plus `OptionTokenBase`.

Public API:

```solidity
function decimals() public pure override returns (uint8);
function mint(address to, uint256 amount) external onlyAuthorized;
function burn(address from, uint256 amount) external onlyAuthorized;
```

Rules:

- Amounts are plaintext and use 6 decimals.
- Only authorized contracts can mint or burn.
- The factory is authorized at construction.

### `CentralCollateralVault`

Type: central public collateral vault for one public factory.

Constructor:

```solidity
constructor(address collateralToken_, address factory_)
```

State:

```solidity
address public immutable collateralToken;
address public immutable factory;
bool public immutable isNativeCollateral;
mapping(bytes32 => uint256) public reserves;
uint256 public totalReserves;
bool public flashLoanActive;
```

Reserve API:

```solidity
function depositReserve(bytes32 seriesId, address from, uint256 amount)
  external payable onlyFactory notDuringFlashLoan;

function withdrawReserve(bytes32 seriesId, address to, uint256 amount)
  external onlyFactory notDuringFlashLoan;
```

Flash loan API:

```solidity
function maxFlashLoan(address token) external view returns (uint256);
function flashFee(address token, uint256 amount) public view returns (uint256);
function flashLoan(IERC3156FlashBorrowerLike receiver, address token, uint256 amount, bytes calldata data)
  external returns (bool);
```

Native ETH behavior:

- `collateralToken == address(0)`.
- Deposits must send `msg.value == amount`.
- Withdrawals use `call{value: amount}`.
- Flash loan receiver receives native ETH before callback.
- Repayment is validated by checking vault balance after callback.
- The callback `token` argument is `address(0)`.
- Plain ETH sent directly to the vault through `receive()` is not assigned to a
  series reserve. Treat it as vault surplus/flash-loan liquidity, not option
  backing.

ERC20 behavior:

- Deposits require `msg.value == 0`.
- Deposits call `transferFrom(from, vault, amount)`.
- Withdrawals call `transfer(to, amount)`.
- Flash loan repayment uses `transferFrom(receiver, vault, amount + fee)`.

Architecture note:

- `maxFlashLoan` returns the whole vault balance, including reserves backing
  option tokens. This is intentional for a pooled flash-loan vault, but
  reserve-changing operations are blocked while the loan is active. Tests must
  prove a borrower cannot use borrowed funds to split, merge, redeem, or mutate
  bridge reserves during the loan.

### `PublicOptionFactory`

Constructor:

```solidity
constructor(address collateralToken_, address oracle_)
```

Important state:

```solidity
mapping(bytes32 => Series) public series;
mapping(bytes32 => uint256) public bridgeMintable;
address public bridge;
address public immutable oracle;
address public immutable collateralToken;
CentralCollateralVault public immutable vault;
```

Series:

```solidity
struct Series {
  PublicOptionToken stableToken;
  PublicOptionToken upToken;
  bool settled;
  uint256 stablePayout;
  uint256 upPayout;
}
```

Core API:

```solidity
function createSeries(uint256 strike, uint64 maturity)
  external returns (address stable, address up);

function split(uint256 strike, uint64 maturity, uint256 amount)
  external payable;

function merge(uint256 strike, uint64 maturity, uint256 amount)
  external;

function settle(uint256 strike, uint64 maturity, uint256 oraclePrice)
  external;

function redeem(uint256 strike, uint64 maturity)
  external;

function getTokens(uint256 strike, uint64 maturity)
  external view returns (address stable, address up);

function isSettled(uint256 strike, uint64 maturity)
  external view returns (bool);

function reserves(bytes32 id) external view returns (uint256);
```

Bridge API:

```solidity
function setBridge(address bridge_) external;
function authorizeBridge(uint256 strike, uint64 maturity) external;
function fundBridgeReserve(uint256 strike, uint64 maturity, uint256 amount) external payable;
function bridgeMint(uint256 strike, uint64 maturity, bool isStable, address to, uint256 amount) external;
```

Rules:

- `oracle_` cannot be zero.
- `settle` is callable only by `oracle`.
- `settle` reverts before maturity.
- `split` reverts after settlement.
- `merge` reverts after settlement.
- `redeem` burns the caller's full `P` and `N` balances and withdraws the
  computed claim.
- `setBridge` is one-shot in current code but permissionless.
- `bridgeMint` can only be called by `bridge`.
- `bridgeMintable[id]` is reduced by the exact minted amount.
- `fundBridgeReserve` deposits collateral into the public vault and increases
  bridge mint capacity for the series.

Public split flow:

```text
user -> PublicOptionFactory.split(strike, maturity, amount)
factory -> vault.depositReserve(id, user, amount)
factory -> stableToken.mint(user, amount)
factory -> upToken.mint(user, amount)
```

For native ETH, `msg.value` must equal `amount`. For WETH/ERC20, the user must
approve `PublicOptionFactory.vault()` as spender and send no ETH. The vault is
the contract that calls `transferFrom(user, vault, amount)`.

Public merge flow:

```text
user -> PublicOptionFactory.merge(strike, maturity, amount)
factory -> stableToken.burn(user, amount)
factory -> upToken.burn(user, amount)
factory -> vault.withdrawReserve(id, user, amount)
```

Public redeem flow:

```text
oracle -> settle(strike, maturity, oraclePrice)
user -> redeem(strike, maturity)
factory burns all user P and N
factory withdraws (P * stablePay + N * upPay) / SCALE from vault
```

## Confidential Contracts

### `ConfidentialERC20Base`

Type: ERC20-like encrypted token base.

Public API:

```solidity
function name() public view returns (string memory);
function symbol() public view returns (string memory);
function decimals() public pure returns (uint8);
function totalSupply() public view returns (euint64);
function balanceOf(address account) public view returns (euint64);
function allowance(address owner, address spender) public view returns (euint64);
function approve(address spender, externalEuint64 encAmount, bytes calldata proof) public returns (bool);
function transfer(address to, externalEuint64 encAmount, bytes calldata proof) public returns (bool);
function transferFrom(address from, address to, externalEuint64 encAmount, bytes calldata proof) public returns (bool);
function transfer(address to, euint64 amount) public virtual returns (bool);
```

Rules:

- `totalSupply` is encrypted.
- Balances and allowances are encrypted.
- User-facing encrypted inputs are `externalEuint64` plus proof.
- Internal contract-to-contract movement uses `euint64` handles.
- Events expose participants but not amounts.
- `_burn(from, amount)` burns `min(amount, balanceOf(from))`. This avoids
  leaking insufficient balance, but it creates bridge and accounting risks when
  a plaintext caller assumes the full amount was burned.

### `OptionToken`

Type: confidential option token for one series side.

API:

```solidity
function mint(address to, euint64 amount) external onlyAuthorized;
function burn(address from, euint64 amount) external onlyAuthorized;
function pullFrom(address from, euint64 amount) external onlyAuthorized;
function authorizedTransfer(address from, address to, euint64 amount) external onlyAuthorized;
```

Rules:

- Factory, pools, matching engine, and bridge must be explicitly authorized.
- `pullFrom` moves encrypted tokens from a user into the caller.
- `authorizedTransfer` is used by pools and matching engine to move escrowed
  balances.
- Callers must manage fhEVM ACL permissions before crossing contract boundaries.

### `ConfidentialCollateralVault`

Type: central encrypted cWETH vault for one confidential factory.

Constructor:

```solidity
constructor(address cWETH_, address factory_)
```

State:

```solidity
IConfidentialCollateralToken public immutable cWETH;
address public immutable factory;
mapping(bytes32 => euint64) internal _reserves;
```

API:

```solidity
function depositReserve(bytes32 seriesId, address from, externalEuint64 encAmount, bytes calldata proof)
  external onlyFactory returns (euint64 amount);

function withdrawReserve(bytes32 seriesId, address to, euint64 amount)
  external onlyFactory;

function reserveOf(bytes32 seriesId) external view returns (euint64);
```

Rules:

- Only the factory can deposit or withdraw.
- Deposit converts the external encrypted input to an internal handle, transfers
  cWETH from the user into the vault, and updates encrypted reserves.
- Withdrawal updates encrypted reserves and transfers cWETH to the user.
- No public flash-loan support exists for cWETH.

### `OptionFactory`

Constructor:

```solidity
constructor(address cWETH_, address oracle_)
```

Important state:

```solidity
mapping(bytes32 => Series) public series;
address public poolImplementation;
mapping(bytes32 => mapping(bool => address)) public pools;
IConfidentialWETH public immutable cWETH;
address public immutable oracle;
ConfidentialCollateralVault public immutable vault;
address public matchingEngine;
address public bridge;
```

Series:

```solidity
struct Series {
  OptionToken stableToken;
  OptionToken upToken;
  bool settled;
  euint64 stablePayout;
  euint64 upPayout;
}
```

Core API:

```solidity
function setMatchingEngine(address cme) external;
function setBridge(address bridge_) external;
function authorizeBridge(uint256 strike, uint64 maturity) external;

function createSeries(uint256 strike, uint64 maturity)
  external returns (address stable, address up);

function split(uint256 strike, uint64 maturity, externalEuint64 encAmt, bytes calldata proof) external;
function merge(uint256 strike, uint64 maturity, euint64 amount) external;
function settle(uint256 strike, uint64 maturity, uint256 oraclePrice) external;
function redeem(uint256 strike, uint64 maturity) external;

function setPoolImplementation(address impl) external;
function createPool(uint256 strike, uint64 maturity, bool isStable, address quoteToken, uint64 minPricePerToken)
  external returns (address pool);
function getPool(uint256 strike, uint64 maturity, bool isStable) external view returns (address);

function getTokens(uint256 strike, uint64 maturity)
  external view returns (address stable, address up);
function isSettled(uint256 strike, uint64 maturity) external view returns (bool);
```

Rules:

- `oracle_` cannot be zero.
- `settle` is callable only by `oracle`.
- `settle` reverts before maturity.
- `split` and `merge` revert after settlement.
- `redeem` burns the caller's full encrypted `P` and `N` balances and withdraws
  encrypted cWETH claim.
- `setMatchingEngine` is one-shot in current code but permissionless.
- `setBridge` is one-shot in current code but permissionless.
- `setPoolImplementation` is permissionless and can be changed in current code.
- `createSeries` authorizes `matchingEngine` only if it has already been set.
- `createPool` authorizes the new pool on the selected option token.
- Current `pools[id][isStable]` allows only one pool per side. Although
  `createPool` accepts a quote token, it cannot create multiple quote-token
  pools for the same series side.

Confidential split flow:

```text
user -> OptionFactory.split(strike, maturity, encAmount, proof)
factory -> vault.depositReserve(id, user, encAmount, proof)
factory -> stableToken.mint(user, amount)
factory -> upToken.mint(user, amount)
```

Confidential merge flow:

```text
user grants factory ACL access to encrypted amount handle
user -> OptionFactory.merge(strike, maturity, amount)
factory -> stableToken.pullFrom(user, amount)
factory -> upToken.pullFrom(user, amount)
factory -> stableToken.burn(factory, amount)
factory -> upToken.burn(factory, amount)
factory -> vault.withdrawReserve(id, user, amount)
```

Confidential redeem flow:

```text
oracle -> settle(strike, maturity, oraclePrice)
user -> redeem(strike, maturity)
factory reads encrypted user P and N balances
factory burns both balances
factory computes encrypted claim
factory withdraws encrypted cWETH claim from vault
```

### `ConfidentialMatchingEngine`

Purpose: all-or-nothing blind OTC listings.

Core API:

```solidity
function createListing(
  OptionToken token,
  IConfidentialQuoteToken quoteToken,
  uint256 strike,
  uint64 maturity,
  externalEuint64 encAmount,
  externalEuint64 encMinReceive,
  bytes calldata amountProof,
  bytes calldata minProof
) external returns (uint256 listingId);

function fill(
  uint256 listingId,
  externalEuint64 encPayment,
  externalEuint64 encExpected,
  bytes calldata paymentProof,
  bytes calldata expectedProof
) external;

function cancelListing(uint256 listingId) external;

function getListing(uint256 listingId)
  external view returns (address seller, address token, address quoteToken, uint256 strike, uint64 maturity, bool active);
```

Flow:

```text
seller creates listing
matching engine pulls encrypted option amount into escrow
buyer submits encrypted payment and expected amount
engine checks payment >= minReceive and lockedAmount >= expected in FHE
if match: buyer receives option token and seller receives quote token
if no match: both sides are refunded
listing becomes inactive either way
```

Rules and caveats:

- The matching engine must be authorized on each listed `OptionToken`.
- Set `matchingEngine` before creating series if using the current factory
  auto-authorization behavior.
- Listing metadata is public: seller, token, quote token, strike, maturity, and
  active status.
- Amounts, prices, and match outcome remain encrypted.
- Listings are single-use. Partial fills are not supported.

### `SeriesPool`

Purpose: pooled encrypted liquidity for one option token side.

Instantiation:

- Deploy one implementation contract.
- Factory clones it through `createPool`.
- Each clone is initialized once.

Core API:

```solidity
function initialize(
  address optionToken_,
  address quoteToken_,
  uint256 strike_,
  uint64 maturity_,
  uint64 minPricePerToken_,
  address factory_
) external;

function deposit(externalEuint64 encAmount, bytes calldata proof) external;

function fill(
  externalEuint64 encPayment,
  externalEuint64 encExpected,
  bytes calldata paymentProof,
  bytes calldata expectedProof
) external;

function withdraw() external;
function sellerCount() external view returns (uint256);
function encPoolBalance() external view returns (euint64);
```

Rules:

- One pool per `(seriesId, isStable)` in the current factory.
- Sellers are tracked in public FIFO order.
- `MAX_SELLERS == 50`.
- Deposits and fills are blocked at or after maturity.
- Withdrawals are allowed before or after maturity.
- Fill succeeds privately only if:
  - `payment >= expected * minPricePerToken / SCALE`
  - `poolBalance >= expected`
- Failed fills refund the buyer and transfer zero option tokens.
- Seller quote distribution iterates over all sellers. Gas and fhEVM cost must be
  tested at the 50-seller cap.

## Bridge Contract

### `UnshieldBridge`

Constructor:

```solidity
constructor(address confFactory_, address pubFactory_)
```

State:

```solidity
IBridgeAuthorizableFactory public immutable confidentialFactory;
IPublicOptionFactory public immutable publicFactory;
```

API:

```solidity
function authorizeSeries(uint256 strike, uint64 maturity) external;
function unshield(uint256 strike, uint64 maturity, bool isStable, uint256 amount)
  external returns (uint256 requestId);
function finalizeUnshield(uint256 requestId, bytes calldata abiEncodedCleartexts, bytes calldata decryptionProof)
  external;
```

Flow:

```text
operator -> publicFactory.fundBridgeReserve(strike, maturity, amount)
operator -> bridge.authorizeSeries(strike, maturity)
user -> bridge.unshield(strike, maturity, isStable, amount)
bridge -> confidential token burn(user, plaintext amount converted to euint64)
bridge -> stores encrypted actual burned amount and makes it publicly decryptable
relayer/KMS -> decrypts burned amount and produces proof
anyone -> bridge.finalizeUnshield(requestId, abiEncodedCleartexts, decryptionProof)
bridge -> verifies KMS proof for the burned amount handle
bridge -> publicFactory.bridgeMint(..., user, actualBurnedAmount)
```

Rules:

- Confidential and public series must both exist.
- `amount <= type(uint64).max`.
- User reveals the requested unshield amount.
- Finalization publicly reveals the actual burned amount.
- Public factory must have enough `bridgeMintable[id]` when finalization mints.
- `authorizeSeries` only authorizes the confidential bridge burn path. The
  public bridge mint path is protected by `PublicOptionFactory.bridge`.
- Public mint amount is exactly the verified actual burned amount, not the
  requested amount.
- If a user requests more than their confidential balance, the confidential burn
  clamps to their balance and finalization mints only that lower actual burned
  amount.

Operational caveat:

- Bridge finalization is async and depends on the KMS public-decryption flow.
- Current code does not reserve public bridge capacity at request time. If
  `bridgeMintable[id]` is insufficient at finalization, finalization reverts and
  can be retried after the public bridge reserve is funded.

## Contract Registry Inputs

The backend server assumes the contracts have already been deployed and wired.
It must load deployment metadata from checked-in JSON, environment-specific JSON,
or an operator-managed registry. It must not require Foundry scripts to run as
part of normal API startup.

For a full public plus confidential environment, the registry must contain:

- Public factory for native ETH or WETH/ERC20:
  - `PublicOptionFactory(collateralToken, oracle)`
  - `collateralToken = address(0)` means native ETH.
  - Nonzero `collateralToken` is WETH/ERC20.
  - `vault = PublicOptionFactory.vault()`.
- Confidential factory for cWETH:
  - `OptionFactory(cWETH, oracle)`
  - `vault = OptionFactory.vault()`.
- `SeriesPool` implementation address.
- `ConfidentialMatchingEngine` address.
- `UnshieldBridge(confidentialFactory, publicFactory)` address.
- Bridge configuration:
  - `PublicOptionFactory.bridge() == bridge`.
  - `OptionFactory.bridge() == bridge`.
- Optional known series list:
  - public `PublicOptionFactory.createSeries(strike, maturity)` result.
  - confidential `OptionFactory.createSeries(strike, maturity)` result.
- Per-series bridge readiness:
  - confidential series bridge authorization status.
  - public `bridgeMintable[id]` capacity.

For WETH/ERC20 transaction builders, the approval spender is always the public
vault, not the factory.

## Backend Services

The primary deliverable is an off-chain backend server. It should expose HTTP
APIs for the frontend, index contract events into a queryable read model, and
return unsigned transaction requests for users to sign in their wallets.

The server must never custody user private keys. It should not submit user
transactions except in an explicitly separate operator mode. Default behavior is
to return `{ to, data, value, chainId }` plus metadata.

### Required Deliverables

- `backend/` TypeScript server.
- Database schema and migrations.
- Deployment registry and ABI loader.
- Event indexer worker with reorg-safe checkpoints.
- Read APIs for series, reserves, settlement, bridge requests, listings, pools,
  and user-visible state.
- Transaction-builder APIs for every user action the frontend needs.
- OpenAPI spec or generated typed client.
- `.env.example`.
- Backend README with setup, config, run, and indexing instructions.

### HTTP API

All endpoints should return typed JSON. Use `400` for validation errors, `404`
for unknown chain/factory/series/request, `409` for state conflicts, and `500`
only for unexpected server failures.

Health and config:

```text
GET /health
GET /config
GET /chains
GET /chains/:chainId/deployments
GET /abis
```

Series and contract state:

```text
GET /series?chainId=&factory=&mode=
GET /series/:seriesKey
GET /series/:seriesKey/tokens
GET /series/:seriesKey/settlement
GET /series/:seriesKey/reserves
GET /series/:seriesKey/bridge-capacity
```

Public transaction builders:

```text
POST /tx/public/approve-collateral
POST /tx/public/split
POST /tx/public/merge
POST /tx/public/redeem
POST /tx/public/fund-bridge-reserve
```

Public read helpers:

```text
GET /public/:chainId/factories/:factory/vault
GET /public/:chainId/factories/:factory/flash-loans
GET /public/:chainId/tokens/:token/balance?user=
GET /public/:chainId/collateral/:token/allowance?owner=&spender=
```

Confidential transaction builders:

```text
POST /tx/confidential/split
POST /tx/confidential/merge
POST /tx/confidential/redeem
GET /confidential/balance-handles?chainId=&token=&user=
GET /confidential/allowance-handles?chainId=&token=&owner=&spender=
```

The server may prepare calldata for confidential flows, but encryption, input
proof generation, and user decryption should remain client-side unless a secure
helper is explicitly implemented. If the server adds such a helper, document the
trust model and never persist plaintext confidential balances.

Bridge:

```text
GET /bridge/requests?chainId=&user=&seriesKey=&status=
GET /bridge/requests/:requestKey
POST /tx/bridge/unshield
POST /bridge/requests/:requestKey/decryption-status
POST /tx/bridge/finalize
```

Bridge rules:

- `unshield` only creates the burn request transaction.
- `UnshieldRequested` must be indexed before the frontend can show finalization
  state.
- `finalizeUnshield` requires `abiEncodedCleartexts` and `decryptionProof` from
  the KMS/public-decryption flow.
- The final minted amount is the verified decrypted actual burned amount.
- The API must never label `requestedAmount` as minted amount.
- If public bridge capacity is insufficient, finalization should return a clear
  retryable state and include current `bridgeMintable`.

Matching engine:

```text
GET /matching/listings?chainId=&token=&quoteToken=&seller=&active=
GET /matching/listings/:listingKey
POST /tx/matching/create-listing
POST /tx/matching/fill
POST /tx/matching/cancel
```

Series pools:

```text
GET /pools?chainId=&factory=&seriesKey=&isStable=
GET /pools/:poolAddress
POST /tx/pools/deposit
POST /tx/pools/fill
POST /tx/pools/withdraw
```

Oracle/admin transaction builders:

```text
GET /oracle/settleable-series?chainId=&oracle=
POST /tx/oracle/settle
```

These endpoints return unsigned transactions. Do not sign oracle transactions
unless a separate secure operator mode is explicitly requested.

### Transaction Response Shape

All transaction-builder endpoints should return:

```json
{
  "chainId": 31337,
  "to": "0x...",
  "data": "0x...",
  "value": "0",
  "functionName": "split",
  "args": [],
  "summary": "Split 1.0 ETH into 1.0 P and 1.0 N",
  "preconditions": [
    {
      "kind": "allowance",
      "status": "satisfied",
      "spender": "0x..."
    }
  ],
  "warnings": []
}
```

Rules:

- Use decimal strings for large integers in JSON.
- Return `value` as a wei string.
- Include the exact spender for approval builders.
- For WETH/ERC20 public split and bridge reserve funding, approval spender must
  be the public vault.
- For native ETH split and bridge reserve funding, `value == amount`.
- For bridge finalization, include the decoded `actualBurned` amount if provided
  in the request.

### Deployment Registry

Store one JSON-compatible deployment record per chain:

```json
{
  "chainId": 31337,
  "rpcUrlEnv": "FREEDOM_31337_RPC_URL",
  "startBlock": 0,
  "confirmations": 3,
  "oracle": "0x...",
  "publicFactories": [
    {
      "mode": "ETH",
      "collateralToken": "0x0000000000000000000000000000000000000000",
      "factory": "0x...",
      "vault": "0x..."
    },
    {
      "mode": "WETH",
      "collateralToken": "0x...",
      "factory": "0x...",
      "vault": "0x..."
    }
  ],
  "confidentialFactories": [
    {
      "mode": "cWETH",
      "cWETH": "0x...",
      "factory": "0x...",
      "vault": "0x..."
    }
  ],
  "matchingEngine": "0x...",
  "seriesPoolImplementation": "0x...",
  "bridge": "0x..."
}
```

Off-chain code must always key series by:

```text
chainId + factoryAddress + strike + maturity
```

Do not key only by `seriesId`, because the same `seriesId` can exist in multiple
factories and collateral modes.

### Database Schema

Minimum tables:

```text
chains
deployments
indexer_checkpoints
factories
series
tokens
public_reserves
bridge_requests
matching_listings
pools
pool_sellers
events
```

Required checkpoint fields:

```text
chain_id
indexer_name
last_indexed_block
last_finalized_block
updated_at
```

Required series key fields:

```text
chain_id
factory_address
series_id
strike
maturity
mode
collateral_token
stable_token
up_token
settled
stable_payout
up_payout
created_block
```

Required bridge request fields:

```text
chain_id
bridge_address
request_id
user_address
factory_address
strike
maturity
is_stable
requested_amount
burned_amount_handle
actual_burned_amount
finalized
request_tx_hash
finalize_tx_hash
created_block
finalized_block
```

Encrypted values:

- Store handles and event metadata.
- Do not store plaintext confidential balances unless they are intentionally
  public, such as bridge `actualBurned` after KMS public decryption.
- Distinguish `requested_amount` from `actual_burned_amount`.

### Indexer

Index these events:

Public:

- `SeriesCreated`
- `Split`
- `Merge`
- `Settled`
- `Redeemed`
- `BridgeReserveFunded`
- `BridgeMinted`
- `CentralCollateralVault.ReserveDeposited`
- `CentralCollateralVault.ReserveWithdrawn`
- `CentralCollateralVault.FlashLoan`

Confidential:

- `SeriesCreated`
- `Split`
- `Merge`
- `Settled`
- `Redeemed`
- `PoolCreated`
- `MatchingEngineSet`
- `SeriesPool.Deposited`
- `SeriesPool.Filled`
- `SeriesPool.Withdrawn`
- `ConfidentialMatchingEngine.ListingCreated`
- `ConfidentialMatchingEngine.FillAttempted`
- `ConfidentialMatchingEngine.ListingCancelled`
- `UnshieldBridge.UnshieldRequested`
- `UnshieldBridge.UnshieldFinalized`

Index encrypted events carefully:

- Do not infer hidden amounts from encrypted event sequences.
- It is acceptable to show that an action occurred.
- Only show decrypted amounts to users when the user has ACL/decryption rights
  and explicitly asks the client to decrypt.

Indexer requirements:

- Support multiple chains.
- Use configured `startBlock`.
- Persist checkpoints after successful block ranges.
- Use configurable confirmations before marking data finalized.
- Handle reorgs by rewinding to the last finalized checkpoint or by deleting and
  replaying affected blocks.
- Store raw event logs in an `events` table for debugging/replay.
- Provide idempotent upserts; replaying the same block range must not duplicate
  read-model rows.

### Oracle Service

The oracle service must:

- Use the exact `oracle` address configured at factory deployment.
- Wait until `block.timestamp >= maturity`.
- Submit `settle(strike, maturity, oraclePrice)`.
- Use the same price units as `strike`.
- Avoid double-settling; factories reject it but the service should also track it.

Production recommendation:

- Replace the single EOA oracle with a governed oracle adapter or multisig-owned
  service before mainnet deployment.

### Transaction Builder

The backend should expose builders for:

- Public ETH split: value-bearing transaction.
- Public WETH/ERC20 split: approve the public vault, then split through the
  factory.
- Public merge.
- Public redeem.
- Public bridge reserve funding.
- Public vault flash loan metadata.
- Confidential split with encrypted input proof.
- Confidential merge using an ACL-allowed `euint64` handle.
- Confidential redeem.
- Confidential pool deposit/fill/withdraw.
- Confidential OTC listing/fill/cancel.
- Bridge unshield request.
- Bridge finalize with KMS proof.

Each builder must validate the target chain, factory, and series against the
registry/read model before returning calldata. It should report missing
preconditions instead of silently building transactions that are known to fail.

## Access Control And Production Hardening

Current code is prototype-friendly and intentionally light on governance. A
production backend should change this.

Required hardening:

- Add owner or role-based access control to:
  - `PublicOptionFactory.setBridge`
  - `OptionFactory.setBridge`
  - `OptionFactory.setMatchingEngine`
  - `OptionFactory.setPoolImplementation`
  - `createSeries` if permissionless series creation is not desired
  - `createPool` if pool parameters should be curated
- Decide whether bridge reserve funding is permissionless or operator-only.
- Add pausing for split, merge, redeem, bridge, pools, and flash loans.
- Add explicit reentrancy protection to public vault/factory paths, even though
  flash-loan reserve mutation is already locked.
- Add a way to authorize a matching engine or pool for already-created series.
- Add a way to rotate oracle through governance, or deploy new factories per
  oracle epoch.
- Add events for configuration changes missing in current contracts, especially
  `setBridge` and `setPoolImplementation`.

## Invariants

These invariants should drive server-side validation, transaction-builder
precondition checks, and protocol review.

Public collateral:

- Before settlement, every successful split increases both token supplies by
  `amount` and increases `vault.reserves[id]` by `amount`.
- Before settlement, every successful merge decreases both token supplies by
  `amount` and decreases `vault.reserves[id]` by `amount`.
- After settlement, `stablePayout + upPayout == SCALE`.
- For any user redeem, claim equals
  `(stableBal * stablePayout + upBal * upPayout) / SCALE`.
- A holder of equal `P` and `N` gets exactly the same collateral amount whether
  they merge before settlement or redeem after settlement, modulo integer
  rounding rules.
- `bridgeMintable[id]` decreases by the minted public amount.
- Public bridge mints never exceed prefunded bridge capacity.
- During flash loans, split, merge, redeem, reserve deposit, reserve withdrawal,
  and bridge reserve funding cannot mutate reserves.

Confidential collateral:

- `totalSupply()` is encrypted and changes on mint/burn.
- Split mints equal encrypted `P` and `N` amounts.
- Merge burns equal encrypted `P` and `N` amounts and returns equal encrypted
  cWETH.
- Settlement payout handles sum to `SCALE`.
- Redeem burns the user's encrypted balances and returns encrypted cWETH claim.
- No public event reveals encrypted amount, balance, allowance, reserve, or
  payout size beyond what is intentionally plaintext.
- Matching engine and pool transfers preserve encrypted token conservation.

Bridge:

- Public mints are backed by public bridge reserve capacity.
- Public mint amount equals the verified actual confidential burn amount.
- Same `(strike, maturity, isStable)` must exist on both factories.

## Backend Verification

The backend agent should verify the server, not add Foundry-focused contract
tests as the primary deliverable.

API route coverage:

- `GET /health` reports process and DB status.
- `GET /config` and deployment routes return all configured chains and
  contracts.
- Series routes return data keyed by `chainId + factoryAddress + strike +
  maturity`.
- Reserve routes return public vault reserves and bridge capacity.
- Confidential handle routes return handles only, not decrypted values.
- Bridge routes distinguish pending, finalized, failed, and retryable states.

Transaction-builder coverage:

- Public ETH split returns `value == amount`.
- Public WETH/ERC20 split returns approval spender equal to the public vault.
- Public merge/redeem builders target the public factory.
- Confidential split/merge/redeem builders target the confidential factory and
  preserve encrypted-input/proof parameters.
- Matching and pool builders encode the expected contract calls.
- Bridge unshield builder returns only the request transaction.
- Bridge finalize builder requires KMS proof inputs and encodes
  `finalizeUnshield`.
- Oracle settle builder is unsigned by default.

Indexer coverage:

- Replays configured block ranges idempotently.
- Persists checkpoints.
- Handles duplicate logs.
- Handles reorg rewind or finalized-block replay.
- Indexes `UnshieldRequested` with `burnedAmountHandle`.
- Indexes `UnshieldFinalized` with `actualBurnedAmount`.
- Never overwrites `requestedAmount` with `actualBurnedAmount`.

Integration verification:

- Run the server against a local RPC with deployed contracts.
- Confirm OpenAPI or typed client generation works.
- Confirm frontend can load config, list series, build transactions, and track
  bridge requests.
- Confirm no route requires private keys in default mode.

## Implementation Checklist

Use this order if building the backend server from scratch.

1. Read `BACKEND.md`, `FRONTEND.md`, and contract ABIs.
2. Create `backend/` TypeScript project.
3. Add environment parsing and chain/deployment registry loading.
4. Add ABI loading from `contracts/out` or checked-in ABI JSON.
5. Define DB schema and migrations.
6. Implement chain clients with configured RPC URLs.
7. Implement health/config routes.
8. Implement series, reserve, settlement, and token read routes.
9. Implement transaction-builder utilities.
10. Implement public transaction-builder routes.
11. Implement confidential transaction-builder routes.
12. Implement bridge request/finalize routes.
13. Implement matching engine and pool routes.
14. Implement oracle/admin transaction builders as unsigned outputs.
15. Implement indexer workers with checkpoints and reorg handling.
16. Add OpenAPI spec or generated typed client.
17. Add `.env.example` and backend README.
18. Run backend typecheck, lint, and server tests.
19. Report completed endpoints, indexed events, and remaining backend hooks.

Do not treat contract deployment scripts or Foundry tests as completion criteria
for this backend task. They can exist separately, but this spec is satisfied only
when the frontend has a usable API server.

## Open Architecture Decisions

These must be decided before a serious testnet deployment.

1. Governance model

Current setters are permissionless or one-shot without owner checks. Decide
whether factories are immutable once deployed or controlled by an owner,
multisig, or timelock.

2. Oracle model

Current factories use one immutable oracle address. Decide whether this is an
EOA, multisig, adapter, or oracle network. If rotation is needed, implement it
explicitly.

3. Bridge capacity liveness

Current unshielding proves the actual burned amount before public mint, so it no
longer inflates public supply. It does not reserve public bridge capacity at
request time. Decide whether to add a reserve-locking flow so finalization cannot
be delayed by exhausted `bridgeMintable` capacity.

4. Public flash loan risk tolerance

The vault lends all current liquidity, including option backing reserves. This
can be acceptable if repayment is atomic and reserve mutation is locked, but it
needs adversarial testing and likely reentrancy guards.

5. Pool multiplicity

Current confidential factory supports only one pool per series side. If the
product needs multiple quote tokens or multiple price tiers, change the mapping
to include `quoteToken` and a pool identifier.

6. Matching engine authorization

Current auto-authorization only applies to series created after
`setMatchingEngine`. Add an explicit `authorizeMatchingEngine(strike, maturity)`
or make `setMatchingEngine` iterate/authorize known series if existing series
must be supported.

7. cWETH specification

This repo assumes cWETH exposes encrypted `transferFrom`, `transfer`, and
`balanceOf`. Finalize the concrete cWETH contract, mint/burn policy, ACL model,
and test helpers.

8. Amount precision

All current option tokens use 6 decimals. Confirm whether collateral wrappers
also use 6 decimals or whether adapters are needed for 18-decimal ETH/WETH UX.
