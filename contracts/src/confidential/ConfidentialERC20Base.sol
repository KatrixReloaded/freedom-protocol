// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, externalEuint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

/// @notice Abstract base for confidential ERC-20 tokens backed by fhEVM.
/// @dev Balances and allowances are stored as encrypted handles (euint64).
abstract contract ConfidentialERC20Base {
    event Transfer(address indexed from, address indexed to);
    event Approval(address indexed owner, address indexed spender);

    euint64 internal _totalSupply;
    string internal _name;
    string internal _symbol;

    mapping(address => euint64) internal _balances;
    mapping(address => mapping(address => euint64)) internal _allowances;

    error ConfidentialERC20Base__SenderNotAllowed();

    constructor(string memory name_, string memory symbol_) {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        _initializeConfidentialERC20(name_, symbol_);
    }

    function _initializeConfidentialERC20(string memory name_, string memory symbol_) internal {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        _name = name_;
        _symbol = symbol_;
        _totalSupply = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);
        FHE.allowThis(_totalSupply);
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public pure returns (uint8) {
        return ProtocolConstants.TOKEN_DECIMALS;
    }

    function totalSupply() public view returns (euint64) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (euint64) {
        return _balances[account];
    }

    function confidentialBalanceOf(address account) public view returns (euint64) {
        return _balances[account];
    }

    function allowance(address owner, address spender) public view returns (euint64) {
        return _allowances[owner][spender];
    }

    // ── User-facing: encrypted input from outside ──────────────────────────

    function approve(address spender, externalEuint64 encAmount, bytes calldata proof) public returns (bool) {
        _approve(msg.sender, spender, FHE.fromExternal(encAmount, proof));
        return true;
    }

    function transfer(address to, externalEuint64 encAmount, bytes calldata proof) public returns (bool) {
        confidentialTransfer(to, FHE.fromExternal(encAmount, proof));
        return true;
    }

    function transferFrom(address from, address to, externalEuint64 encAmount, bytes calldata proof)
        public
        returns (bool)
    {
        confidentialTransferFrom(from, to, FHE.fromExternal(encAmount, proof));
        return true;
    }

    // ── Contract-to-contract: internal handle already in FHE ──────────────

    /// @notice Transfer using an internal euint64 handle (caller must be ACL-allowed on handle).
    function transfer(address to, euint64 amount) public virtual returns (bool) {
        confidentialTransfer(to, amount);
        return true;
    }

    function confidentialTransfer(address to, euint64 amount) public virtual returns (euint64 transferred) {
        if (!FHE.isSenderAllowed(amount)) revert ConfidentialERC20Base__SenderNotAllowed();
        transferred = _transfer(msg.sender, to, amount);
        FHE.allow(transferred, msg.sender);
    }

    function transferFrom(address from, address to, euint64 amount) public virtual returns (bool) {
        confidentialTransferFrom(from, to, amount);
        return true;
    }

    function confidentialTransferFrom(address from, address to, euint64 amount)
        public
        virtual
        returns (euint64 transferred)
    {
        if (!FHE.isSenderAllowed(amount)) revert ConfidentialERC20Base__SenderNotAllowed();
        ebool allowed = _updateAllowance(from, msg.sender, amount);
        transferred = _transfer(from, to, amount, allowed);
        FHE.allow(transferred, msg.sender);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _approve(address owner, address spender, euint64 amount) internal {
        _allowances[owner][spender] = amount;
        FHE.allowThis(amount);
        FHE.allow(amount, owner);
        FHE.allow(amount, spender);
        emit Approval(owner, spender);
    }

    function _updateAllowance(address owner, address spender, euint64 amount) internal returns (ebool) {
        euint64 current = _allowances[owner][spender];
        ebool canSpend = FHE.le(amount, current);
        ebool hasBalance = FHE.le(amount, _balances[owner]);
        ebool ok = FHE.and(canSpend, hasBalance);
        _approve(owner, spender, FHE.select(ok, FHE.sub(current, amount), current));
        return ok;
    }

    function _transfer(address from, address to, euint64 amount) internal returns (euint64 moved) {
        ebool ok = FHE.le(amount, _balances[from]);
        return _transfer(from, to, amount, ok);
    }

    function _transfer(address from, address to, euint64 amount, ebool ok) internal returns (euint64 moved) {
        moved = FHE.select(ok, amount, FHE.asEuint64(ProtocolConstants.ZERO_UINT64));

        euint64 newTo = FHE.add(_balances[to], moved);
        _balances[to] = newTo;
        FHE.allowThis(newTo);
        FHE.allow(newTo, to);

        euint64 newFrom = FHE.sub(_balances[from], moved);
        _balances[from] = newFrom;
        FHE.allowThis(newFrom);
        FHE.allow(newFrom, from);

        emit Transfer(from, to);
    }

    function _mint(address to, euint64 amount) internal {
        euint64 newSupply = FHE.add(_totalSupply, amount);
        _totalSupply = newSupply;
        FHE.allowThis(newSupply);

        euint64 newBal = FHE.add(_balances[to], amount);
        _balances[to] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, to);
    }

    function _burn(address from, euint64 amount) internal returns (euint64 burnAmount) {
        burnAmount = FHE.min(amount, _balances[from]);

        euint64 newSupply = FHE.sub(_totalSupply, burnAmount);
        _totalSupply = newSupply;
        FHE.allowThis(newSupply);

        euint64 newBal = FHE.sub(_balances[from], burnAmount);
        _balances[from] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, from);
    }

    function _transferEncrypted(address from, address to, euint64 amount) internal {
        _transfer(from, to, amount);
    }
}
