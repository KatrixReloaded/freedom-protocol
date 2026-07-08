// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OptionFactoryBase} from "../../src/base/OptionFactoryBase.sol";
import {OptionTokenBase} from "../../src/base/OptionTokenBase.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {PublicOptionToken} from "../../src/public/PublicOptionToken.sol";
import {CentralCollateralVault} from "../../src/public/CentralCollateralVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockWETH} from "../mocks/MockWETH.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";

contract PublicOptionFactoryTest is Test {
    address oracle = address(0xA11CE);
    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint64 maturityTimestamp;
    MockEthUsdAggregator feed;
    uint256 constant ONE_OPTION = 1;
    uint256 constant ONE_COLLATERAL = 0.000001 ether;
    uint256 constant TEN_OPTION = 10;
    uint256 constant TEN_COLLATERAL = 0.00001 ether;
    uint256 constant TWENTY_OPTION = 20;
    uint256 constant TWENTY_COLLATERAL = 0.00002 ether;

    event Merge(address indexed user, bytes32 indexed seriesId, uint256 amount, address indexed payoutAsset);
    event Redeemed(address indexed user, bytes32 indexed seriesId, uint256 claim, address indexed payoutAsset);

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
        factory.split{value: TEN_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        assertEq(factory.reserves(id), TEN_COLLATERAL);
        assertEq(PublicOptionToken(stable).balanceOf(user), TEN_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), TEN_OPTION);

        vm.prank(user);
        factory.merge(strike, maturityTimestamp, 4);

        assertEq(factory.reserves(id), 0.000006 ether);
        assertEq(PublicOptionToken(stable).balanceOf(user), 6);
        assertEq(PublicOptionToken(up).balanceOf(user), 6);
    }

    function testEthSplitRejectsWrongMsgValue() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);

        vm.prank(user);
        vm.expectRevert(CentralCollateralVault.CentralCollateralVault__TokenTransferFailed.selector);
        factory.split{value: ONE_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);
    }

    function testErc20FactoryPullsFromVaultAllowance() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        (address stable, address up) = factory.createSeries(strike, maturityTimestamp);

        weth.mint(user, TEN_COLLATERAL);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), TEN_COLLATERAL);
        factory.split(strike, maturityTimestamp, TEN_COLLATERAL);
        vm.stopPrank();

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        assertEq(factory.reserves(id), TEN_COLLATERAL);
        assertEq(weth.balanceOf(address(factory.vault())), TEN_COLLATERAL);
        assertEq(PublicOptionToken(stable).balanceOf(user), TEN_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), TEN_OPTION);
    }

    function testErc20SplitRejectsWrongEthValue() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        weth.mint(user, TEN_COLLATERAL);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), TEN_COLLATERAL);
        vm.expectRevert(CentralCollateralVault.CentralCollateralVault__TokenTransferFailed.selector);
        factory.split{value: ONE_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);
        vm.stopPrank();
    }

    function testWethFactoryAcceptsNativeEthAndWethDeposits() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactoryWithSeries();
        (address stable, address up) = factory.getTokens(strike, maturityTimestamp);

        assertEq(factory.collateralToken(), address(weth));
        assertFalse(factory.vault().isNativeCollateral());

        _splitWithEth(factory, TEN_COLLATERAL);
        _splitWithWeth(weth, factory, TEN_COLLATERAL);

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        assertEq(factory.reserves(id), TWENTY_COLLATERAL);
        assertEq(weth.balanceOf(address(factory.vault())), TWENTY_COLLATERAL);
        assertEq(address(factory.vault()).balance, 0);
        assertEq(PublicOptionToken(stable).balanceOf(user), TWENTY_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), TWENTY_OPTION);
    }

    function testWethFactoryEthDepositRedeemsToEth() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactoryWithSeries();
        _splitWithEth(factory, TEN_COLLATERAL);
        _settle(factory);

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        uint256 ethBefore = user.balance;
        vm.expectEmit(true, true, false, true, address(factory));
        emit Redeemed(user, id, TEN_COLLATERAL, address(0));
        vm.prank(user);
        factory.redeemToEth(strike, maturityTimestamp);

        assertEq(user.balance - ethBefore, TEN_COLLATERAL);
        assertEq(weth.balanceOf(user), 0);
        assertEq(factory.reserves(id), 0);
    }

    function testWethFactoryEthDepositRedeemsToWeth() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactoryWithSeries();
        _splitWithEth(factory, TEN_COLLATERAL);
        _settle(factory);

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        uint256 ethBefore = user.balance;
        vm.expectEmit(true, true, false, true, address(factory));
        emit Redeemed(user, id, TEN_COLLATERAL, address(weth));
        vm.prank(user);
        factory.redeemToWeth(strike, maturityTimestamp);

        assertEq(user.balance, ethBefore);
        assertEq(weth.balanceOf(user), TEN_COLLATERAL);
        assertEq(factory.reserves(id), 0);
    }

    function testWethFactoryWethDepositRedeemsToEth() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactoryWithSeries();
        _splitWithWeth(weth, factory, TEN_COLLATERAL);
        _settle(factory);

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        uint256 ethBefore = user.balance;
        vm.prank(user);
        factory.redeem(strike, maturityTimestamp);

        assertEq(user.balance - ethBefore, TEN_COLLATERAL);
        assertEq(weth.balanceOf(user), 0);
        assertEq(factory.reserves(id), 0);
    }

    function testWethFactoryWethDepositRedeemsToWeth() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactoryWithSeries();
        _splitWithWeth(weth, factory, TEN_COLLATERAL);
        _settle(factory);

        bytes32 id = factory.seriesId(strike, maturityTimestamp);
        uint256 ethBefore = user.balance;
        vm.expectEmit(true, true, false, true, address(factory));
        emit Redeemed(user, id, TEN_COLLATERAL, address(weth));
        vm.prank(user);
        factory.redeemToWeth(strike, maturityTimestamp);

        assertEq(user.balance, ethBefore);
        assertEq(weth.balanceOf(user), TEN_COLLATERAL);
        assertEq(factory.reserves(id), 0);
    }

    function testWethFactoryMergeToEthAndWeth() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactoryWithSeries();
        _splitWithEth(factory, TWENTY_COLLATERAL);
        bytes32 id = factory.seriesId(strike, maturityTimestamp);

        uint256 ethBefore = user.balance;
        vm.expectEmit(true, true, false, true, address(factory));
        emit Merge(user, id, 7, address(0));
        vm.prank(user);
        factory.mergeToEth(strike, maturityTimestamp, 7);
        assertEq(user.balance - ethBefore, 0.000007 ether);

        uint256 wethBefore = weth.balanceOf(user);
        vm.expectEmit(true, true, false, true, address(factory));
        emit Merge(user, id, 3, address(weth));
        vm.prank(user);
        factory.mergeToWeth(strike, maturityTimestamp, 3);
        assertEq(weth.balanceOf(user) - wethBefore, 0.000003 ether);
        assertEq(factory.reserves(id), TEN_COLLATERAL);
    }

    function testWethFactorySplitRejectsIncorrectMsgValueAmountCombinations() public {
        (MockWETH weth, PublicOptionFactory factory) = _deployWethFactoryWithSeries();

        vm.prank(user);
        vm.expectRevert(CentralCollateralVault.CentralCollateralVault__TokenTransferFailed.selector);
        factory.split{value: ONE_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);

        weth.mint(user, TEN_COLLATERAL);
        vm.startPrank(user);
        weth.approve(address(factory.vault()), TEN_COLLATERAL);
        vm.expectRevert(CentralCollateralVault.CentralCollateralVault__TokenTransferFailed.selector);
        factory.split{value: ONE_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);
        vm.stopPrank();
    }

    function testSettleOracleOnlyAndRedeemPairEqualsOneCollateral() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        (address stable, address up) = factory.createSeries(strike, maturityTimestamp);

        vm.prank(user);
        factory.split{value: TEN_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);

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
        assertEq(user.balance - beforeBal, TEN_COLLATERAL);
        assertEq(PublicOptionToken(stable).balanceOf(user), 0);
        assertEq(PublicOptionToken(up).balanceOf(user), 0);
    }

    function testMergeAfterSettlementReverts() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        vm.prank(user);
        factory.split{value: ONE_COLLATERAL}(strike, maturityTimestamp, ONE_COLLATERAL);

        vm.warp(maturityTimestamp + 1);
        vm.prank(oracle);
        factory.settle(strike, maturityTimestamp, 1_000);

        vm.prank(user);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__AlreadySettled.selector);
        factory.merge(strike, maturityTimestamp, ONE_OPTION);
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
            factory.createSeriesAndSplit{value: TEN_COLLATERAL}(strike, maturityTimestamp, TEN_COLLATERAL);

        assertEq(stable, predictedStable);
        assertEq(up, predictedUp);
        assertEq(PublicOptionToken(stable).balanceOf(user), TEN_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), TEN_OPTION);
        assertEq(factory.reserves(factory.seriesId(strike, maturityTimestamp)), TEN_COLLATERAL);
    }

    function testErc20CreateSeriesAndSplitUsesVaultAllowance() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        PublicOptionFactory factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        weth.mint(user, TEN_COLLATERAL);

        vm.startPrank(user);
        weth.approve(address(factory.vault()), TEN_COLLATERAL);
        (address stable, address up) = factory.createSeriesAndSplit(strike, maturityTimestamp, TEN_COLLATERAL);
        vm.stopPrank();

        assertEq(PublicOptionToken(stable).balanceOf(user), TEN_OPTION);
        assertEq(PublicOptionToken(up).balanceOf(user), TEN_OPTION);
        assertEq(weth.balanceOf(address(factory.vault())), TEN_COLLATERAL);
    }

    function testSplitRejectsStrikeAboveHalfCurrentEthPrice() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        uint256 highStrike = 2_050;
        factory.createSeries(highStrike, maturityTimestamp);

        vm.prank(user);
        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__StrikeAboveDepositLimit.selector);
        factory.split{value: TEN_COLLATERAL}(highStrike, maturityTimestamp, TEN_COLLATERAL);
    }

    function testCreateSeriesAndSplitRejectsStrikeAboveHalfCurrentEthPrice() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        uint256 highStrike = 2_050;

        vm.prank(user);
        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__StrikeAboveDepositLimit.selector);
        factory.createSeriesAndSplit{value: TEN_COLLATERAL}(highStrike, maturityTimestamp, TEN_COLLATERAL);
    }

    function _deployWethFactoryWithSeries() internal returns (MockWETH weth, PublicOptionFactory factory) {
        weth = new MockWETH();
        factory = new PublicOptionFactory(address(weth), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
    }

    function _splitWithEth(PublicOptionFactory factory, uint256 amount) internal {
        vm.prank(user);
        factory.split{value: amount}(strike, maturityTimestamp, amount);
    }

    function _splitWithWeth(MockWETH weth, PublicOptionFactory factory, uint256 amount) internal {
        vm.startPrank(user);
        weth.deposit{value: amount}();
        weth.approve(address(factory.vault()), amount);
        factory.split(strike, maturityTimestamp, amount);
        vm.stopPrank();
    }

    function _settle(PublicOptionFactory factory) internal {
        vm.warp(maturityTimestamp + 1);
        vm.prank(oracle);
        factory.settle(strike, maturityTimestamp, 4_000);
    }
}
