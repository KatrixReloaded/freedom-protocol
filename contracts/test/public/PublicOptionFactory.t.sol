// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {PublicOptionToken} from "../../src/public/PublicOptionToken.sol";
import {CentralCollateralVault} from "../../src/public/CentralCollateralVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract PublicOptionFactoryTest is Test {
    address oracle = address(0xA11CE);
    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint64 maturity;

    function setUp() public {
        maturity = uint64(block.timestamp + 7 days);
        vm.deal(user, 100 ether);
    }

    function testEthFactoryUsesNativeVaultAndSplitsMerges() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        (address stable, address up) = factory.createSeries(strike, maturity);

        assertEq(factory.collateralToken(), address(0));
        assertTrue(factory.vault().isNativeCollateral());
        assertEq(PublicOptionToken(stable).decimals(), 6);
        assertEq(PublicOptionToken(up).decimals(), 6);

        vm.prank(user);
        factory.split{value: 1_000_000}(strike, maturity, 1_000_000);

        bytes32 id = factory.seriesId(strike, maturity);
        assertEq(factory.reserves(id), 1_000_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 1_000_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 1_000_000);

        vm.prank(user);
        factory.merge(strike, maturity, 400_000);

        assertEq(factory.reserves(id), 600_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 600_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 600_000);
    }

    function testEthSplitRejectsWrongMsgValue() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        factory.createSeries(strike, maturity);

        vm.prank(user);
        vm.expectRevert(CentralCollateralVault.TokenTransferFailed.selector);
        factory.split{value: 1}(strike, maturity, 2);
    }

    function testErc20FactoryPullsFromVaultAllowance() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 6);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle);
        (address stable, address up) = factory.createSeries(strike, maturity);

        weth.mint(user, 5_000_000);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), 2_000_000);
        factory.split(strike, maturity, 2_000_000);
        vm.stopPrank();

        bytes32 id = factory.seriesId(strike, maturity);
        assertEq(factory.reserves(id), 2_000_000);
        assertEq(weth.balanceOf(address(factory.vault())), 2_000_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 2_000_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 2_000_000);
    }

    function testErc20SplitRejectsEthValue() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 6);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle);
        factory.createSeries(strike, maturity);
        weth.mint(user, 5_000_000);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), 2_000_000);
        vm.expectRevert(CentralCollateralVault.UnsupportedToken.selector);
        factory.split{value: 1}(strike, maturity, 2_000_000);
        vm.stopPrank();
    }

    function testSettleOracleOnlyAndRedeemPairEqualsOneCollateral() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        (address stable, address up) = factory.createSeries(strike, maturity);

        vm.prank(user);
        factory.split{value: 1_000_000}(strike, maturity, 1_000_000);

        vm.expectRevert(PublicOptionFactory.NotOracle.selector);
        factory.settle(strike, maturity, 4_000);

        vm.prank(oracle);
        vm.expectRevert(PublicOptionFactory.NotYetMatured.selector);
        factory.settle(strike, maturity, 4_000);

        vm.warp(maturity);
        vm.prank(oracle);
        factory.settle(strike, maturity, 4_000);

        (,, bool settled, uint256 stablePayout, uint256 upPayout) = factory.series(factory.seriesId(strike, maturity));
        assertTrue(settled);
        assertEq(stablePayout + upPayout, factory.SCALE());
        assertEq(stablePayout, 500_000);
        assertEq(upPayout, 500_000);

        uint256 beforeBal = user.balance;
        vm.prank(user);
        factory.redeem(strike, maturity);
        assertEq(user.balance - beforeBal, 1_000_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 0);
        assertEq(PublicOptionToken(up).balanceOf(user), 0);
    }

    function testMergeAfterSettlementReverts() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        factory.createSeries(strike, maturity);
        vm.prank(user);
        factory.split{value: 100}(strike, maturity, 100);

        vm.warp(maturity);
        vm.prank(oracle);
        factory.settle(strike, maturity, 1_000);

        vm.prank(user);
        vm.expectRevert(PublicOptionFactory.AlreadySettled.selector);
        factory.merge(strike, maturity, 100);
    }

    function testBridgeReserveFundingAndMintCapacity() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        (address stable,) = factory.createSeries(strike, maturity);
        address bridge = address(0xB41D6E);
        factory.setBridge(bridge);

        vm.prank(user);
        factory.fundBridgeReserve{value: 1_000_000}(strike, maturity, 1_000_000);

        bytes32 id = factory.seriesId(strike, maturity);
        assertEq(factory.bridgeMintable(id), 1_000_000);

        vm.prank(bridge);
        factory.bridgeMint(strike, maturity, true, user, 700_000);

        assertEq(factory.bridgeMintable(id), 300_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 700_000);

        vm.prank(bridge);
        vm.expectRevert(PublicOptionFactory.InsufficientBridgeReserve.selector);
        factory.bridgeMint(strike, maturity, true, user, 300_001);
    }
}

