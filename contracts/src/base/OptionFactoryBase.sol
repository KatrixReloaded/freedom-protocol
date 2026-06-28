// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract OptionFactoryBase {
    uint64 public constant SCALE = 1_000_000;

    function seriesId(uint256 strike, uint64 maturity) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(strike, maturity));
    }

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
        while (tmp != 0) {
            digits++;
            tmp /= 10;
        }
        bytes memory buf = new bytes(digits);
        while (n != 0) {
            digits--;
            buf[digits] = bytes1(uint8(48 + n % 10));
            n /= 10;
        }
        return string(buf);
    }

    // Implemented differently in each subclass (Series struct differs).
    function getTokens(uint256 strike, uint64 maturity) external view virtual returns (address stable, address up);
    function isSettled(uint256 strike, uint64 maturity) external view virtual returns (bool);
}
