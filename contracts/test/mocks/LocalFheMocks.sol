// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FheType} from "fhevm/lib/FheType.sol";
import {ConfidentialERC20Base} from "../../src/confidential/ConfidentialERC20Base.sol";
import {FHE, euint64} from "fhevm/lib/FHE.sol";

contract LocalFheExecutorMock {
    function _u(bytes32 value) internal pure returns (uint256) {
        return uint256(value);
    }

    function _b(bool value) internal pure returns (bytes32) {
        return bytes32(uint256(value ? 1 : 0));
    }

    function fheAdd(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return bytes32(_u(lhs) + _u(rhs));
    }

    function fheSub(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _u(lhs) > _u(rhs) ? bytes32(_u(lhs) - _u(rhs)) : bytes32(0);
    }

    function fheMul(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return bytes32(_u(lhs) * _u(rhs));
    }

    function fheDiv(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _u(rhs) == 0 ? bytes32(0) : bytes32(_u(lhs) / _u(rhs));
    }

    function fheRem(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _u(rhs) == 0 ? bytes32(0) : bytes32(_u(lhs) % _u(rhs));
    }

    function fheBitAnd(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return lhs & rhs;
    }

    function fheBitOr(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return lhs | rhs;
    }

    function fheBitXor(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return lhs ^ rhs;
    }

    function fheShl(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return bytes32(_u(lhs) << _u(rhs));
    }

    function fheShr(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return bytes32(_u(lhs) >> _u(rhs));
    }

    function fheRotl(bytes32 lhs, bytes32, bytes1) external pure returns (bytes32) {
        return lhs;
    }

    function fheRotr(bytes32 lhs, bytes32, bytes1) external pure returns (bytes32) {
        return lhs;
    }

    function fheEq(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _b(lhs == rhs);
    }

    function fheNe(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _b(lhs != rhs);
    }

    function fheGe(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _b(_u(lhs) >= _u(rhs));
    }

    function fheGt(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _b(_u(lhs) > _u(rhs));
    }

    function fheLe(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _b(_u(lhs) <= _u(rhs));
    }

    function fheLt(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _b(_u(lhs) < _u(rhs));
    }

    function fheMin(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _u(lhs) <= _u(rhs) ? lhs : rhs;
    }

    function fheMax(bytes32 lhs, bytes32 rhs, bytes1) external pure returns (bytes32) {
        return _u(lhs) >= _u(rhs) ? lhs : rhs;
    }

    function fheNeg(bytes32 ct) external pure returns (bytes32) {
        return bytes32(0 - _u(ct));
    }

    function fheNot(bytes32 ct) external pure returns (bytes32) {
        return ~ct;
    }

    function verifyInput(bytes32 inputHandle, address, bytes memory, FheType) external pure returns (bytes32) {
        return inputHandle;
    }

    function cast(bytes32 ct, FheType) external pure returns (bytes32) {
        return ct;
    }

    function trivialEncrypt(uint256 ct, FheType) external pure returns (bytes32) {
        return bytes32(ct);
    }

    function fheIfThenElse(bytes32 control, bytes32 ifTrue, bytes32 ifFalse) external pure returns (bytes32) {
        return _u(control) != 0 ? ifTrue : ifFalse;
    }

    function fheRand(FheType) external pure returns (bytes32) {
        return bytes32(uint256(1));
    }

    function fheRandBounded(uint256 upperBound, FheType) external pure returns (bytes32) {
        return bytes32(uint256(upperBound == 0 ? 0 : 1));
    }

    function fheSum(bytes32[] calldata values, FheType) external pure returns (bytes32 result) {
        uint256 total;
        for (uint256 i = 0; i < values.length; i++) {
            total += _u(values[i]);
        }
        return bytes32(total);
    }

    function fheIsIn(bytes32 value, bytes32[] calldata values, FheType) external pure returns (bytes32) {
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] == value) return _b(true);
        }
        return _b(false);
    }

    function fheMulDiv(bytes32 factor1, bytes32 factor2, bytes32 divisor, bytes1) external pure returns (bytes32) {
        return _u(divisor) == 0 ? bytes32(0) : bytes32((_u(factor1) * _u(factor2)) / _u(divisor));
    }

    function getInputVerifierAddress() external view returns (address) {
        return address(this);
    }
}

contract LocalFheAclMock {
    mapping(bytes32 => bool) public decryptable;

    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool ok, bytes memory result) = address(this).delegatecall(data[i]);
            require(ok);
            results[i] = result;
        }
    }

    function allowTransient(bytes32, address) external pure {}

    function allow(bytes32, address) external pure {}

    function cleanTransientStorage() external pure {}

    function isAllowed(bytes32, address) external pure returns (bool) {
        return true;
    }

    function allowForDecryption(bytes32[] memory handlesList) external {
        for (uint256 i = 0; i < handlesList.length; i++) {
            decryptable[handlesList[i]] = true;
        }
    }

    function isAllowedForDecryption(bytes32 handle) external view returns (bool) {
        return decryptable[handle];
    }

    function persistAllowed(bytes32, address) external pure returns (bool) {
        return true;
    }

    function isAccountDenied(address) external pure returns (bool) {
        return false;
    }

    function delegateForUserDecryption(address, address, uint64) external pure {}

    function revokeDelegationForUserDecryption(address, address) external pure {}

    function getUserDecryptionDelegationExpirationDate(address, address, address) external pure returns (uint64) {
        return 0;
    }

    function isHandleDelegatedForUserDecryption(address, address, address, bytes32) external pure returns (bool) {
        return true;
    }
}

contract LocalKmsVerifierMock {
    bytes public constant VALID_PROOF = "valid";

    function verifyDecryptionEIP712KMSSignatures(
        bytes32[] memory handlesList,
        bytes memory decryptedResult,
        bytes memory decryptionProof
    ) external pure returns (bool) {
        if (keccak256(decryptionProof) != keccak256(VALID_PROOF)) return false;
        if (handlesList.length != 1) return false;
        uint64 clear = abi.decode(decryptedResult, (uint64));
        return clear == uint64(uint256(handlesList[0]));
    }

    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (0x0f, "LocalKMS", "1", block.chainid, address(this), bytes32(0), new uint256[](0));
    }

    function getContextSignersAndThresholdFromExtraData(bytes calldata)
        external
        pure
        returns (address[] memory signers, uint256 threshold)
    {
        signers = new address[](1);
        signers[0] = address(1);
        threshold = 1;
    }
}

contract MockConfidentialToken is ConfidentialERC20Base {
    constructor(string memory name_, string memory symbol_) ConfidentialERC20Base(name_, symbol_) {}

    function mintPlain(address to, uint64 amount) external {
        euint64 encAmount = FHE.asEuint64(amount);
        _mint(to, encAmount);
    }

    function plainBalanceOf(address account) external view returns (uint64) {
        return uint64(uint256(FHE.toBytes32(_balances[account])));
    }
}
