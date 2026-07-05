// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OptionFactoryBase} from "../base/OptionFactoryBase.sol";
import {PublicOptionToken} from "./PublicOptionToken.sol";
import {CentralCollateralVault} from "./CentralCollateralVault.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

contract PublicOptionFactory is OptionFactoryBase {
    struct Series {
        PublicOptionToken stableToken;
        PublicOptionToken upToken;
        uint256 strikePrice;
        uint64 maturityTimestamp;
        bool exists;
        bool settled;
        uint256 stablePayout; // [0, SCALE] plaintext
        uint256 upPayout;
    }

    mapping(bytes32 => Series) public series;

    address public bridge;
    address public immutable oracle;
    AggregatorV3Interface public immutable ethUsdFeed;
    uint256 public immutable depositPriceMaxStaleness;

    address public immutable collateralToken;
    CentralCollateralVault public immutable vault;
    address public immutable stableTokenImplementation;
    address public immutable upTokenImplementation;

    bool private _entered;

    event SeriesCreated(
        bytes32 indexed seriesId,
        uint256 indexed strikePrice,
        uint64 indexed maturityTimestamp,
        address stableToken,
        address upToken
    );
    event Split(address indexed user, bytes32 indexed seriesId, uint256 amount);
    event Merge(address indexed user, bytes32 indexed seriesId, uint256 amount);
    event Settled(bytes32 indexed seriesId, uint256 oraclePrice, uint256 stablePayout, uint256 upPayout);
    event Redeemed(address indexed user, bytes32 indexed seriesId, uint256 claim);
    event BridgeMinted(address indexed user, bytes32 indexed seriesId, bool indexed isStable, uint256 amount);

    error PublicOptionFactory__SeriesExists();
    error PublicOptionFactory__SeriesNotFound();
    error PublicOptionFactory__AlreadySettled();
    error PublicOptionFactory__NotYetMatured();
    error PublicOptionFactory__NotSettled();
    error PublicOptionFactory__InvalidOracle();
    error PublicOptionFactory__NotOracle();
    error PublicOptionFactory__Reentrancy();
    error PublicOptionFactory__AlreadySet();
    error PublicOptionFactory__NotBridge();

    constructor(address collateralToken_, address oracle_, address ethUsdFeed_, uint256 depositPriceMaxStaleness_) {
        if (oracle_ == ProtocolConstants.ZERO_ADDRESS) revert PublicOptionFactory__InvalidOracle();
        collateralToken = collateralToken_;
        oracle = oracle_;
        ethUsdFeed = _validateEthUsdFeed(ethUsdFeed_);
        depositPriceMaxStaleness = depositPriceMaxStaleness_;
        vault = new CentralCollateralVault(collateralToken_, address(this));
        stableTokenImplementation = address(new PublicOptionToken());
        upTokenImplementation = address(new PublicOptionToken());
    }

    modifier nonReentrant() {
        if (_entered) revert PublicOptionFactory__Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function createSeries(uint256 strikePrice, uint64 maturityTimestamp) external returns (address stable, address up) {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        if (series[id].exists) revert PublicOptionFactory__SeriesExists();
        return _createSeries(strikePrice, maturityTimestamp, id);
    }

    function createSeriesAndSplit(uint256 strikePrice, uint64 maturityTimestamp, uint256 amount)
        external
        payable
        nonReentrant
        returns (address stableToken, address upToken)
    {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) {
            (stableToken, upToken) = _createSeries(strikePrice, maturityTimestamp, id);
        } else {
            stableToken = address(s.stableToken);
            upToken = address(s.upToken);
        }
        _validateDepositStrike(strikePrice, ethUsdFeed, depositPriceMaxStaleness);
        _split(id, series[id], amount);
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

        PublicOptionToken(stable)
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
        PublicOptionToken(up)
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
            stableToken: PublicOptionToken(stable),
            upToken: PublicOptionToken(up),
            strikePrice: strikePrice,
            maturityTimestamp: maturityTimestamp,
            exists: true,
            settled: false,
            stablePayout: ProtocolConstants.ZERO_UINT256,
            upPayout: ProtocolConstants.ZERO_UINT256
        });
        if (bridge != ProtocolConstants.ZERO_ADDRESS) {
            PublicOptionToken(stable).setAuthorized(bridge, true);
            PublicOptionToken(up).setAuthorized(bridge, true);
        }
        emit SeriesCreated(id, strikePrice, maturityTimestamp, stable, up);
    }

    function split(uint256 strikePrice, uint64 maturityTimestamp, uint256 amount) external payable nonReentrant {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert PublicOptionFactory__SeriesNotFound();
        _validateDepositStrike(strikePrice, ethUsdFeed, depositPriceMaxStaleness);
        _split(id, s, amount);
    }

    function _split(bytes32 id, Series storage s, uint256 amount) internal {
        if (s.settled) revert PublicOptionFactory__AlreadySettled();

        vault.depositReserve{value: msg.value}(id, msg.sender, amount);
        s.stableToken.mint(msg.sender, amount);
        s.upToken.mint(msg.sender, amount);
        emit Split(msg.sender, id, amount);
    }

    function merge(uint256 strikePrice, uint64 maturityTimestamp, uint256 amount) external nonReentrant {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert PublicOptionFactory__SeriesNotFound();
        if (s.settled) revert PublicOptionFactory__AlreadySettled();

        s.stableToken.burn(msg.sender, amount);
        s.upToken.burn(msg.sender, amount);
        vault.withdrawReserve(id, msg.sender, amount);
        emit Merge(msg.sender, id, amount);
    }

    function settle(uint256 strikePrice, uint64 maturityTimestamp, uint256 oraclePrice) external {
        if (msg.sender != oracle) revert PublicOptionFactory__NotOracle();
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert PublicOptionFactory__SeriesNotFound();
        if (s.settled) revert PublicOptionFactory__AlreadySettled();
        if (block.timestamp < s.maturityTimestamp) revert PublicOptionFactory__NotYetMatured();

        (uint64 stablePay, uint64 upPay) = _computePayouts(strikePrice, oraclePrice);
        s.stablePayout = stablePay;
        s.upPayout = upPay;
        s.settled = true;
        emit Settled(id, oraclePrice, stablePay, upPay);
    }

    function redeem(uint256 strikePrice, uint64 maturityTimestamp) external nonReentrant {
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.settled) revert PublicOptionFactory__NotSettled();

        uint256 stableBal = s.stableToken.balanceOf(msg.sender);
        uint256 upBal = s.upToken.balanceOf(msg.sender);

        s.stableToken.burn(msg.sender, stableBal);
        s.upToken.burn(msg.sender, upBal);

        uint256 claim = (stableBal * s.stablePayout + upBal * s.upPayout) / SCALE;
        vault.withdrawReserve(id, msg.sender, claim);
        emit Redeemed(msg.sender, id, claim);
    }

    // ── Bridge support ─────────────────────────────────────────────────────

    function setBridge(address bridge_) external {
        if (bridge != ProtocolConstants.ZERO_ADDRESS) revert PublicOptionFactory__AlreadySet();
        bridge = bridge_;
    }

    function authorizeBridge(uint256 strikePrice, uint64 maturityTimestamp) external {
        if (msg.sender != bridge) revert PublicOptionFactory__NotBridge();
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert PublicOptionFactory__SeriesNotFound();
        s.stableToken.setAuthorized(bridge, true);
        s.upToken.setAuthorized(bridge, true);
    }

    function bridgeMint(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, address to, uint256 amount)
        external
        nonReentrant
    {
        if (msg.sender != bridge) revert PublicOptionFactory__NotBridge();
        bytes32 id = seriesId(strikePrice, maturityTimestamp);
        Series storage s = series[id];
        if (!s.exists) revert PublicOptionFactory__SeriesNotFound();

        if (isStable) {
            s.stableToken.mint(to, amount);
        } else {
            s.upToken.mint(to, amount);
        }

        emit BridgeMinted(to, id, isStable, amount);
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

    function reserves(bytes32 id) external view returns (uint256) {
        return vault.reserves(id);
    }

    function _tokenSalt(bytes32 id, bool isStable) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, isStable));
    }
}
