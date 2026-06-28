// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "fhevm/lib/FHE.sol";
import {ConfidentialERC20Base} from "./ConfidentialERC20Base.sol";
import {OptionTokenBase} from "../base/OptionTokenBase.sol";

/// @notice A single stableETH or upETH token for one (strike, maturity) series.
/// @dev Factory and registered pools are authorized to call privileged functions.
contract OptionToken is ConfidentialERC20Base, OptionTokenBase {
    constructor(
        string memory name_,
        string memory symbol_,
        address factory_,
        uint256 strike_,
        uint64 maturity_,
        bool isStable_
    )
        ConfidentialERC20Base(name_, symbol_)
        OptionTokenBase(factory_, strike_, maturity_, isStable_)
    {}

    function mint(address to, euint64 amount) external onlyAuthorized {
        _mint(to, amount);
        FHE.allow(amount, msg.sender);
    }

    function burn(address from, euint64 amount) external onlyAuthorized {
        _burn(from, amount);
        FHE.allow(amount, msg.sender);
    }

    /// @notice Pull encrypted tokens from `from` into the caller (factory or pool).
    function pullFrom(address from, euint64 amount) external onlyAuthorized {
        _transferEncrypted(from, msg.sender, amount);
        FHE.allow(_balances[msg.sender], msg.sender);
    }

    /// @notice Transfer from one address to another using an internal handle.
    ///         Used by pools to move tokens between internal addresses (pool → buyer, pool → seller).
    function authorizedTransfer(address from, address to, euint64 amount) external onlyAuthorized {
        require(FHE.isSenderAllowed(amount));
        _transfer(from, to, amount);
        FHE.allow(_balances[to], to);
    }
}
