# Freedom Protocol — Contract Architecture Changes

> Historical document. This file describes an earlier public-mode and
> `UnshieldBridge` implementation plan. The current PoC ABI uses
> `maturityTimestamp`, `ShieldBridge`, and the Chainlink settlement adapter.
> Treat `temp_docs/POC_10_MINUTE_ABI_HANDOFF.md` and the contracts in
> `contracts/src/` as the current source of truth.

Implementation spec for adding public mode and the unshield bridge on top of the existing confidential contracts.

Read the existing contracts in `src/` before starting. This document describes all changes relative to that current state.

---

## Final Directory Structure

```
contracts/src/
├── base/
│   ├── OptionTokenBase.sol            ← new
│   └── OptionFactoryBase.sol          ← new
├── interfaces/
│   ├── IOptionToken.sol               ← new
│   └── IOptionFactory.sol             ← new
├── public/
│   ├── CentralCollateralVault.sol     ← new
│   ├── PublicOptionToken.sol          ← new
│   └── PublicOptionFactory.sol        ← new
├── confidential/
│   ├── ConfidentialCollateralVault.sol ← new
│   ├── ConfidentialERC20Base.sol      ← move from src/, no logic changes
│   ├── OptionToken.sol                ← move from src/, inherit OptionTokenBase
│   ├── OptionFactory.sol              ← move from src/, inherit OptionFactoryBase, two small additions
│   ├── ConfidentialMatchingEngine.sol ← move from src/, no logic changes
│   └── SeriesPool.sol                 ← move from src/, no logic changes
└── bridge/
    └── UnshieldBridge.sol             ← new
```

---

## Step 1 — Move Existing Files, Fix Imports

Move all five files from `src/` into `src/confidential/`. Do not change any logic yet — just update import paths.

After moving, `OptionToken.sol` imports `ConfidentialERC20Base` from the same directory (no path change needed). `OptionFactory.sol` imports `OptionToken` and `SeriesPool` — update to relative paths within `src/confidential/`.

Verify `forge build` passes before proceeding.

---

## Step 2 — Write `src/base/OptionTokenBase.sol`

