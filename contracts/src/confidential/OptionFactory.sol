// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {OptionToken} from "./OptionToken.sol";
import {SeriesPool} from "./SeriesPool.sol";
import {ConfidentialCollateralVault} from "./ConfidentialCollateralVault.sol";
import {OptionFactoryBase} from "../base/OptionFactoryBase.sol";

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
    function transferFrom(address from, address to, externalEuint64 encAmount, bytes calldata proof)
        external
        returns (bool);
    function transfer(address to, euint64 amount) external returns (bool);
    function balanceOf(address account) external view returns (euint64);
}

contract OptionFactory is OptionFactoryBase {
    // ── Series registry ────────────────────────────────────────────────────
    struct Series {
        OptionToken stableToken;
        OptionToken upToken;
        bool settled;
        // Payout per token in SCALE units (encrypted)
        // After settle: stablePayout + upPayout = SCALE
        euint64 stablePayout; // encrypted: min(SCALE, strike * SCALE / oraclePrice)
        euint64 upPayout; // encrypted: SCALE - stablePayout
    }

    // seriesId = keccak256(abi.encodePacked(strike, maturity))
    mapping(bytes32 => Series) public series;

    // ── Pool clone infrastructure ──────────────────────────────────────────
    address public poolImplementation;
    // seriesId => isStable => pool address
    mapping(bytes32 => mapping(bool => address)) public pools;

    IConfidentialWETH public immutable cWETH;
    address public immutable oracle;
    ConfidentialCollateralVault public immutable vault;

    // Optional matching engine — authorized on all token pairs at creation time
    address public matchingEngine;

    // Bridge contract — authorized to burn tokens for unshielding
    address public bridge;

    event SeriesCreated(uint256 indexed strike, uint64 indexed maturity, address stableToken, address upToken);
    event Split(address indexed user, bytes32 indexed seriesId);
    event Merge(address indexed user, bytes32 indexed seriesId);
    event Settled(bytes32 indexed seriesId, uint256 oraclePrice);
    event Redeemed(address indexed user, bytes32 indexed seriesId);
    event PoolCreated(uint256 indexed strike, uint64 indexed maturity, bool indexed isStable, address pool);
    event MatchingEngineSet(address indexed engine);

    error SeriesExists();
    error SeriesNotFound();
    error AlreadySettled();
    error NotYetMatured();
    error NotSettled();
    error PoolAlreadyExists();
    error NoPoolImplementation();
    error InvalidOracle();
    error NotOracle();

    constructor(address cWETH_, address oracle_) {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        if (oracle_ == address(0)) revert InvalidOracle();
        cWETH = IConfidentialWETH(cWETH_);
        oracle = oracle_;
        vault = new ConfidentialCollateralVault(cWETH_, address(this));
    }

    /// @notice Register the ConfidentialMatchingEngine so it is authorized on every token pair.
    function setMatchingEngine(address cme) external {
        require(matchingEngine == address(0), "already set");
        matchingEngine = cme;
        emit MatchingEngineSet(cme);
    }

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

    // ── Series management ──────────────────────────────────────────────────

    /// @notice Deploy a new stableETH/upETH pair for the given (strike, maturity).
    function createSeries(uint256 strike, uint64 maturity) external returns (address stable, address up) {
        bytes32 id = seriesId(strike, maturity);
        if (address(series[id].stableToken) != address(0)) revert SeriesExists();

        string memory strikePart = _uint2str(strike);
        string memory matPart = _uint2str(maturity);

        OptionToken stableToken = new OptionToken(
            string(abi.encodePacked("stableETH-", strikePart, "-", matPart)),
            string(abi.encodePacked("stETH-", strikePart, "-", matPart)),
            address(this),
            strike,
            maturity,
            true
        );
        OptionToken upToken = new OptionToken(
            string(abi.encodePacked("upETH-", strikePart, "-", matPart)),
            string(abi.encodePacked("upETH-", strikePart, "-", matPart)),
            address(this),
            strike,
            maturity,
            false
        );

        series[id] = Series({
            stableToken: stableToken,
            upToken: upToken,
            settled: false,
            stablePayout: FHE.asEuint64(0),
            upPayout: FHE.asEuint64(0)
        });

        // Authorize matching engine on both tokens so it can escrow and transfer them
        if (matchingEngine != address(0)) {
            stableToken.setAuthorized(matchingEngine, true);
            upToken.setAuthorized(matchingEngine, true);
        }

        emit SeriesCreated(strike, maturity, address(stableToken), address(upToken));
        return (address(stableToken), address(upToken));
    }

    // ── Split: deposit cWETH → mint stableETH + upETH ─────────────────────

    /// @notice User locks encrypted cWETH and receives equal stableETH + upETH.
    /// @param strike   Strike price (public, defines series).
    /// @param maturity Unix timestamp of maturity (public, defines series).
    /// @param encAmt   Encrypted cWETH amount (user-encrypted).
    /// @param proof    fhEVM input proof.
    function split(uint256 strike, uint64 maturity, externalEuint64 encAmt, bytes calldata proof) external {
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        if (s.settled) revert AlreadySettled();

        // Pull encrypted cWETH from user into the central confidential vault.
        euint64 amount = vault.depositReserve(id, msg.sender, encAmt, proof);

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
    function merge(uint256 strike, uint64 maturity, euint64 amount) external {
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        if (s.settled) revert AlreadySettled();
        require(FHE.isSenderAllowed(amount));

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
    function settle(uint256 strike, uint64 maturity, uint256 oraclePrice) external {
        if (msg.sender != oracle) revert NotOracle();
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        if (s.settled) revert AlreadySettled();
        if (block.timestamp < maturity) revert NotYetMatured();

        (uint64 stablePay, uint64 upPay) = _computePayouts(strike, oraclePrice);

        s.stablePayout = FHE.asEuint64(stablePay);
        s.upPayout = FHE.asEuint64(upPay);
        FHE.allowThis(s.stablePayout);
        FHE.allowThis(s.upPayout);

        s.settled = true;
        emit Settled(id, oraclePrice);
    }

    // ── Redeem: claim cWETH after settlement ──────────────────────────────

    /// @notice User redeems stableETH and/or upETH for cWETH after settlement.
    /// @dev    Payout = (balance * payoutRate) / SCALE, computed fully in FHE.
    function redeem(uint256 strike, uint64 maturity) external {
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (!s.settled) revert NotSettled();

        // Read user's encrypted balances
        euint64 stableBal = s.stableToken.balanceOf(msg.sender);
        euint64 upBal = s.upToken.balanceOf(msg.sender);

        // Burn the tokens
        s.stableToken.burn(msg.sender, stableBal);
        s.upToken.burn(msg.sender, upBal);

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
    function createPool(uint256 strike, uint64 maturity, bool isStable, address quoteToken, uint64 minPricePerToken)
        external
        returns (address pool)
    {
        if (poolImplementation == address(0)) revert NoPoolImplementation();
        bytes32 id = seriesId(strike, maturity);
        Series storage s = series[id];
        if (address(s.stableToken) == address(0)) revert SeriesNotFound();
        if (pools[id][isStable] != address(0)) revert PoolAlreadyExists();

        pool = Clones.clone(poolImplementation);

        OptionToken token = isStable ? s.stableToken : s.upToken;

        SeriesPool(pool).initialize(address(token), quoteToken, strike, maturity, minPricePerToken, address(this));

        // Grant the clone permission to call mint/burn/pullFrom/authorizedTransfer
        token.setAuthorized(pool, true);

        pools[id][isStable] = pool;
        emit PoolCreated(strike, maturity, isStable, pool);
    }

    function getPool(uint256 strike, uint64 maturity, bool isStable) external view returns (address) {
        return pools[seriesId(strike, maturity)][isStable];
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
