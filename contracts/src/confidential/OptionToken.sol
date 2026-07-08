// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {ConfidentialERC20Base} from "./ConfidentialERC20Base.sol";
import {OptionTokenBase} from "../base/OptionTokenBase.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

/// @notice A single stableETH or upETH token for one (strike, maturity) series.
/// @dev Factory and registered pools are authorized to call privileged functions.
contract OptionToken is ConfidentialERC20Base, OptionTokenBase {
    error OptionToken__SenderNotAllowed();

    constructor() ConfidentialERC20Base("", "") {
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
        _initializeConfidentialERC20(name_, symbol_);
    }

    function mint(address to, euint64 amount) external onlyAuthorized {
        _mint(to, amount);
        FHE.allow(amount, msg.sender);
    }

    function burn(address from, euint64 amount) external onlyAuthorized returns (euint64 burnAmount) {
        burnAmount = _burn(from, amount);
        FHE.allow(burnAmount, msg.sender);
    }

    /// @notice Burn the full stored encrypted balance for `from`.
    /// @dev The token contract owns ACL access to its stored balance handle, so authorized callers
    ///      do not need to pass a user balance handle across the contract boundary.
    function burnBalance(address from) external onlyAuthorized returns (euint64 burnAmount) {
        burnAmount = _burn(from, _balances[from]);
        FHE.allow(burnAmount, msg.sender);
    }

    /// @notice Pull encrypted tokens from `from` into the caller (factory or pool).
    function pullFrom(address from, euint64 amount) external onlyAuthorized {
        _transferEncrypted(from, msg.sender, amount);
        FHE.allow(_balances[msg.sender], msg.sender);
    }

    /// @notice Transfer from one address to another using an internal handle.
    ///         Used by pools to move tokens between internal addresses (pool → buyer, pool → seller).
    function authorizedTransfer(address from, address to, euint64 amount) external onlyAuthorized {
        if (!FHE.isSenderAllowed(amount)) revert OptionToken__SenderNotAllowed();
        _transfer(from, to, amount);
        FHE.allow(_balances[to], to);
    }
}