Both `OptionToken` (confidential) and `PublicOptionToken` (public) share the same immutable fields, authorization mapping, and `setAuthorized` logic. Factor them out:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract OptionTokenBase {
    address public immutable factory;
    uint256 public immutable strike;
    uint64  public immutable maturity;
    bool    public immutable isStable;

    mapping(address => bool) public authorized;

    error NotAuthorized();

    modifier onlyAuthorized() {
        if (msg.sender != factory && !authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(address factory_, uint256 strike_, uint64 maturity_, bool isStable_) {
        factory  = factory_;
        strike   = strike_;
        maturity = maturity_;
        isStable = isStable_;
    }

    function setAuthorized(address addr, bool enabled) external {
        if (msg.sender != factory) revert NotAuthorized();
        authorized[addr] = enabled;
    }
}
```

---

## Step 3 — Write `src/base/OptionFactoryBase.sol`

Both factories share `SCALE`, `seriesId`, `_uint2str`, settlement math, and the `getTokens`/`isSettled` view signatures. Factor them out:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract OptionFactoryBase {
    uint64 public constant SCALE = 1_000_000;

    function seriesId(uint256 strike, uint64 maturity) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(strike, maturity));
    }

    /// @dev Identical plaintext math in both modes. Confidential factory encrypts the result after.
    function _computePayouts(uint256 strike, uint256 oraclePrice)
        internal
        pure
        returns (uint64 stablePay, uint64 upPay)
    {
        if (oraclePrice == 0 || strike >= oraclePrice) {
            stablePay = SCALE;
        } else {
            uint256 raw = (strike * uint256(SCALE)) / oraclePrice;
            stablePay = raw >= SCALE ? SCALE : uint64(raw);
        }
        upPay = SCALE - stablePay;
    }

    function _uint2str(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "0";
        uint256 tmp = n;
        uint256 digits;
        while (tmp != 0) { digits++; tmp /= 10; }
        bytes memory buf = new bytes(digits);
        while (n != 0) { digits--; buf[digits] = bytes1(uint8(48 + n % 10)); n /= 10; }
        return string(buf);
    }

    // Implemented differently in each subclass (Series struct differs).
    function getTokens(uint256 strike, uint64 maturity) external view virtual returns (address stable, address up);
    function isSettled(uint256 strike, uint64 maturity) external view virtual returns (bool);
}
```

---

## Step 4 — Write `src/interfaces/IOptionToken.sol`

Common read-only interface. Mint/burn are excluded because the signatures differ (`uint256` vs `euint64`).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOptionToken {
    function factory()   external view returns (address);
    function strike()    external view returns (uint256);
    function maturity()  external view returns (uint64);
    function isStable()  external view returns (bool);
    function authorized(address) external view returns (bool);
    function setAuthorized(address addr, bool enabled) external;
}
```

---

## Step 5 — Write `src/interfaces/IOptionFactory.sol`

Used by `UnshieldBridge` so it can reference both factories without importing concrete types.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOptionFactory {
    function getTokens(uint256 strike, uint64 maturity) external view returns (address stable, address up);
    function isSettled(uint256 strike, uint64 maturity) external view returns (bool);
    function seriesId(uint256 strike, uint64 maturity)  external pure returns (bytes32);
}
```

---

## Step 6 — Update `src/confidential/OptionToken.sol`

Remove the duplicated fields and modifier — inherit them from `OptionTokenBase` instead.

**Remove:**
- `address public immutable factory`
- `uint256 public immutable strike`
- `uint64 public immutable maturity`
- `bool public immutable isStable`
- `mapping(address => bool) public authorized`
- `error NotAuthorized()`
- `modifier onlyAuthorized()`
- `function setAuthorized(...)`
- `error OnlyFactory()` — replaced by `NotAuthorized` from base

**Add inheritance:**
```solidity
import {OptionTokenBase} from "../base/OptionTokenBase.sol";

contract OptionToken is ConfidentialERC20Base, OptionTokenBase {
    constructor(
        string memory name_,
        string memory symbol_,
        address factory_,
        uint256 strike_,
        uint64 maturity_,
        bool isStable_
    )
        ConfidentialERC20Base(name_, symbol_)
        OptionTokenBase(factory_, strike_, maturity_, isStable_)
    {}

    // mint, burn, pullFrom, authorizedTransfer — unchanged, use onlyAuthorized from base
}
```

---

## Step 7 — Update `src/confidential/OptionFactory.sol`

**Add inheritance:**
```solidity
import {OptionFactoryBase} from "../base/OptionFactoryBase.sol";

contract OptionFactory is OptionFactoryBase { ... }
```

**Remove** (now in base):
- `uint64 public constant SCALE`
- `function seriesId(...)`
- `function _uint2str(...)`
- The inline settlement math in `settle()` — replace with `_computePayouts(strike, oraclePrice)`

**Update `settle()`** to use `_computePayouts`:
```solidity
function settle(uint256 strike, uint64 maturity, uint256 oraclePrice) external {
    if (msg.sender != oracle) revert NotOracle();
    bytes32 id = seriesId(strike, maturity);
    Series storage s = series[id];
    if (address(s.stableToken) == address(0)) revert SeriesNotFound();
    if (s.settled) revert AlreadySettled();
    if (block.timestamp < maturity) revert NotYetMatured();

    (uint64 stablePay, uint64 upPay) = _computePayouts(strike, oraclePrice);

    s.stablePayout = FHE.asEuint64(stablePay);
    s.upPayout     = FHE.asEuint64(upPay);
    FHE.allowThis(s.stablePayout);
    FHE.allowThis(s.upPayout);

    s.settled = true;
    emit Settled(id, oraclePrice);
}
```

**Implement abstract functions from base:**
```solidity
function getTokens(uint256 strike, uint64 maturity) external view override returns (address stable, address up) {
    bytes32 id = seriesId(strike, maturity);
    return (address(series[id].stableToken), address(series[id].upToken));
}

function isSettled(uint256 strike, uint64 maturity) external view override returns (bool) {
    return series[seriesId(strike, maturity)].settled;
}
```

**Tighten `setMatchingEngine`** — currently permissionless, anyone can overwrite:
```solidity
function setMatchingEngine(address cme) external {
    require(matchingEngine == address(0), "already set");
    matchingEngine = cme;
    emit MatchingEngineSet(cme);
}
```

**Add bridge support** — new storage and functions:
```solidity
address public bridge;

function setBridge(address bridge_) external {
    require(bridge == address(0), "already set");
    bridge = bridge_;
}

/// @notice Authorize the bridge to burn tokens for a specific series.
///         Call once per series after deploying the bridge.
function authorizeBridge(uint256 strike, uint64 maturity) external {
    require(msg.sender == bridge, "not bridge");
    bytes32 id = seriesId(strike, maturity);
    Series storage s = series[id];
    if (address(s.stableToken) == address(0)) revert SeriesNotFound();
    s.stableToken.setAuthorized(bridge, true);
    s.upToken.setAuthorized(bridge, true);
}
```

Everything else in `OptionFactory` (split, merge, redeem, pool infra, events, errors) stays unchanged.

---

## Step 8 — Write `src/public/PublicOptionToken.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OptionTokenBase} from "../base/OptionTokenBase.sol";

contract PublicOptionToken is ERC20, OptionTokenBase {
    constructor(
        string memory name_,
        string memory symbol_,
        address factory_,
        uint256 strike_,
        uint64 maturity_,
        bool isStable_
    )
        ERC20(name_, symbol_)
        OptionTokenBase(factory_, strike_, maturity_, isStable_)
    {}

    function decimals() public pure override returns (uint8) { return 6; }

    function mint(address to, uint256 amount) external onlyAuthorized {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyAuthorized {
        _burn(from, amount);
    }
}
```

---

## Step 9 — Write `src/public/PublicOptionFactory.sol`

Plaintext mirror of `OptionFactory`. Inherits `OptionFactoryBase` for shared utilities and deploys one `CentralCollateralVault` in the constructor. Use `collateralToken = address(0)` for native ETH, or an ERC-20 token address for WETH-like collateral.

Key implementation points:
- `split()` deposits native ETH or ERC-20 collateral into `vault.depositReserve(id, msg.sender, amount)` and mints equal P/N.
- `merge()` burns equal P/N and withdraws from `vault.withdrawReserve(id, msg.sender, amount)`.
- `redeem()` burns settled P/N and withdraws the computed claim from the vault.
- `fundBridgeReserve()` deposits collateral into the same vault and increases `bridgeMintable[id]`.
- `bridgeMint()` mints public P or N only up to funded `bridgeMintable[id]`.
- `reserves(bytes32)` reads `vault.reserves(id)` for ABI compatibility with the previous public mapping getter.
- The vault exposes native ETH or ERC-20 collateral flash loans and blocks reserve-changing operations while a flash loan is active.

---

## Step 10 — Write `src/bridge/UnshieldBridge.sol`

Burns confidential tokens, mints equivalent public tokens. Amount is plaintext — user accepts their position size is revealed.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {IOptionFactory} from "../interfaces/IOptionFactory.sol";
import {OptionToken} from "../confidential/OptionToken.sol";

interface IBridgeAuthorizableFactory is IOptionFactory {
    function authorizeBridge(uint256 strike, uint64 maturity) external;
}

interface IPublicOptionFactory is IOptionFactory {
    function bridgeMint(uint256 strike, uint64 maturity, bool isStable, address to, uint256 amount) external;
}

contract UnshieldBridge {
    IBridgeAuthorizableFactory public immutable confidentialFactory;
    IPublicOptionFactory public immutable publicFactory;

    struct UnshieldRequest {
        address user;
        uint256 strike;
        uint64 maturity;
        bool isStable;
        uint64 requestedAmount;
        euint64 burnedAmount;
        bool finalized;
    }

    uint256 public nextRequestId;
    mapping(uint256 => UnshieldRequest) public requests;

    event UnshieldRequested(
        uint256 indexed requestId,
        address indexed user,
        uint256 indexed strike,
        uint64 maturity,
        bool isStable,
        uint64 requestedAmount,
        bytes32 burnedAmountHandle
    );
    event UnshieldFinalized(
        uint256 indexed requestId,
        address indexed user,
        uint256 indexed strike,
        uint64 maturity,
        bool isStable,
        uint64 amount
    );

    error SeriesNotFound();
    error AmountTooLarge();
    error RequestNotFound();
    error AlreadyFinalized();
    error BurnExceedsRequest();

    constructor(address confFactory_, address pubFactory_) {
        confidentialFactory = IBridgeAuthorizableFactory(confFactory_);
        publicFactory = IPublicOptionFactory(pubFactory_);
    }

    function authorizeSeries(uint256 strike, uint64 maturity) external {
        confidentialFactory.authorizeBridge(strike, maturity);
    }

    /// @notice Burns up to `amount` confidential tokens and starts a public-decryption-backed mint request.
    function unshield(uint256 strike, uint64 maturity, bool isStable, uint256 amount) external returns (uint256 requestId) {
        (address confStable, address confUp) = confidentialFactory.getTokens(strike, maturity);
        (address pubStable, address pubUp) = publicFactory.getTokens(strike, maturity);
        address confTokenAddr = isStable ? confStable : confUp;
        address pubTokenAddr = isStable ? pubStable : pubUp;
        if (confTokenAddr == address(0) || pubTokenAddr == address(0)) revert SeriesNotFound();
        if (amount > type(uint64).max) revert AmountTooLarge();

        OptionToken confToken = OptionToken(confTokenAddr);

        // forge-lint: disable-next-line(unsafe-typecast)
        euint64 encAmount = FHE.asEuint64(uint64(amount));
        FHE.allow(encAmount, address(confToken));
        euint64 burnedAmount = confToken.burn(msg.sender, encAmount);
        FHE.makePubliclyDecryptable(burnedAmount);

        requestId = nextRequestId++;
        requests[requestId] = UnshieldRequest({
            user: msg.sender,
            strike: strike,
            maturity: maturity,
            isStable: isStable,
            requestedAmount: uint64(amount),
            burnedAmount: burnedAmount,
            finalized: false
        });

        emit UnshieldRequested(
            requestId, msg.sender, strike, maturity, isStable, uint64(amount), FHE.toBytes32(burnedAmount)
        );
    }

    function finalizeUnshield(uint256 requestId, bytes calldata abiEncodedCleartexts, bytes calldata decryptionProof)
        external
    {
        UnshieldRequest storage request = requests[requestId];
        if (request.user == address(0)) revert RequestNotFound();
        if (request.finalized) revert AlreadyFinalized();

        bytes32[] memory handlesList = new bytes32[](1);
        handlesList[0] = FHE.toBytes32(request.burnedAmount);
        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        uint64 actualBurned = abi.decode(abiEncodedCleartexts, (uint64));
        if (actualBurned > request.requestedAmount) revert BurnExceedsRequest();
        request.finalized = true;

        publicFactory.bridgeMint(request.strike, request.maturity, request.isStable, request.user, actualBurned);

        emit UnshieldFinalized(
            requestId, request.user, request.strike, request.maturity, request.isStable, actualBurned
        );
    }
}
```

**Reserve accounting note:** The bridge burns confidential tokens (backed by cWETH in `ConfidentialCollateralVault`) and mints public tokens (redeemable against the public factory's ETH/ERC-20 collateral vault). The two factories hold separate collateral pools. For v1, the public factory must be funded through `fundBridgeReserve(strike, maturity, amount)` before bridge mints can succeed. `bridgeMintable` enforces that public tokens are only minted up to funded public-side collateral capacity. Unshielding is asynchronous: the first transaction burns and exposes the actual burned amount handle for KMS public decryption, and `finalizeUnshield` mints exactly the verified decrypted burn amount.

---

## Deployment Order

After all contracts are written:

```
1. Deploy OptionFactory (confidential) with cWETH address and oracle address; it deploys `ConfidentialCollateralVault`
2. Deploy SeriesPool implementation, call OptionFactory.setPoolImplementation
3. Deploy ConfidentialMatchingEngine, call OptionFactory.setMatchingEngine
4. Deploy PublicOptionFactory with collateral token address (`address(0)` for native ETH, WETH/ERC-20 address otherwise) and oracle address; it deploys `CentralCollateralVault`
5. Deploy UnshieldBridge(confFactory, pubFactory)
6. Call OptionFactory.setBridge(bridge)
7. Call PublicOptionFactory.setBridge(bridge)
8. For each series to support:
   a. OptionFactory.createSeries(strike, maturity)
   b. PublicOptionFactory.createSeries(strike, maturity)
   c. PublicOptionFactory.fundBridgeReserve(strike, maturity, amount) for expected public unshield capacity
   d. UnshieldBridge.authorizeSeries(strike, maturity)
```

---

## What Requires No Contract Changes

- **P as a stablecoin** — `PublicOptionToken` is a standard ERC-20. Users transfer it to Uniswap, Aave, Curve, or any other protocol directly. No protocol involvement needed.
- **Selling P or N publicly** — same as above; standard DEX listing or OTC transfer.
- **Selling P or N confidentially** — already handled by `ConfidentialMatchingEngine` and `SeriesPool`.
