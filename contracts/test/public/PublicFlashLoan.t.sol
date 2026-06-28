// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {CentralCollateralVault} from "../../src/public/CentralCollateralVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {RepayingFlashBorrower, BadFlashBorrower, MutatingFlashBorrower} from "../mocks/FlashBorrowers.sol";

contract PublicFlashLoanTest is Test {
    address oracle = address(0xA11CE);
    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint64 maturity;

    function setUp() public {
        maturity = uint64(block.timestamp + 7 days);
        vm.deal(user, 100 ether);
    }

    function testNativeFlashLoanTransfersAndRequiresFee() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        factory.createSeries(strike, maturity);
        vm.prank(user);
        factory.split{value: 1_000_000}(strike, maturity, 1_000_000);

        RepayingFlashBorrower borrower = new RepayingFlashBorrower();
        vm.deal(address(borrower), 10_000);
        uint256 fee = factory.vault().flashFee(address(0), 500_000);

        assertEq(factory.vault().maxFlashLoan(address(0)), 1_000_000);
        assertEq(fee, 250);
        assertTrue(factory.vault().flashLoan(borrower, address(0), 500_000, ""));
        assertEq(address(factory.vault()).balance, 1_000_000 + fee);
    }

    function testErc20FlashLoanTransfersAndPullsRepayment() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 6);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle);
        factory.createSeries(strike, maturity);
        weth.mint(user, 1_000_000);
        vm.startPrank(user);
        weth.approve(address(factory.vault()), 1_000_000);
        factory.split(strike, maturity, 1_000_000);
        vm.stopPrank();

        RepayingFlashBorrower borrower = new RepayingFlashBorrower();
        weth.mint(address(borrower), 10_000);
        uint256 fee = factory.vault().flashFee(address(weth), 500_000);

        assertTrue(factory.vault().flashLoan(borrower, address(weth), 500_000, ""));
        assertEq(weth.balanceOf(address(factory.vault())), 1_000_000 + fee);
    }

    function testBadCallbackReverts() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        factory.createSeries(strike, maturity);
        CentralCollateralVault vault = factory.vault();
        vm.deal(address(vault), 1 ether);
        BadFlashBorrower borrower = new BadFlashBorrower();

        vm.expectRevert(CentralCollateralVault.FlashLoanCallbackFailed.selector);
        vault.flashLoan(borrower, address(0), 1, "");
    }

    function testBorrowerCannotSplitDuringFlashLoan() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        factory.createSeries(strike, maturity);
        vm.prank(user);
        factory.split{value: 1_000_000}(strike, maturity, 1_000_000);

        MutatingFlashBorrower borrower = new MutatingFlashBorrower();
        borrower.configure(factory, strike, maturity);
        vm.deal(address(borrower), 10_000);

        assertTrue(factory.vault().flashLoan(borrower, address(0), 500_000, ""));
        assertEq(factory.reserves(factory.seriesId(strike, maturity)), 1_000_000);
    }
}
