// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {CentralCollateralVault} from "../../src/public/CentralCollateralVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";
import {RepayingFlashBorrower, BadFlashBorrower, MutatingFlashBorrower} from "../mocks/FlashBorrowers.sol";

contract PublicFlashLoanTest is Test {
    address oracle = address(0xA11CE);
    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint256 constant TEN_COLLATERAL = 0.00001 ether;
    uint256 constant FIVE_COLLATERAL = 0.000005 ether;
    uint64 maturityTimestamp;
    MockEthUsdAggregator feed;

    function setUp() public {
        vm.deal(user, 100 ether);
        maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        feed = new MockEthUsdAggregator(8);
        feed.setRoundData(10, 4_000e8, block.timestamp, block.timestamp, 10);
    }

    function testNativeFlashLoanTransfersAndRequiresFee() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        vm.prank(user);
        factory.split{value: TEN_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);

        RepayingFlashBorrower borrower = new RepayingFlashBorrower();
        vm.deal(address(borrower), 0.01 ether);
        uint256 fee = factory.vault().flashFee(address(0), FIVE_COLLATERAL);

        assertEq(factory.vault().maxFlashLoan(address(0)), TEN_COLLATERAL);
        assertTrue(factory.vault().flashLoan(borrower, address(0), FIVE_COLLATERAL, ""));
        assertEq(address(factory.vault()).balance, TEN_COLLATERAL + fee);
    }

    function testErc20FlashLoanTransfersAndPullsRepayment() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        weth.mint(user, TEN_COLLATERAL);
        vm.startPrank(user);
        weth.approve(address(factory.vault()), TEN_COLLATERAL);
        factory.split(strike, maturityTimestamp, TEN_COLLATERAL);
        vm.stopPrank();

        RepayingFlashBorrower borrower = new RepayingFlashBorrower();
        weth.mint(address(borrower), 0.01 ether);
        uint256 fee = factory.vault().flashFee(address(weth), FIVE_COLLATERAL);

        assertTrue(factory.vault().flashLoan(borrower, address(weth), FIVE_COLLATERAL, ""));
        assertEq(weth.balanceOf(address(factory.vault())), TEN_COLLATERAL + fee);
    }

    function testBadCallbackReverts() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        CentralCollateralVault vault = factory.vault();
        vm.deal(address(vault), 1 ether);
        BadFlashBorrower borrower = new BadFlashBorrower();

        vm.expectRevert(CentralCollateralVault.CentralCollateralVault__FlashLoanCallbackFailed.selector);
        vault.flashLoan(borrower, address(0), 1, "");
    }

    function testBorrowerCannotSplitDuringFlashLoan() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        vm.prank(user);
        factory.split{value: TEN_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);

        MutatingFlashBorrower borrower = new MutatingFlashBorrower();
        borrower.configure(factory, strike, maturityTimestamp);
        vm.deal(address(borrower), 0.01 ether);

        assertTrue(factory.vault().flashLoan(borrower, address(0), FIVE_COLLATERAL, ""));
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), TEN_COLLATERAL);
    }
}
