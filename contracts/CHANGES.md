# Freedom Protocol — Contract Architecture Changes

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
│   ├── PublicOptionToken.sol          ← new
│   └── PublicOptionFactory.sol        ← new
├── confidential/
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

Plaintext mirror of `OptionFactory`. Inherits `OptionFactoryBase` for shared utilities.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OptionFactoryBase} from "../base/OptionFactoryBase.sol";
import {PublicOptionToken} from "./PublicOptionToken.sol";

interface IWETH {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract PublicOptionFactory is OptionFactoryBase {
    struct Series {
        PublicOptionToken stableToken;
        PublicOptionToken upToken;
        bool settled;
        uint256 stablePayout;   // [0, SCALE] plaintext
        uint256 upPayout;
    }

    mapping(bytes32 => Series) public series;
    mapping(bytes32 => uint256) public reserves;

    address public bridge;

    IWETH public immutable WETH;

    event SeriesCreated(uint256 indexed strike, uint64 indexed maturity, address stableToken, address upToken);
    event Split(address indexed user, bytes32 indexed seriesId, uint256 amount);
    event Merge(address indexed user, bytes32 indexed seriesId, uint256 amount);
    event Settled(bytes32 indexed seriesId, uint256 oraclePrice, uint256 stablePayout, uint256 upPayout);
    event Redeemed(address indexed user, bytes32 indexed seriesId, uint256 claim);

    error SeriesExists();
    error SeriesNotFound();
    error AlreadySettled();
    error NotYetMatured();
    error NotSettled();

    constructor(address weth_) {
        WETH = IWETH(weth_);
    }

    function createSeries(uint256 strike, uint64 maturity) external returns (address stable, address up) {
        bytes32 id = seriesId(strike, maturity);
        if (address(series[id].stableToken) != address(0)) revert SeriesExists();

        string memory strikePart = _uint2str(strike);
        string memory matPart    = _uint2str(maturity);

        PublicOptionToken stableToken = new PublicOptionToken(
            string(abi.encodePacked("stableETH-", strikePart, "-", matPart)),
            string(abi.encodePacked("stETH-",     strikePart, "-", matPart)),
            address(this), strike, maturity, true
        );
        PublicOptionToken upToken = new PublicOptionToken(
            string(abi.encodePacked("upETH-", strikePart, "-", matPart)),
            string(abi.encodePacked("upETH-", strikePart, "-", matPart)),
            address(this), strike, maturity, false
        );

        series[id] = Series({ stableToken: stableToken, upToken: upToken, settled: false, stablePayout: 0, upPayout: 0 });
        emit SeriesCreated(strike, maturity, address(stableToken), address(upToken));
        return (address(stableToken), address(upToken));
    }

    function split(uint256 strike, uint64 maturity, uint256 amount) external {
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        if (s.settled) revert AlreadySettled();

        WETH.transferFrom(msg.sender, address(this), amount);
        reserves[id] += amount;
        s.stableToken.mint(msg.sender, amount);
        s.upToken.mint(msg.sender, amount);
        emit Split(msg.sender, id, amount);
    }

    function merge(uint256 strike, uint64 maturity, uint256 amount) external {
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        if (s.settled) revert AlreadySettled();

        s.stableToken.burn(msg.sender, amount);
        s.upToken.burn(msg.sender, amount);
        reserves[id] -= amount;
        WETH.transfer(msg.sender, amount);
        emit Merge(msg.sender, id, amount);
    }

    function settle(uint256 strike, uint64 maturity, uint256 oraclePrice) external {
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        if (s.settled) revert AlreadySettled();
        if (block.timestamp < maturity) revert NotYetMatured();

        (uint64 stablePay, uint64 upPay) = _computePayouts(strike, oraclePrice);
        s.stablePayout = stablePay;
        s.upPayout     = upPay;
        s.settled = true;
        emit Settled(id, oraclePrice, stablePay, upPay);
    }

    function redeem(uint256 strike, uint64 maturity) external {
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (!s.settled) revert NotSettled();

        uint256 stableBal = s.stableToken.balanceOf(msg.sender);
        uint256 upBal     = s.upToken.balanceOf(msg.sender);

        s.stableToken.burn(msg.sender, stableBal);
        s.upToken.burn(msg.sender, upBal);

        uint256 claim = (stableBal * s.stablePayout + upBal * s.upPayout) / SCALE;
        reserves[id] -= claim;
        WETH.transfer(msg.sender, claim);
        emit Redeemed(msg.sender, id, claim);
    }

