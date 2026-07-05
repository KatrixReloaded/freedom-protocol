// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OptionFactoryBase} from "../../src/base/OptionFactoryBase.sol";
import {OptionTokenBase} from "../../src/base/OptionTokenBase.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {PublicOptionToken} from "../../src/public/PublicOptionToken.sol";
import {CentralCollateralVault} from "../../src/public/CentralCollateralVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";

contract PublicOptionFactoryTest is Test {
    address oracle = address(0xA11CE);
    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint64 maturityTimestamp;
    MockEthUsdAggregator feed;

    function setUp() public {
        vm.deal(user, 100 ether);
        maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        feed = new MockEthUsdAggregator(8);
        feed.setRoundData(10, 4_000e8, block.timestamp, block.timestamp, 10);
    }

    function testEthFactoryUsesNativeVaultAndSplitsMerges() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        (address stable, address up) = factory.createSeries(strike, maturityTimestamp);

        assertEq(factory.collateralToken(), address(0));
        assertTrue(factory.vault().isNativeCollateral());
        assertEq(PublicOptionToken(stable).decimals(), 6);
        assertEq(PublicOptionToken(up).decimals(), 6);

        vm.prank(user);
        factory.split{value: 1_000_000}(strike, maturityTimestamp, 1_000_000);

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        assertEq(factory.reserves(id), 1_000_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 1_000_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 1_000_000);

        vm.prank(user);
        factory.merge(strike, maturityTimestamp, 400_000);

        assertEq(factory.reserves(id), 600_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 600_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 600_000);
    }

    function testEthSplitRejectsWrongMsgValue() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);

        vm.prank(user);
        vm.expectRevert(CentralCollateralVault.CentralCollateralVault__TokenTransferFailed.selector);
        factory.split{value: 1}(strike, maturityTimestamp, 2);
    }

    function testErc20FactoryPullsFromVaultAllowance() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 6);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        (address stable, address up) = factory.createSeries(strike, maturityTimestamp);

        weth.mint(user, 5_000_000);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), 2_000_000);
        factory.split(strike, maturityTimestamp, 2_000_000);
        vm.stopPrank();

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        assertEq(factory.reserves(id), 2_000_000);
        assertEq(weth.balanceOf(address(factory.vault())), 2_000_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 2_000_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 2_000_000);
    }

    function testErc20SplitRejectsEthValue() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 6);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        weth.mint(user, 5_000_000);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), 2_000_000);
        vm.expectRevert(CentralCollateralVault.CentralCollateralVault__UnsupportedToken.selector);
        factory.split{value: 1}(strike, maturityTimestamp, 2_000_000);
        vm.stopPrank();
    }

    function testSettleOracleOnlyAndRedeemPairEqualsOneCollateral() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        (address stable, address up) = factory.createSeries(strike, maturityTimestamp);

        vm.prank(user);
        factory.split{value: 1_000_000}(strike, maturityTimestamp, 1_000_000);

        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__NotOracle.selector);
        factory.settle(strike, maturityTimestamp, 4_000);

        vm.prank(oracle);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__NotYetMatured.selector);
        factory.settle(strike, maturityTimestamp, 4_000);

        vm.warp(maturityTimestamp + 1);
        vm.prank(oracle);
        factory.settle(strike, maturityTimestamp, 4_000);

        PublicOptionFactory.Series memory s = factory.getSeries(strike, maturityTimestamp);
        assertTrue(s.settled);
        assertEq(s.stablePayout + s.upPayout, factory.SCALE());
        assertEq(s.stablePayout, 500_000);
        assertEq(s.upPayout, 500_000);

        uint256 beforeBal = user.balance;
        vm.prank(user);
        factory.redeem(strike, maturityTimestamp);
        assertEq(user.balance - beforeBal, 1_000_000);
        assertEq(PublicOptionToken(stable).balanceOf(user), 0);
        assertEq(PublicOptionToken(up).balanceOf(user), 0);
    }

    function testMergeAfterSettlementReverts() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        vm.prank(user);
        factory.split{value: 100}(strike, maturityTimestamp, 100);

        vm.warp(maturityTimestamp + 1);
        vm.prank(oracle);
        factory.settle(strike, maturityTimestamp, 1_000);

        vm.prank(user);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__AlreadySettled.selector);
        factory.merge(strike, maturityTimestamp, 100);
    }

    function testBridgeMintDoesNotRequireSeparateReserveCapacity() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        (address stable,) = factory.createSeries(strike, maturityTimestamp);
        address bridge = address(0xB41D6E);
        factory.setBridge(bridge);

        vm.prank(bridge);
        factory.bridgeMint(strike, maturityTimestamp, true, user, 700_000);

        assertEq(PublicOptionToken(stable).balanceOf(user), 700_000);
        assertEq(PublicOptionToken(stable).totalSupply(), 700_000);
    }

    function testSeriesIdUsesAbiEncodedStrikeAndMaturityTimestamp() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        assertEq(factory.seriesId(strike, maturityTimestamp), keccak256(abi.encode(strike, maturityTimestamp)));
    }

    function testPredictTokenAddressesMatchDeterministicClones() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        (address predictedStable, address predictedUp) = factory.predictTokenAddresses(strike, maturityTimestamp);

        (address stable, address up) = factory.createSeries(strike, maturityTimestamp);

        assertEq(stable, predictedStable);
        assertEq(up, predictedUp);
        assertTrue(factory.seriesExists(strike, maturityTimestamp));

        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__SeriesExists.selector);
        factory.createSeries(strike, maturityTimestamp);
    }

    function testPublicTokenImplementationsAndClonesCannotBeReinitialized() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        address implementation = factory.stableTokenImplementation();

        vm.expectRevert(OptionTokenBase.OptionTokenBase__AlreadyInitialized.selector);
        PublicOptionToken(implementation).initialize("bad", "BAD", address(this), strike, maturityTimestamp, true);

        (address stable,) = factory.createSeries(strike, maturityTimestamp);

        vm.expectRevert(OptionTokenBase.OptionTokenBase__AlreadyInitialized.selector);
        PublicOptionToken(stable).initialize("again", "AGAIN", address(this), strike, maturityTimestamp, true);
    }

    function testPublicTokenLegacyAliasesReturnStrikeAndMaturityTimestamp() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        (address stable,) = factory.createSeries(strike, maturityTimestamp);

        assertEq(PublicOptionToken(stable).strike(), strike);
        assertEq(PublicOptionToken(stable).strikePrice(), strike);
        assertEq(PublicOptionToken(stable).maturity(), maturityTimestamp);
        assertEq(PublicOptionToken(stable).maturityTimestamp(), maturityTimestamp);
    }

    function testCreateSeriesValidatesStrike() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);

        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__InvalidStrike.selector);
        factory.createSeries(0, maturityTimestamp);

        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__InvalidStrike.selector);
        factory.createSeries(2_025, maturityTimestamp);
    }

    function testCreateSeriesValidatesMaturityTimestamp() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);

        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__InvalidMaturity.selector);
        factory.createSeries(strike, maturityTimestamp + 1);

        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__InvalidMaturity.selector);
        factory.createSeries(strike, uint64(block.timestamp));

        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__InvalidMaturity.selector);
        factory.createSeries(strike, uint64(block.timestamp - 1));
    }

    function testNativeCreateSeriesAndSplitCreatesAndMintsInOneTransaction() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        (address predictedStable, address predictedUp) = factory.predictTokenAddresses(strike, maturityTimestamp);

        vm.prank(user);
        (address stable, address up) =
            factory.createSeriesAndSplit{value: 1_000_000}(strike, maturityTimestamp, 1_000_000);

        assertEq(stable, predictedStable);
        assertEq(up, predictedUp);
        assertEq(PublicOptionToken(stable).balanceOf(user), 1_000_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 1_000_000);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), 1_000_000);
    }

    function testErc20CreateSeriesAndSplitUsesVaultAllowance() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 6);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        weth.mint(user, 2_000_000);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), 2_000_000);
        (address stable, address up) = factory.createSeriesAndSplit(strike, maturityTimestamp, 2_000_000);
        vm.stopPrank();

        assertEq(PublicOptionToken(stable).balanceOf(user), 2_000_000);
        assertEq(PublicOptionToken(up).balanceOf(user), 2_000_000);
        assertEq(weth.balanceOf(address(factory.vault())), 2_000_000);
    }

    function testSplitRejectsStrikeAboveHalfCurrentEthPrice() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        uint256 highStrike = 2_050;
        factory.createSeries(highStrike, maturityTimestamp);

        vm.prank(user);
        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__StrikeAboveDepositLimit.selector);
        factory.split{value: 1_000_000}(highStrike, maturityTimestamp, 1_000_000);
    }

    function testCreateSeriesAndSplitRejectsStrikeAboveHalfCurrentEthPrice() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        uint256 highStrike = 2_050;

        vm.prank(user);
        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__StrikeAboveDepositLimit.selector);
        factory.createSeriesAndSplit{value: 1_000_000}(highStrike, maturityTimestamp, 1_000_000);
    }
}
