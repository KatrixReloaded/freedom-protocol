// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {PublicOptionToken} from "../../src/public/PublicOptionToken.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";
import {MockWETH} from "../mocks/MockWETH.sol";

contract PublicOptionUnitAccountingTest is Test {
    address oracle = address(0xA11CE);
    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint64 maturityTimestamp;
    MockEthUsdAggregator feed;

    uint256 constant MICRO_OPTION = 1;
    uint256 constant MICRO_COLLATERAL = 0.000001 ether;
    uint256 constant MILLI_OPTION = 1_000;
    uint256 constant MILLI_COLLATERAL = 0.001 ether;
    uint256 constant ONE_OPTION = 1_000_000;
    uint256 constant ONE_COLLATERAL = 1 ether;
    uint256 constant TWO_MILLI_COLLATERAL = 0.002 ether;

    function setUp() public {
        vm.deal(user, 100 ether);
        maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        feed = new MockEthUsdAggregator(8);
        feed.setRoundData(10, 4_000e8, block.timestamp, block.timestamp, 10);
    }

    function testOneEthDepositMintsOneDisplayedOptionToken() public {
        PublicOptionFactory factory = _deployNativeFactory();
        (address stable, address up) = factory.getTokens(strike, maturityTimestamp);

        _splitWithEth(factory, ONE_COLLATERAL);

        assertEq(PublicOptionToken(stable).balanceOf(user), ONE_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), ONE_OPTION);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), ONE_COLLATERAL);
    }

    function testOneWethDepositMintsOneDisplayedOptionToken() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactory();
        (address stable, address up) = factory.getTokens(strike, maturityTimestamp);

        _splitWithWeth(weth, factory, ONE_COLLATERAL);

        assertEq(PublicOptionToken(stable).balanceOf(user), ONE_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), ONE_OPTION);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), ONE_COLLATERAL);
    }

    function testMilliEthAndWethDepositsMintMilliDisplayedOptionToken() public {
        PublicOptionFactory ethFactory = _deployNativeFactory();
        (address ethStable, address ethUp) = ethFactory.getTokens(strike, maturityTimestamp);

        _splitWithEth(ethFactory, MILLI_COLLATERAL);

        assertEq(PublicOptionToken(ethStable).balanceOf(user), MILLI_OPTION);
        assertEq(PublicOptionToken(ethUp).balanceOf(user), MILLI_OPTION);
        assertEq(ethFactory.reserves(ethFactory.seriesId(strike, maturityTimestamp)), MILLI_COLLATERAL);

        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactory();
        (address stable, address up) = factory.getTokens(strike, maturityTimestamp);

        _splitWithWeth(weth, factory, MILLI_COLLATERAL);

        assertEq(PublicOptionToken(stable).balanceOf(user), MILLI_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), MILLI_OPTION);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), MILLI_COLLATERAL);
    }

    function testMinimumDepositMintsOneRawOptionUnit() public {
        PublicOptionFactory factory = _deployNativeFactory();
        (address stable, address up) = factory.getTokens(strike, maturityTimestamp);

        _splitWithEth(factory, MICRO_COLLATERAL);

        assertEq(PublicOptionToken(stable).balanceOf(user), MICRO_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), MICRO_OPTION);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), MICRO_COLLATERAL);
    }

    function testMergeRawOptionUnitsReturnsExactEthAndWethCollateral() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactory();
        _splitWithEth(factory, TWO_MILLI_COLLATERAL);

        uint256 ethBefore = user.balance;
        vm.prank(user);
        factory.mergeToEth(strike, maturityTimestamp, MILLI_OPTION);
        assertEq(user.balance - ethBefore, MILLI_COLLATERAL);

        uint256 wethBefore = weth.balanceOf(user);
        vm.prank(user);
        factory.mergeToWeth(strike, maturityTimestamp, MILLI_OPTION);
        assertEq(weth.balanceOf(user) - wethBefore, MILLI_COLLATERAL);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), 0);
    }

    function testEthDepositRedeemsToEthAndWeth() public {
        (, PublicOptionFactory ethFactory) = _deployWethFactory();
        (MockWETH weth, PublicOptionFactory wethFactory) = _deployWethFactory();

        _splitWithEth(ethFactory, MILLI_COLLATERAL);
        _splitWithEth(wethFactory, MILLI_COLLATERAL);
        _settle(ethFactory);
        _settle(wethFactory);

        uint256 ethBefore = user.balance;
        vm.prank(user);
        ethFactory.redeemToEth(strike, maturityTimestamp);
        assertEq(user.balance - ethBefore, MILLI_COLLATERAL);

        vm.prank(user);
        wethFactory.redeemToWeth(strike, maturityTimestamp);
        assertEq(weth.balanceOf(user), MILLI_COLLATERAL);
    }

    function testWethDepositRedeemsToEthAndWeth() public {
        (MockWETH weth, PublicOptionFactory ethFactory) = _deployWethFactory();
        (MockWETH wethOut, PublicOptionFactory wethFactory) = _deployWethFactory();

        _splitWithWeth(weth, ethFactory, MILLI_COLLATERAL);
        _splitWithWeth(wethOut, wethFactory, MILLI_COLLATERAL);
        _settle(ethFactory);
        _settle(wethFactory);

        uint256 ethBefore = user.balance;
        vm.prank(user);
        ethFactory.redeemToEth(strike, maturityTimestamp);
        assertEq(user.balance - ethBefore, MILLI_COLLATERAL);

        vm.prank(user);
        wethFactory.redeemToWeth(strike, maturityTimestamp);
        assertEq(wethOut.balanceOf(user), MILLI_COLLATERAL);
    }

    function testRedeemingSplitSidesReturnsOriginalCollateralByPayoutRates() public {
        address stableHolder = address(0x5100);
        address upHolder = address(0x5200);
        PublicOptionFactory factory = _deployNativeFactory();
        (address stable, address up) = factory.getTokens(strike, maturityTimestamp);

        vm.startPrank(user);
        factory.split{value: MILLI_COLLATERAL}(strike, maturityTimestamp, MILLI_COLLATERAL);
        PublicOptionToken(stable).transfer(stableHolder, MILLI_OPTION);
        PublicOptionToken(up).transfer(upHolder, MILLI_OPTION);
        vm.stopPrank();

        _settle(factory);

        uint256 stableBefore = stableHolder.balance;
        vm.prank(stableHolder);
        factory.redeemToEth(strike, maturityTimestamp);
        assertEq(stableHolder.balance - stableBefore, 0.0005 ether);

        uint256 upBefore = upHolder.balance;
        vm.prank(upHolder);
        factory.redeemToEth(strike, maturityTimestamp);
        assertEq(upHolder.balance - upBefore, 0.0005 ether);
    }

    function testInvalidCollateralAmountsRevertForEthAndWeth() public {
        PublicOptionFactory nativeFactory = _deployNativeFactory();
        uint256 belowMinimum = 0.0000001 ether;
        uint256 notDivisible = 0.0000015 ether;

        vm.prank(user);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__InvalidCollateralAmount.selector);
        nativeFactory.split{value: belowMinimum}(strike, maturityTimestamp, belowMinimum);

        vm.prank(user);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__InvalidCollateralAmount.selector);
        nativeFactory.split{value: notDivisible}(strike, maturityTimestamp, notDivisible);

        (MockWETH wethBelow, PublicOptionFactory wethBelowFactory) = _deployWethFactory();
        vm.startPrank(user);
        wethBelow.deposit{value: belowMinimum}();
        wethBelow.approve(address(wethBelowFactory.vault()), belowMinimum);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__InvalidCollateralAmount.selector);
        wethBelowFactory.split(strike, maturityTimestamp, belowMinimum);
        vm.stopPrank();

        (MockWETH weth, PublicOptionFactory wethFactory) = _deployWethFactory();
        vm.startPrank(user);
        weth.deposit{value: notDivisible}();
        weth.approve(address(wethFactory.vault()), notDivisible);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__InvalidCollateralAmount.selector);
        wethFactory.split(strike, maturityTimestamp, notDivisible);
        vm.stopPrank();
    }

    function testBridgeMintKeepsRawSixDecimalOptionUnits() public {
        PublicOptionFactory factory = _deployNativeFactory();
        (address stable,) = factory.getTokens(strike, maturityTimestamp);
        address bridge = address(0xB41D6E);
        factory.setBridge(bridge);

        vm.prank(bridge);
        factory.bridgeMint(strike, maturityTimestamp, true, user, 700_000);

        assertEq(PublicOptionToken(stable).balanceOf(user), 700_000);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), 0);
    }

    function _deployNativeFactory() internal returns (PublicOptionFactory factory) {
        factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
    }

    function _deployWethFactory() internal returns (MockWETH weth, PublicOptionFactory factory) {
        weth = new MockWETH();
        factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
    }

    function _splitWithEth(PublicOptionFactory factory, uint256 collateralAmount) internal {
        vm.prank(user);
        factory.split{value: collateralAmount}(strike, maturityTimestamp, collateralAmount);
    }

    function _splitWithWeth(MockWETH weth, PublicOptionFactory factory, uint256 collateralAmount) internal {
        vm.startPrank(user);
        weth.deposit{value: collateralAmount}();
        weth.approve(address(factory.vault()), collateralAmount);
        factory.split(strike, maturityTimestamp, collateralAmount);
        vm.stopPrank();
    }

    function _settle(PublicOptionFactory factory) internal {
        vm.warp(maturityTimestamp + 1);
        vm.prank(oracle);
        factory.settle(strike, maturityTimestamp, 4_000);
    }
}
