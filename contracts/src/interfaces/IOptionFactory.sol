// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOptionFactory {
    function getTokens(uint256 strike, uint64 maturity) external view returns (address stable, address up);
    function isSettled(uint256 strike, uint64 maturity) external view returns (bool);
    function seriesId(uint256 strike, uint64 maturity)  external pure returns (bytes32);
}
