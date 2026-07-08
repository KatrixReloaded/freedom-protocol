// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IWETH is IERC20Like {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IERC3156FlashBorrowerLike {
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32);
}

/// @notice Central ETH/WETH custody for all public option series created by one factory.
/// @dev During flash loans, reserve-changing operations are locked so borrowed vault
///      funds cannot be recycled into option minting or withdrawals before repayment.
contract CentralCollateralVault {
    bytes32 public constant FLASH_CALLBACK_SUCCESS = ProtocolConstants.FLASH_CALLBACK_SUCCESS;
    uint256 public constant FLASH_FEE_BPS = ProtocolConstants.FLASH_FEE_BPS;
    uint256 public constant BPS = ProtocolConstants.BASIS_POINTS;

    address public immutable collateralToken;
    address public immutable factory;
    bool public immutable isNativeCollateral;

    mapping(bytes32 => uint256) public reserves;
    uint256 public totalReserves;

    bool public flashLoanActive;

    event ReserveDeposited(bytes32 indexed seriesId, address indexed from, uint256 amount);
    event ReserveWithdrawn(bytes32 indexed seriesId, address indexed to, uint256 amount, address indexed payoutAsset);
    event FlashLoan(address indexed receiver, address indexed initiator, uint256 amount, uint256 fee);

    error CentralCollateralVault__NotFactory();
    error CentralCollateralVault__TokenTransferFailed();
    error CentralCollateralVault__UnsupportedToken();
    error CentralCollateralVault__FlashLoanReentrancy();
    error CentralCollateralVault__FlashLoanCallbackFailed();
    error CentralCollateralVault__InsufficientLiquidity();

    modifier onlyFactory() {
        if (msg.sender != factory) revert CentralCollateralVault__NotFactory();
        _;
    }

    modifier notDuringFlashLoan() {
        if (flashLoanActive) revert CentralCollateralVault__FlashLoanReentrancy();
        _;
    }

    constructor(address collateralToken_, address factory_) {
        collateralToken = collateralToken_;
        factory = factory_;
        isNativeCollateral = collateralToken_ == ProtocolConstants.ZERO_ADDRESS;
    }

    fallback() external payable {}

    function depositReserve(bytes32 seriesId, address from, uint256 amount)
        external
        payable
        onlyFactory
        notDuringFlashLoan
    {
        if (msg.value != ProtocolConstants.ZERO_UINT256) {
            if (msg.value != amount) revert CentralCollateralVault__TokenTransferFailed();
            if (!isNativeCollateral) {
                IWETH(collateralToken).deposit{value: amount}();
            }
        } else {
            if (isNativeCollateral) revert CentralCollateralVault__TokenTransferFailed();
            if (!IERC20Like(collateralToken).transferFrom(from, address(this), amount)) {
                revert CentralCollateralVault__TokenTransferFailed();
            }
        }
        reserves[seriesId] += amount;
        totalReserves += amount;
        emit ReserveDeposited(seriesId, from, amount);
    }

    function withdrawReserve(bytes32 seriesId, address to, uint256 amount) external onlyFactory notDuringFlashLoan {
        _withdrawReserve(seriesId, to, amount, false);
    }

    function repayFlashLoan() external payable {
        if (!isNativeCollateral || !flashLoanActive) revert CentralCollateralVault__UnsupportedToken();
    }

    function withdrawReserveAsCollateralToken(bytes32 seriesId, address to, uint256 amount)
        external
        onlyFactory
        notDuringFlashLoan
    {
        if (isNativeCollateral) revert CentralCollateralVault__UnsupportedToken();
        _withdrawReserve(seriesId, to, amount, true);
    }

    function _withdrawReserve(bytes32 seriesId, address to, uint256 amount, bool asCollateralToken) internal {
        reserves[seriesId] -= amount;
        totalReserves -= amount;
        address payoutAsset;
        if (asCollateralToken) {
            if (!IERC20Like(collateralToken).transfer(to, amount)) {
                revert CentralCollateralVault__TokenTransferFailed();
            }
            payoutAsset = collateralToken;
        } else {
            payoutAsset = ProtocolConstants.ZERO_ADDRESS;
            if (!isNativeCollateral) {
                IWETH(collateralToken).withdraw(amount);
            }
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert CentralCollateralVault__TokenTransferFailed();
        }
        emit ReserveWithdrawn(seriesId, to, amount, payoutAsset);
    }

    function maxFlashLoan(address token) external view returns (uint256) {
        if (token != collateralToken) return ProtocolConstants.ZERO_UINT256;
        return isNativeCollateral ? address(this).balance : IERC20Like(collateralToken).balanceOf(address(this));
    }

    function flashFee(address token, uint256 amount) public view returns (uint256) {
        if (token != collateralToken) revert CentralCollateralVault__UnsupportedToken();
        return (amount * FLASH_FEE_BPS) / BPS;
    }

    function flashLoan(IERC3156FlashBorrowerLike receiver, address token, uint256 amount, bytes calldata data)
        external
        returns (bool)
    {
        if (token != collateralToken) revert CentralCollateralVault__UnsupportedToken();
        if (flashLoanActive) revert CentralCollateralVault__FlashLoanReentrancy();
        uint256 balanceBefore =
            isNativeCollateral ? address(this).balance : IERC20Like(collateralToken).balanceOf(address(this));
        if (amount > balanceBefore) revert CentralCollateralVault__InsufficientLiquidity();

        uint256 fee = flashFee(token, amount);
        flashLoanActive = true;

        if (isNativeCollateral) {
            (bool ok,) = payable(address(receiver)).call{value: amount}("");
            if (!ok) revert CentralCollateralVault__TokenTransferFailed();
        } else {
            if (!IERC20Like(collateralToken).transfer(address(receiver), amount)) {
                revert CentralCollateralVault__TokenTransferFailed();
            }
        }
        if (receiver.onFlashLoan(msg.sender, token, amount, fee, data) != FLASH_CALLBACK_SUCCESS) {
            revert CentralCollateralVault__FlashLoanCallbackFailed();
        }
        if (isNativeCollateral) {
            if (address(this).balance < balanceBefore + fee) revert CentralCollateralVault__TokenTransferFailed();
        } else {
            if (!IERC20Like(collateralToken).transferFrom(address(receiver), address(this), amount + fee)) {
                revert CentralCollateralVault__TokenTransferFailed();
            }
        }

        flashLoanActive = false;
        emit FlashLoan(address(receiver), msg.sender, amount, fee);
        return true;
    }
}
