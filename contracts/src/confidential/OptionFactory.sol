// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {OptionToken} from "./OptionToken.sol";
import {SeriesPool} from "./SeriesPool.sol";
import {ConfidentialCollateralVault} from "./ConfidentialCollateralVault.sol";
import {OptionFactoryBase} from "../base/OptionFactoryBase.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Core Freedom Protocol contract.
///
/// Flow:
///   split(strike, maturity, encAmount, proof)
///     -> receives encrypted cWETH from user
///     -> mints equal stableETH + upETH amounts
///
///   merge(strike, maturity, encAmount, proof)
///     -> burns equal stableETH + upETH amounts
///     -> returns cWETH to user
///
///   settle(strike, maturity, oraclePrice)
///     -> callable only after maturity
///     -> sets payout ratios (as encrypted fixed-point per token)
///     -> users redeem via redeem()
///
/// All deposit amounts, token balances, and payouts stay encrypted.
/// Oracle price enters plaintext then is used in FHE computations.

interface IConfidentialWETH {
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64);
    function confidentialBalanceOf(address account) external view returns (euint64);
}

contract OptionFactory is OptionFactoryBase {
    // ── Series registry ────────────────────────────────────────────────────
    struct Series {
        OptionToken stableToken;
        OptionToken upToken;
        uint256 strikePrice;
        uint64 maturityTimestamp;
        bool exists;
        bool settled;
        // Payout per token in SCALE units (encrypted)
        // After settle: stablePayout + upPayout = SCALE
        euint64 stablePayout; // encrypted: min(SCALE, strike * SCALE / oraclePrice)
        euint64 upPayout; // encrypted: SCALE - stablePayout
    }

    mapping(bytes32 => Series) public series;

    // ── Pool clone infrastructure ──────────────────────────────────────────
    address public poolImplementation;
    // seriesId => isStable => pool address
    mapping(bytes32 => mapping(bool => address)) public pools;

    IConfidentialWETH public immutable cWETH;
    address public immutable oracle;
    AggregatorV3Interface public immutable ethUsdFeed;
    uint256 public immutable depositPriceMaxStaleness;
    ConfidentialCollateralVault public immutable vault;
    address public immutable stableTokenImplementation;
    address public immutable upTokenImplementation;

    // Optional matching engine — authorized on all token pairs at creation time
    address public matchingEngine;

    // Bridge contract — authorized to burn tokens for unshielding
    address public bridge;

    event SeriesCreated(
        bytes32 indexed seriesId,
        uint256 indexed strikePrice,
        uint64 indexed maturityTimestamp,
        address stableToken,
        address upToken
    );
    event Split(address indexed user, bytes32 indexed seriesId);
    event Merge(address indexed user, bytes32 indexed seriesId);
    event Settled(bytes32 indexed seriesId, uint256 oraclePrice, uint256 stablePayout, uint256 upPayout);
    event Redeemed(address indexed user, bytes32 indexed seriesId);
    event PoolCreated(
        uint256 indexed strikePrice, uint64 indexed maturityTimestamp, bool indexed isStable, address pool
    );
    event MatchingEngineSet(address indexed engine);
    event BridgeMinted(address indexed user, bytes32 indexed seriesId, bool indexed isStable);

    error OptionFactory__SeriesExists();
    error OptionFactory__SeriesNotFound();
    error OptionFactory__AlreadySettled();
    error OptionFactory__NotYetMatured();
    error OptionFactory__NotSettled();
    error OptionFactory__PoolAlreadyExists();
    error OptionFactory__NoPoolImplementation();
    error OptionFactory__InvalidOracle();
    error OptionFactory__NotOracle();
    error OptionFactory__AlreadySet();
    error OptionFactory__NotBridge();
    error OptionFactory__SenderNotAllowed();
    error OptionFactory__AmountTooLarge();

    constructor(address cWETH_, address oracle_, address ethUsdFeed_, uint256 depositPriceMaxStaleness_) {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        if (oracle_ == ProtocolConstants.ZERO_ADDRESS) revert OptionFactory__InvalidOracle();
        cWETH = IConfidentialWETH(cWETH_);
        oracle = oracle_;
        ethUsdFeed = _validateEthUsdFeed(ethUsdFeed_);
        depositPriceMaxStaleness = depositPriceMaxStaleness_;
        vault = new ConfidentialCollateralVault(cWETH_, address(this));
        stableTokenImplementation = address(new OptionToken());
        upTokenImplementation = address(new OptionToken());
    }

    /// @notice Register the ConfidentialMatchingEngine so it is authorized on every token pair.
    function setMatchingEngine(address cme) external {
        if (matchingEngine != ProtocolConstants.ZERO_ADDRESS) revert OptionFactory__AlreadySet();
        matchingEngine = cme;
        emit MatchingEngineSet(cme);
    }

    function setBridge(address bridge_) external {
        if (bridge != ProtocolConstants.ZERO_ADDRESS) revert OptionFactory__AlreadySet();
        bridge = bridge_;
    }

    /// @notice Authorize the bridge to burn tokens for a specific series.
    ///         Call once per series after deploying the bridge.
    function authorizeBridge(uint256 strikePrice, uint64 maturityTimestamp) external {
        if (msg.sender != bridge) revert OptionFactory__NotBridge();
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert OptionFactory__SeriesNotFound();
        s.stableToken.setAuthorized(bridge, true);
        s.upToken.setAuthorized(bridge, true);
    }

    // ── Series management ──────────────────────────────────────────────────

    /// @notice Deploy a new stableETH/upETH pair for the given (strikePrice, maturityTimestamp).
    function createSeries(uint256 strikePrice, uint64 maturityTimestamp) external returns (address stable, address up) {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        if (series[id].exists) revert OptionFactory__SeriesExists();
        return _createSeries(strikePrice, maturityTimestamp, id);
    }

    function _createSeries(uint256 strikePrice, uint64 maturityTimestamp, bytes32 id)
        internal
        returns (address stable, address up)
    {
        _validateStrike(strikePrice);
        _validateMaturity(maturityTimestamp);

        string memory strikePart = _uint2str(strikePrice);
        string memory matPart = _uint2str(maturityTimestamp);

        stable = Clones.cloneDeterministic(stableTokenImplementation, _tokenSalt(id, true));
        up = Clones.cloneDeterministic(upTokenImplementation, _tokenSalt(id, false));

        OptionToken(stable)
            .initialize(
                string(
                    abi.encodePacked(
                        ProtocolConstants.STABLE_TOKEN_NAME_PREFIX,
                        strikePart,
                        ProtocolConstants.TOKEN_NAME_SEPARATOR,
                        matPart
                    )
                ),
                string(
                    abi.encodePacked(
                        ProtocolConstants.STABLE_TOKEN_SYMBOL_PREFIX,
                        strikePart,
                        ProtocolConstants.TOKEN_NAME_SEPARATOR,
                        matPart
                    )
                ),
                address(this),
                strikePrice,
                maturityTimestamp,
                true
            );
        OptionToken(up)
            .initialize(
                string(
                    abi.encodePacked(
                        ProtocolConstants.UP_TOKEN_NAME_PREFIX,
                        strikePart,
                        ProtocolConstants.TOKEN_NAME_SEPARATOR,
                        matPart
                    )
                ),
                string(
                    abi.encodePacked(
                        ProtocolConstants.UP_TOKEN_NAME_PREFIX,
                        strikePart,
                        ProtocolConstants.TOKEN_NAME_SEPARATOR,
                        matPart
                    )
                ),
                address(this),
                strikePrice,
                maturityTimestamp,
                false
            );

        series[id] = Series({
            stableToken: OptionToken(stable),
            upToken: OptionToken(up),
            strikePrice: strikePrice,
            maturityTimestamp: maturityTimestamp,
            exists: true,
            settled: false,
            stablePayout: FHE.asEuint64(ProtocolConstants.ZERO_UINT64),
            upPayout: FHE.asEuint64(ProtocolConstants.ZERO_UINT64)
        });

        // Authorize matching engine on both tokens so it can escrow and transfer them
        if (matchingEngine != ProtocolConstants.ZERO_ADDRESS) {
            OptionToken(stable).setAuthorized(matchingEngine, true);
            OptionToken(up).setAuthorized(matchingEngine, true);
        }
        if (bridge != ProtocolConstants.ZERO_ADDRESS) {
            OptionToken(stable).setAuthorized(bridge, true);
            OptionToken(up).setAuthorized(bridge, true);
        }

        emit SeriesCreated(id, strikePrice, maturityTimestamp, stable, up);
    }

    function bridgeMint(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, address to, uint256 amount)
        external
    {
        if (msg.sender != bridge) revert OptionFactory__NotBridge();
        if (amount > type(uint64).max) revert OptionFactory__AmountTooLarge();

        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert OptionFactory__SeriesNotFound();

        // forge-lint: disable-next-line(unsafe-typecast)
        euint64 encAmount = FHE.asEuint64(uint64(amount));
        OptionToken token = isStable ? s.stableToken : s.upToken;
        FHE.allow(encAmount, address(token));
        token.mint(to, encAmount);

        emit BridgeMinted(to, id, isStable);
    }

    // ── Split: deposit cWETH → mint stableETH + upETH ─────────────────────

    /// @notice User locks encrypted cWETH and receives equal stableETH + upETH.
    /// @param strikePrice   Strike price (public, defines series).
    /// @param maturityTimestamp 10-minute-aligned maturity timestamp (public, defines series).
    /// @param encAmt   Encrypted cWETH amount (user-encrypted).
    /// @param proof    fhEVM input proof.
    function split(uint256 strikePrice, uint64 maturityTimestamp, externalEuint64 encAmt, bytes calldata proof)
        external
    {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert OptionFactory__SeriesNotFound();
        _validateDepositStrike(strikePrice, ethUsdFeed, depositPriceMaxStaleness);
        _split(id, s, encAmt, proof);
    }

    function createSeriesAndSplit(
        uint256 strikePrice,
        uint64 maturityTimestamp,
        externalEuint64 encAmt,
        bytes calldata proof
    ) external returns (address stableToken, address upToken) {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) {
            (stableToken, upToken) = _createSeries(strikePrice, maturityTimestamp, id);
        } else {
            stableToken = address(s.stableToken);
            upToken = address(s.upToken);
        }
        _validateDepositStrike(strikePrice, ethUsdFeed, depositPriceMaxStaleness);
        _split(id, series[id], encAmt, proof);
    }

    function _split(bytes32 id, Series storage s, externalEuint64 encAmt, bytes calldata proof) internal {
        if (s.settled) revert OptionFactory__AlreadySettled();

        euint64 requestedAmount = FHE.fromExternal(encAmt, proof);
        FHE.allowTransient(requestedAmount, address(vault));

        // Pull encrypted cWETH from user into the central confidential vault.
        euint64 amount = vault.depositReserve(id, msg.sender, requestedAmount);

        // Mint equal encrypted amounts of both tokens
        FHE.allow(amount, address(s.stableToken));
        FHE.allow(amount, address(s.upToken));
        s.stableToken.mint(msg.sender, amount);
        s.upToken.mint(msg.sender, amount);

        emit Split(msg.sender, id);
    }

    // ── Merge: burn stableETH + upETH → reclaim cWETH ────────────────────

    /// @notice User burns equal encrypted amounts of both tokens to reclaim cWETH.
    /// @dev    User must have pre-approved this contract for both tokens.
    function merge(uint256 strikePrice, uint64 maturityTimestamp, euint64 amount) external {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert OptionFactory__SeriesNotFound();
        if (s.settled) revert OptionFactory__AlreadySettled();
        if (!FHE.isSenderAllowed(amount)) revert OptionFactory__SenderNotAllowed();

        // Pull both tokens from user and burn
        s.stableToken.pullFrom(msg.sender, amount);
        s.upToken.pullFrom(msg.sender, amount);
        s.stableToken.burn(address(this), amount);
        s.upToken.burn(address(this), amount);

        // Return cWETH to user
        FHE.allow(amount, address(vault));
        vault.withdrawReserve(id, msg.sender, amount);

        emit Merge(msg.sender, id);
    }

    // ── Settle: oracle resolves price at maturity ─────────────────────────

    /// @notice Called by oracle after maturity to set payout ratios.
    /// @param oraclePrice   ETH price in USD (same units as strike, e.g. 3000 means $3000).
    function settle(uint256 strikePrice, uint64 maturityTimestamp, uint256 oraclePrice) external {
        if (msg.sender != oracle) revert OptionFactory__NotOracle();
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert OptionFactory__SeriesNotFound();
        if (s.settled) revert OptionFactory__AlreadySettled();
        if (block.timestamp < s.maturityTimestamp) revert OptionFactory__NotYetMatured();

        (uint64 stablePay, uint64 upPay) = _computePayouts(strikePrice, oraclePrice);

        s.stablePayout = FHE.asEuint64(stablePay);
        s.upPayout = FHE.asEuint64(upPay);
        FHE.allowThis(s.stablePayout);
        FHE.allowThis(s.upPayout);

        s.settled = true;
        emit Settled(id, oraclePrice, stablePay, upPay);
    }

    // ── Redeem: claim cWETH after settlement ──────────────────────────────

    /// @notice User redeems stableETH and/or upETH for cWETH after settlement.
    /// @dev    Payout = (balance * payoutRate) / SCALE, computed fully in FHE.
    function redeem(uint256 strikePrice, uint64 maturityTimestamp) external {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.settled) revert OptionFactory__NotSettled();

        // Burn each full token-side balance inside the token contract. The balance handles are
        // ACL-allowed to the token contracts, not to this factory.
        euint64 stableBal = s.stableToken.burnBalance(msg.sender);
        euint64 upBal = s.upToken.burnBalance(msg.sender);

        // Compute encrypted payout:
        // stableClaim = stableBal * stablePayout / SCALE
        // upClaim     = upBal     * upPayout     / SCALE
        euint64 stableClaim = FHE.div(FHE.mul(stableBal, s.stablePayout), SCALE);
        euint64 upClaim = FHE.div(FHE.mul(upBal, s.upPayout), SCALE);
        euint64 totalClaim = FHE.add(stableClaim, upClaim);

        FHE.allow(totalClaim, msg.sender);

        // Transfer cWETH to user
        FHE.allow(totalClaim, address(vault));
        vault.withdrawReserve(id, msg.sender, totalClaim);

        emit Redeemed(msg.sender, id);
    }

    // ── Pool management ────────────────────────────────────────────────────

    /// @notice Set the SeriesPool implementation contract for clone deployment.
    function setPoolImplementation(address impl) external {
        poolImplementation = impl;
    }

    /// @notice Deploy a minimal-proxy SeriesPool clone for one token side of a series.
    /// @param isStable  true = stableETH pool, false = upETH pool.
    /// @param quoteToken  The confidential quote token accepted by the pool (e.g. cUSDC).
    /// @param minPricePerToken  Pool-wide minimum price at SCALE=1e6 precision.
    function createPool(
        uint256 strikePrice,
        uint64 maturityTimestamp,
        bool isStable,
        address quoteToken,
        uint64 minPricePerToken
    ) external returns (address pool) {
        if (poolImplementation == ProtocolConstants.ZERO_ADDRESS) {
            revert OptionFactory__NoPoolImplementation();
        }
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert OptionFactory__SeriesNotFound();
        if (pools[id][isStable] != ProtocolConstants.ZERO_ADDRESS) revert OptionFactory__PoolAlreadyExists();

        pool = Clones.clone(poolImplementation);

        OptionToken token = isStable ? s.stableToken : s.upToken;

        SeriesPool(pool)
            .initialize(address(token), quoteToken, strikePrice, s.maturityTimestamp, minPricePerToken, address(this));

        // Grant the clone permission to call mint/burn/pullFrom/authorizedTransfer
        token.setAuthorized(pool, true);

        pools[id][isStable] = pool;
        emit PoolCreated(strikePrice, maturityTimestamp, isStable, pool);
    }

    function getPool(uint256 strikePrice, uint64 maturityTimestamp, bool isStable) external view returns (address) {
        return pools[seriesId(strikePrice, maturityTimestamp)][isStable];
    }

    // ── OptionFactoryBase overrides ────────────────────────────────────────

    function getSeries(uint256 strikePrice, uint64 maturityTimestamp) external view returns (Series memory) {
        return series[seriesId(strikePrice, maturityTimestamp)];
    }

    function getTokens(uint256 strikePrice, uint64 maturityTimestamp)
        external
        view
        override
        returns (address stable, address up)
    {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        return (address(series[id].stableToken), address(series[id].upToken));
    }

    function seriesExists(uint256 strikePrice, uint64 maturityTimestamp) external view returns (bool) {
        return series[seriesId(strikePrice, maturityTimestamp)].exists;
    }

    function isSettled(uint256 strikePrice, uint64 maturityTimestamp) external view override returns (bool) {
        return series[seriesId(strikePrice, maturityTimestamp)].settled;
    }

    function predictTokenAddresses(uint256 strikePrice, uint64 maturityTimestamp)
        external
        view
        returns (address stableToken, address upToken)
    {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        stableToken = Clones.predictDeterministicAddress(stableTokenImplementation, _tokenSalt(id, true), address(this));
        upToken = Clones.predictDeterministicAddress(upTokenImplementation, _tokenSalt(id, false), address(this));
    }

    function _tokenSalt(bytes32 id, bool isStable) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, isStable));
    }
}
