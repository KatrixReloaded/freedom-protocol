// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OptionTokenBase} from "../base/OptionTokenBase.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

contract PublicOptionToken is ERC20, OptionTokenBase {
    string private _cloneName;
    string private _cloneSymbol;

    constructor() ERC20("", "") {
        _initializeOptionTokenBase(
            ProtocolConstants.INITIALIZED_IMPLEMENTATION_SENTINEL,
            ProtocolConstants.ZERO_UINT256,
            ProtocolConstants.ZERO_UINT64,
            false
        );
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address factory_,
        uint256 strikePrice_,
        uint64 maturityTimestamp_,
        bool isStable_
    ) external {
        _initializeOptionTokenBase(factory_, strikePrice_, maturityTimestamp_, isStable_);
        _cloneName = name_;
        _cloneSymbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return _cloneName;
    }

    function symbol() public view override returns (string memory) {
        return _cloneSymbol;
    }

    function decimals() public pure override returns (uint8) {
        return ProtocolConstants.TOKEN_DECIMALS;
    }

    function mint(address to, uint256 amount) external onlyAuthorized {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyAuthorized {
        _burn(from, amount);
    }
}
