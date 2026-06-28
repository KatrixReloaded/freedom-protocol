// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OptionTokenBase} from "../base/OptionTokenBase.sol";

contract PublicOptionToken is ERC20, OptionTokenBase {
    constructor(
        string memory name_,
        string memory symbol_,
        address factory_,
        uint256 strike_,
        uint64 maturity_,
        bool isStable_
    )
        ERC20(name_, symbol_)
        OptionTokenBase(factory_, strike_, maturity_, isStable_)
    {}

    function decimals() public pure override returns (uint8) { return 6; }

    function mint(address to, uint256 amount) external onlyAuthorized {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyAuthorized {
        _burn(from, amount);
    }
}
