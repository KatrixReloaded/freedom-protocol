// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

abstract contract OptionFactoryBase {
    uint64 public constant SCALE = ProtocolConstants.PAYOUT_SCALE;
    uint256 public constant STRIKE_TICK = ProtocolConstants.STRIKE_TICK;

    error OptionFactoryBase__InvalidStrike();
    error OptionFactoryBase__InvalidMaturity();
    error OptionFactoryBase__InvalidEthUsdFeed();
    error OptionFactoryBase__InvalidEthUsdFeedDecimals();
    error OptionFactoryBase__InvalidEthUsdPrice();
    error OptionFactoryBase__InvalidEthUsdTimestamp();
    error OptionFactoryBase__StaleEthUsdPrice();
    error OptionFactoryBase__IncompleteEthUsdRound();
    error OptionFactoryBase__StrikeAboveDepositLimit();

    function seriesId(uint256 strikePrice, uint64 maturityTimestamp) public pure returns (bytes32) {
        return keccak256(abi.encode(strikePrice, maturityTimestamp));
    }

    function _validateStrike(uint256 strikePrice) internal pure {
        if (
            strikePrice == ProtocolConstants.ZERO_UINT256 || strikePrice % STRIKE_TICK != ProtocolConstants.ZERO_UINT256
        ) {
            revert OptionFactoryBase__InvalidStrike();
        }
    }

    function _validateMaturity(uint64 maturityTimestamp) internal view {
        if (
            maturityTimestamp <= block.timestamp
                || maturityTimestamp % ProtocolConstants.POC_MATURITY_INTERVAL != ProtocolConstants.ZERO_UINT256
        ) {
            revert OptionFactoryBase__InvalidMaturity();
        }
    }

    function _validateEthUsdFeed(address ethUsdFeed_) internal view returns (AggregatorV3Interface feed) {
        if (ethUsdFeed_ == ProtocolConstants.ZERO_ADDRESS) revert OptionFactoryBase__InvalidEthUsdFeed();
        feed = AggregatorV3Interface(ethUsdFeed_);
        if (feed.decimals() > ProtocolConstants.MAX_CHAINLINK_FEED_DECIMALS) {
            revert OptionFactoryBase__InvalidEthUsdFeedDecimals();
        }
    }

    function _validateDepositStrike(uint256 strikePrice, AggregatorV3Interface ethUsdFeed, uint256 maxStaleness)
        internal
        view
    {
        uint256 ethPrice = _latestWholeEthUsdPrice(ethUsdFeed, maxStaleness);
        if (strikePrice * ProtocolConstants.BASIS_POINTS > ethPrice * ProtocolConstants.MAX_DEPOSIT_STRIKE_BPS) {
            revert OptionFactoryBase__StrikeAboveDepositLimit();
        }
    }

    function _latestWholeEthUsdPrice(AggregatorV3Interface ethUsdFeed, uint256 maxStaleness)
        internal
        view
        returns (uint256 price)
    {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = ethUsdFeed.latestRoundData();

        if (answer <= 0) revert OptionFactoryBase__InvalidEthUsdPrice();
        if (updatedAt == ProtocolConstants.ZERO_UINT256 || updatedAt > block.timestamp) {
            revert OptionFactoryBase__InvalidEthUsdTimestamp();
        }
        if (block.timestamp - updatedAt > maxStaleness) revert OptionFactoryBase__StaleEthUsdPrice();
        if (answeredInRound < roundId) revert OptionFactoryBase__IncompleteEthUsdRound();

        uint256 scale = ProtocolConstants.DECIMAL_RADIX ** uint256(ethUsdFeed.decimals());
        price = uint256(answer) / scale;
        if (price == ProtocolConstants.ZERO_UINT256) revert OptionFactoryBase__InvalidEthUsdPrice();
    }

    function _computePayouts(uint256 strike, uint256 oraclePrice)
        internal
        pure
        returns (uint64 stablePay, uint64 upPay)
    {
        if (oraclePrice == ProtocolConstants.ZERO_UINT256 || strike >= oraclePrice) {
            stablePay = SCALE;
        } else {
            uint256 raw = (strike * uint256(SCALE)) / oraclePrice;
            stablePay = raw >= SCALE ? SCALE : uint64(raw);
        }
        upPay = SCALE - stablePay;
    }

    function _uint2str(uint256 n) internal pure returns (string memory) {
        if (n == ProtocolConstants.ZERO_UINT256) return ProtocolConstants.ZERO_STRING;
        uint256 tmp = n;
        uint256 digits;
        while (tmp != ProtocolConstants.ZERO_UINT256) {
            digits++;
            tmp /= ProtocolConstants.DECIMAL_RADIX;
        }
        bytes memory buf = new bytes(digits);
        while (n != ProtocolConstants.ZERO_UINT256) {
            digits--;
            buf[digits] = bytes1(uint8(ProtocolConstants.ASCII_ZERO + n % ProtocolConstants.DECIMAL_RADIX));
            n /= ProtocolConstants.DECIMAL_RADIX;
        }
        return string(buf);
    }

    // Implemented differently in each subclass (Series struct differs).
    function getTokens(uint256 strikePrice, uint64 maturityTimestamp)
        external
        view
        virtual
        returns (address stable, address up);

    function isSettled(uint256 strikePrice, uint64 maturityTimestamp) external view virtual returns (bool);
}
