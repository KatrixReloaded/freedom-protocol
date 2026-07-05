// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

interface ISettlementFactory {
    function settle(uint256 strikePrice, uint64 maturityTimestamp, uint256 oraclePrice) external;
}

/// @notice Chainlink ETH/USD settlement adapter.
/// @dev The protocol currently settles against whole USD values. Chainlink feed
///      answers are floored by feed decimals, so 3000_00000000 becomes 3000.
contract ChainlinkEthUsdOracleAdapter {
    AggregatorV3Interface public ethUsdFeed;
    uint256 public maxStaleness;
    address public owner;

    event FeedUpdated(address indexed feed);
    event MaxStalenessUpdated(uint256 maxStaleness);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FactorySettled(
        address indexed factory,
        bytes32 indexed seriesId,
        uint256 indexed strikePrice,
        uint64 maturityTimestamp,
        uint256 oraclePrice,
        uint256 updatedAt
    );

    error ChainlinkEthUsdOracleAdapter__InvalidFeed();
    error ChainlinkEthUsdOracleAdapter__InvalidOwner();
    error ChainlinkEthUsdOracleAdapter__NotOwner();
    error ChainlinkEthUsdOracleAdapter__InvalidFactory();
    error ChainlinkEthUsdOracleAdapter__InvalidAnswer();
    error ChainlinkEthUsdOracleAdapter__IncompleteRound();
    error ChainlinkEthUsdOracleAdapter__StalePrice();
    error ChainlinkEthUsdOracleAdapter__InvalidTimestamp();
    error ChainlinkEthUsdOracleAdapter__InvalidDecimals();

    modifier onlyOwner() {
        if (msg.sender != owner) revert ChainlinkEthUsdOracleAdapter__NotOwner();
        _;
    }

    constructor(address ethUsdFeed_, uint256 maxStaleness_, address owner_) {
        if (owner_ == ProtocolConstants.ZERO_ADDRESS) revert ChainlinkEthUsdOracleAdapter__InvalidOwner();
        owner = owner_;
        emit OwnershipTransferred(ProtocolConstants.ZERO_ADDRESS, owner_);

        _setFeed(ethUsdFeed_);
        _setMaxStaleness(maxStaleness_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == ProtocolConstants.ZERO_ADDRESS) revert ChainlinkEthUsdOracleAdapter__InvalidOwner();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setFeed(address ethUsdFeed_) external onlyOwner {
        _setFeed(ethUsdFeed_);
    }

    function setMaxStaleness(uint256 maxStaleness_) external onlyOwner {
        _setMaxStaleness(maxStaleness_);
    }

    function latestEthUsdPrice() external view returns (uint256 price, uint256 updatedAt) {
        return _latestEthUsdPrice();
    }

    function settle(address factory, uint256 strikePrice, uint64 maturityTimestamp) public {
        if (factory == ProtocolConstants.ZERO_ADDRESS) revert ChainlinkEthUsdOracleAdapter__InvalidFactory();

        (uint256 price, uint256 updatedAt) = _latestEthUsdPrice();
        ISettlementFactory(factory).settle(strikePrice, maturityTimestamp, price);

        bytes32 seriesId = keccak256(abi.encode(strikePrice, maturityTimestamp));
        emit FactorySettled(factory, seriesId, strikePrice, maturityTimestamp, price, updatedAt);
    }

    function settlePublic(address factory, uint256 strikePrice, uint64 maturityTimestamp) external {
        settle(factory, strikePrice, maturityTimestamp);
    }

    function settleConfidential(address factory, uint256 strikePrice, uint64 maturityTimestamp) external {
        settle(factory, strikePrice, maturityTimestamp);
    }

    function _setFeed(address ethUsdFeed_) internal {
        if (ethUsdFeed_ == ProtocolConstants.ZERO_ADDRESS) revert ChainlinkEthUsdOracleAdapter__InvalidFeed();
        AggregatorV3Interface newFeed = AggregatorV3Interface(ethUsdFeed_);
        if (newFeed.decimals() > ProtocolConstants.MAX_CHAINLINK_FEED_DECIMALS) {
            revert ChainlinkEthUsdOracleAdapter__InvalidDecimals();
        }

        ethUsdFeed = newFeed;
        emit FeedUpdated(ethUsdFeed_);
    }

    function _setMaxStaleness(uint256 maxStaleness_) internal {
        maxStaleness = maxStaleness_;
        emit MaxStalenessUpdated(maxStaleness_);
    }

    function _latestEthUsdPrice() internal view returns (uint256 price, uint256 updatedAt) {
        (uint80 roundId, int256 answer,, uint256 feedUpdatedAt, uint80 answeredInRound) = ethUsdFeed.latestRoundData();

        if (answer <= 0) revert ChainlinkEthUsdOracleAdapter__InvalidAnswer();
        if (feedUpdatedAt == ProtocolConstants.ZERO_UINT256) revert ChainlinkEthUsdOracleAdapter__InvalidTimestamp();
        if (feedUpdatedAt > block.timestamp) revert ChainlinkEthUsdOracleAdapter__InvalidTimestamp();
        if (block.timestamp - feedUpdatedAt > maxStaleness) revert ChainlinkEthUsdOracleAdapter__StalePrice();
        if (answeredInRound < roundId) revert ChainlinkEthUsdOracleAdapter__IncompleteRound();

        uint256 scale = ProtocolConstants.DECIMAL_RADIX ** uint256(ethUsdFeed.decimals());
        price = uint256(answer) / scale;
        updatedAt = feedUpdatedAt;
    }
}
