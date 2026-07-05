// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOptionFactory {
    function getTokens(uint256 strikePrice, uint64 maturityTimestamp) external view returns (address stable, address up);
    function isSettled(uint256 strikePrice, uint64 maturityTimestamp) external view returns (bool);
    function seriesId(uint256 strikePrice, uint64 maturityTimestamp) external pure returns (bytes32);
}
