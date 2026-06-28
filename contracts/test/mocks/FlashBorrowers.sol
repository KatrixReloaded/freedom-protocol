// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC3156FlashBorrowerLike} from "../../src/public/CentralCollateralVault.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {MockERC20} from "./MockERC20.sol";

contract RepayingFlashBorrower is IERC3156FlashBorrowerLike {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    receive() external payable {}

    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata)
        external
        returns (bytes32)
    {
        if (token == address(0)) {
            (bool ok,) = payable(msg.sender).call{value: amount + fee}("");
            require(ok);
        } else {
            MockERC20(token).approve(msg.sender, amount + fee);
        }
        return CALLBACK_SUCCESS;
    }
}

contract BadFlashBorrower is IERC3156FlashBorrowerLike {
    receive() external payable {}

    function onFlashLoan(address, address, uint256, uint256, bytes calldata) external pure returns (bytes32) {
        return bytes32(0);
    }
}

contract MutatingFlashBorrower is IERC3156FlashBorrowerLike {
    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    PublicOptionFactory public factory;
    uint256 public strike;
    uint64 public maturity;

    receive() external payable {}

    function configure(PublicOptionFactory factory_, uint256 strike_, uint64 maturity_) external {
        factory = factory_;
        strike = strike_;
        maturity = maturity_;
    }

    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata)
        external
        returns (bytes32)
    {
        if (token == address(0)) {
            try factory.split{value: amount}(strike, maturity, amount) {
                revert("split succeeded");
            } catch {}
            (bool ok,) = payable(msg.sender).call{value: amount + fee}("");
            require(ok);
        } else {
            MockERC20(token).approve(address(factory.vault()), amount);
            try factory.split(strike, maturity, amount) {
                revert("split succeeded");
            } catch {}
            MockERC20(token).approve(msg.sender, amount + fee);
        }
        return CALLBACK_SUCCESS;
    }
}

