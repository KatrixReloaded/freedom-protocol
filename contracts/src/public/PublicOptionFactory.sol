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