    // ── Bridge support ─────────────────────────────────────────────────────

    function setBridge(address bridge_) external {
        require(bridge == address(0), "already set");
        bridge = bridge_;
    }

    function authorizeBridge(uint256 strike, uint64 maturity) external {
        require(msg.sender == bridge, "not bridge");
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        s.stableToken.setAuthorized(bridge, true);
        s.upToken.setAuthorized(bridge, true);
    }

    // ── OptionFactoryBase overrides ────────────────────────────────────────

    function getTokens(uint256 strike, uint64 maturity) external view override returns (address stable, address up) {
        bytes32 id = seriesId(strike, maturity);
        return (address(series[id].stableToken), address(series[id].upToken));
    }

    function isSettled(uint256 strike, uint64 maturity) external view override returns (bool) {
        return series[seriesId(strike, maturity)].settled;
    }
}
```

---

## Step 10 — Write `src/bridge/UnshieldBridge.sol`

Burns confidential tokens, mints equivalent public tokens. Amount is plaintext — user accepts their position size is revealed.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {IOptionFactory} from "../interfaces/IOptionFactory.sol";
import {OptionToken} from "../confidential/OptionToken.sol";
import {PublicOptionToken} from "../public/PublicOptionToken.sol";

contract UnshieldBridge {
    IOptionFactory public immutable confidentialFactory;
    IOptionFactory public immutable publicFactory;

    event Unshielded(address indexed user, uint256 indexed strike, uint64 maturity, bool isStable, uint256 amount);

    error SeriesNotFound();

    constructor(address confFactory_, address pubFactory_) {
        confidentialFactory = IOptionFactory(confFactory_);
        publicFactory       = IOptionFactory(pubFactory_);
    }

    /// @notice Burns `amount` confidential tokens, mints equal public tokens.
    ///         Amount is plaintext — user deliberately reveals their position size.
    function unshield(uint256 strike, uint64 maturity, bool isStable, uint256 amount) external {
        (address confStable, address confUp) = confidentialFactory.getTokens(strike, maturity);
        (address pubStable,  address pubUp)  = publicFactory.getTokens(strike, maturity);
        if (confStable == address(0) || pubStable == address(0)) revert SeriesNotFound();

        OptionToken       confToken = OptionToken(isStable       ? confStable : confUp);
        PublicOptionToken pubToken  = PublicOptionToken(isStable ? pubStable  : pubUp);

        euint64 encAmount = FHE.asEuint64(uint64(amount));
        FHE.allow(encAmount, address(confToken));
        confToken.burn(msg.sender, encAmount);

        pubToken.mint(msg.sender, amount);

        emit Unshielded(msg.sender, strike, maturity, isStable, amount);
    }
}
```

**Reserve accounting note:** The bridge burns confidential tokens (backed by `cWETH` in `OptionFactory`) and mints public tokens (which will be redeemed against `WETH` in `PublicOptionFactory`). The two factories hold separate collateral pools. For v1, pre-fund the public factory with WETH equal to expected unshield volume. This is a documented trust assumption to revisit in v2.

---

## Deployment Order

After all contracts are written:

```
1. Deploy OptionFactory (confidential) with cWETH address
2. Deploy SeriesPool implementation, call OptionFactory.setPoolImplementation
3. Deploy ConfidentialMatchingEngine, call OptionFactory.setMatchingEngine
4. Deploy PublicOptionFactory with WETH address
5. Deploy UnshieldBridge(confFactory, pubFactory)
6. Call OptionFactory.setBridge(bridge)
7. Call PublicOptionFactory.setBridge(bridge)
8. For each series to support:
   a. OptionFactory.createSeries(strike, maturity)
   b. PublicOptionFactory.createSeries(strike, maturity)
   c. bridge.authorizeBridge(strike, maturity)  — or call both factory methods directly
```

---

## What Requires No Contract Changes

- **P as a stablecoin** — `PublicOptionToken` is a standard ERC-20. Users transfer it to Uniswap, Aave, Curve, or any other protocol directly. No protocol involvement needed.
- **Selling P or N publicly** — same as above; standard DEX listing or OTC transfer.
- **Selling P or N confidentially** — already handled by `ConfidentialMatchingEngine` and `SeriesPool`.
