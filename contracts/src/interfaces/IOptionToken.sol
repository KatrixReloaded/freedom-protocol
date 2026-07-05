// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOptionToken {
    function factory() external view returns (address);
    function strike() external view returns (uint256);
    function strikePrice() external view returns (uint256);
    function maturity() external view returns (uint64);
    function maturityTimestamp() external view returns (uint64);
    function isStable() external view returns (bool);
    function authorized(address) external view returns (bool);
    function setAuthorized(address addr, bool enabled) external;
}
