// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

abstract contract OptionTokenBase {
    address public factory;
    uint256 public strikePrice;
    uint64 public maturityTimestamp;
    bool public isStable;
    bool public initialized;

    mapping(address => bool) public authorized;

    error OptionTokenBase__NotAuthorized();
    error OptionTokenBase__AlreadyInitialized();
    error OptionTokenBase__InvalidFactory();

    modifier onlyAuthorized() {
        if (msg.sender != factory && !authorized[msg.sender]) revert OptionTokenBase__NotAuthorized();
        _;
    }

    function _initializeOptionTokenBase(
        address factory_,
        uint256 strikePrice_,
        uint64 maturityTimestamp_,
        bool isStable_
    ) internal {
        if (initialized) revert OptionTokenBase__AlreadyInitialized();
        if (factory_ == ProtocolConstants.ZERO_ADDRESS) revert OptionTokenBase__InvalidFactory();
        factory = factory_;
        strikePrice = strikePrice_;
        maturityTimestamp = maturityTimestamp_;
        isStable = isStable_;
        initialized = true;
    }

    function strike() external view returns (uint256) {
        return strikePrice;
    }

    function maturity() external view returns (uint64) {
        return maturityTimestamp;
    }

    function setAuthorized(address addr, bool enabled) external {
        if (msg.sender != factory) revert OptionTokenBase__NotAuthorized();
        authorized[addr] = enabled;
    }
}
