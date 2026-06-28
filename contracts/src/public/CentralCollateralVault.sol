// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC3156FlashBorrowerLike {
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32);
}

/// @notice Central ETH/ERC-20 custody for all public option series created by one factory.
/// @dev During flash loans, reserve-changing operations are locked so borrowed vault
///      funds cannot be recycled into option minting or withdrawals before repayment.
contract CentralCollateralVault {
    bytes32 public constant FLASH_CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");
    uint256 public constant FLASH_FEE_BPS = 5;
    uint256 public constant BPS = 10_000;

    address public immutable collateralToken;
    address public immutable factory;
    bool public immutable isNativeCollateral;

    mapping(bytes32 => uint256) public reserves;
    uint256 public totalReserves;

    bool public flashLoanActive;

    event ReserveDeposited(bytes32 indexed seriesId, address indexed from, uint256 amount);
    event ReserveWithdrawn(bytes32 indexed seriesId, address indexed to, uint256 amount);
    event FlashLoan(address indexed receiver, address indexed initiator, uint256 amount, uint256 fee);

    error NotFactory();
    error TokenTransferFailed();
    error UnsupportedToken();
    error FlashLoanReentrancy();
    error FlashLoanCallbackFailed();
    error InsufficientLiquidity();

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier notDuringFlashLoan() {
        if (flashLoanActive) revert FlashLoanReentrancy();
        _;
    }

    constructor(address collateralToken_, address factory_) {
        collateralToken = collateralToken_;
        factory = factory_;
        isNativeCollateral = collateralToken_ == address(0);
    }

    receive() external payable {
        if (!isNativeCollateral) revert UnsupportedToken();
    }

    function depositReserve(bytes32 seriesId, address from, uint256 amount)
        external
        payable
        onlyFactory
        notDuringFlashLoan
    {
        if (isNativeCollateral) {
            if (msg.value != amount) revert TokenTransferFailed();
        } else {
            if (msg.value != 0) revert UnsupportedToken();
            if (!IERC20Like(collateralToken).transferFrom(from, address(this), amount)) revert TokenTransferFailed();
        }
        reserves[seriesId] += amount;
        totalReserves += amount;
        emit ReserveDeposited(seriesId, from, amount);
    }

    function withdrawReserve(bytes32 seriesId, address to, uint256 amount) external onlyFactory notDuringFlashLoan {
        reserves[seriesId] -= amount;
        totalReserves -= amount;
        if (isNativeCollateral) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TokenTransferFailed();
        } else {
            if (!IERC20Like(collateralToken).transfer(to, amount)) revert TokenTransferFailed();
        }
        emit ReserveWithdrawn(seriesId, to, amount);
    }

    function maxFlashLoan(address token) external view returns (uint256) {
        if (token != collateralToken) return 0;
        return isNativeCollateral ? address(this).balance : IERC20Like(collateralToken).balanceOf(address(this));
    }

    function flashFee(address token, uint256 amount) public view returns (uint256) {
        if (token != collateralToken) revert UnsupportedToken();
        return (amount * FLASH_FEE_BPS) / BPS;
    }

    function flashLoan(IERC3156FlashBorrowerLike receiver, address token, uint256 amount, bytes calldata data)
        external
        returns (bool)
    {
        if (token != collateralToken) revert UnsupportedToken();
        if (flashLoanActive) revert FlashLoanReentrancy();
        uint256 balanceBefore =
            isNativeCollateral ? address(this).balance : IERC20Like(collateralToken).balanceOf(address(this));
        if (amount > balanceBefore) revert InsufficientLiquidity();

        uint256 fee = flashFee(token, amount);
        flashLoanActive = true;

        if (isNativeCollateral) {
            (bool ok,) = payable(address(receiver)).call{value: amount}("");
            if (!ok) revert TokenTransferFailed();
        } else {
            if (!IERC20Like(collateralToken).transfer(address(receiver), amount)) revert TokenTransferFailed();
        }
        if (receiver.onFlashLoan(msg.sender, token, amount, fee, data) != FLASH_CALLBACK_SUCCESS) {
            revert FlashLoanCallbackFailed();
        }
        if (isNativeCollateral) {
            if (address(this).balance < balanceBefore + fee) revert TokenTransferFailed();
        } else {
            if (!IERC20Like(collateralToken).transferFrom(address(receiver), address(this), amount + fee)) {
                revert TokenTransferFailed();
            }
        }

        flashLoanActive = false;
        emit FlashLoan(address(receiver), msg.sender, amount, fee);
        return true;
    }
}
