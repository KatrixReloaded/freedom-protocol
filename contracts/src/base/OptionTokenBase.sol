// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract OptionTokenBase {
    address public immutable factory;
    uint256 public immutable strike;
    uint64 public immutable maturity;
    bool public immutable isStable;

    mapping(address => bool) public authorized;

    error NotAuthorized();

    modifier onlyAuthorized() {
        if (msg.sender != factory && !authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(address factory_, uint256 strike_, uint64 maturity_, bool isStable_) {
        factory = factory_;
        strike = strike_;
        maturity = maturity_;
        isStable = isStable_;
    }

    function setAuthorized(address addr, bool enabled) external {
        if (msg.sender != factory) revert NotAuthorized();
        authorized[addr] = enabled;
    }
}
