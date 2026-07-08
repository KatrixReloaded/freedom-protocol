// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FHE, euint64, externalEuint64} from "fhevm/lib/FHE.sol";
import {OptionTokenBase} from "../../src/base/OptionTokenBase.sol";
import {OptionFactory} from "../../src/confidential/OptionFactory.sol";
import {OptionToken} from "../../src/confidential/OptionToken.sol";
import {SeriesPool} from "../../src/confidential/SeriesPool.sol";
import {
    ConfidentialMatchingEngine,
    IConfidentialQuoteToken as IEngineQuoteToken
} from "../../src/confidential/ConfidentialMatchingEngine.sol";
import {
    LocalFheExecutorMock,
    LocalFheAclMock,
    LocalKmsVerifierMock,
    MockConfidentialToken
} from "../mocks/LocalFheMocks.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";
import {OptionFactoryBase} from "../../src/base/OptionFactoryBase.sol";

contract ConfidentialProtocolTest is Test {
    address constant LOCAL_ACL = 0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D;
    address constant LOCAL_EXECUTOR = 0xe3a9105a3a932253A70F126eb1E3b589C643dD24;
    address constant LOCAL_KMS = 0x901F8942346f7AB3a01F6D7613119Bca447Bb030;

    address oracle = address(0xA11CE);
    address seller = address(0xB0B);
    address buyer = address(0xCAFE);
    uint256 strike = 2_000;
    uint64 maturityTimestamp;
    bytes proof = "input-proof";
    MockEthUsdAggregator feed;

    function setUp() public {
        _installFheMocks();
        maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        feed = new MockEthUsdAggregator(8);
        feed.setRoundData(10, 4_000e8, block.timestamp, block.timestamp, 10);
    }

    function _installFheMocks() internal {
        vm.etch(LOCAL_ACL, address(new LocalFheAclMock()).code);
        vm.etch(LOCAL_EXECUTOR, address(new LocalFheExecutorMock()).code);
        vm.etch(LOCAL_KMS, address(new LocalKmsVerifierMock()).code);
    }

    function _ext(uint64 value) internal pure returns (externalEuint64) {
        return externalEuint64.wrap(bytes32(uint256(value)));
    }

    function _enc(uint64 value) internal pure returns (euint64) {
        return euint64.wrap(bytes32(uint256(value)));
    }

    function _plain(euint64 value) internal pure returns (uint64) {
        return uint64(uint256(FHE.toBytes32(value)));
    }

    function _deployFactoryWithSeries()
        internal
        returns (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable, OptionToken up)
    {
        cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        (address stableAddr, address upAddr) = factory.createSeries(strike, maturityTimestamp);
        stable = OptionToken(stableAddr);
        up = OptionToken(upAddr);
    }

    function _split(MockConfidentialToken cWETH, OptionFactory factory, uint64 amount) internal {
        cWETH.mintPlain(seller, amount);
        vm.startPrank(seller);
        cWETH.approve(address(factory.vault()), _ext(amount), proof);
        factory.split(strike, maturityTimestamp, _ext(amount), proof);
        vm.stopPrank();
    }

    function _settle(OptionFactory factory, uint256 oraclePrice) internal {
        vm.warp(maturityTimestamp + 1);
        vm.prank(oracle);
        factory.settle(strike, maturityTimestamp, oraclePrice);
    }

    function _deployFactoryWithSeriesAndBridge()
        internal
        returns (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable, OptionToken up, address bridge)
    {
        cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        bridge = address(0xBEEF);
        factory.setBridge(bridge);
        (address stableAddr, address upAddr) = factory.createSeries(strike, maturityTimestamp);
        stable = OptionToken(stableAddr);
        up = OptionToken(upAddr);
    }

    function testConfidentialSplitMergeSettleRedeemPairInvariant() public {
        (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable, OptionToken up) =
            _deployFactoryWithSeries();
        _split(cWETH, factory, 1_000_000);

        assertEq(_plain(stable.totalSupply()), 1_000_000);
        assertEq(_plain(up.totalSupply()), 1_000_000);
        assertEq(_plain(stable.balanceOf(seller)), 1_000_000);
        assertEq(cWETH.plainBalanceOf(address(factory.vault())), 1_000_000);

        vm.prank(seller);
        factory.merge(strike, maturityTimestamp, _enc(400_000));
        assertEq(_plain(stable.balanceOf(seller)), 600_000);
        assertEq(_plain(up.balanceOf(seller)), 600_000);
        assertEq(cWETH.plainBalanceOf(seller), 400_000);

        _settle(factory, 4_000);

        OptionFactory.Series memory s = factory.getSeries(strike, maturityTimestamp);
        assertTrue(s.settled);
        assertEq(_plain(s.stablePayout), 500_000);
        assertEq(_plain(s.upPayout), 500_000);
        assertEq(_plain(s.stablePayout) + _plain(s.upPayout), factory.SCALE());

        vm.prank(seller);
        factory.redeem(strike, maturityTimestamp);
        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(cWETH.plainBalanceOf(seller), 1_000_000);
    }

    function testConfidentialRedeemBurnsTokenSideBalancesWithoutFactoryBalanceAcl() public {
        (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable, OptionToken up) =
            _deployFactoryWithSeries();
        _split(cWETH, factory, 1_000_000);
        _settle(factory, 4_000);

        vm.prank(seller);
        factory.redeem(strike, maturityTimestamp);

        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(_plain(stable.totalSupply()), 0);
        assertEq(_plain(up.totalSupply()), 0);
        assertEq(cWETH.plainBalanceOf(seller), 1_000_000);
    }

    function testConfidentialRedeemHandlesZeroBalances() public {
        (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable, OptionToken up) =
            _deployFactoryWithSeries();
        _settle(factory, 4_000);

        vm.prank(seller);
        factory.redeem(strike, maturityTimestamp);

        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(cWETH.plainBalanceOf(seller), 0);
    }

    function testConfidentialRedeemComputesPayoutFromStableBurnedBalance() public {
        (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable, OptionToken up, address bridge) =
            _deployFactoryWithSeriesAndBridge();
        _split(cWETH, factory, 1_000_000);

        vm.prank(bridge);
        up.burnBalance(seller);
        _settle(factory, 4_000);

        vm.prank(seller);
        factory.redeem(strike, maturityTimestamp);

        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(cWETH.plainBalanceOf(seller), 500_000);
    }

    function testConfidentialRedeemComputesPayoutFromUpBurnedBalance() public {
        (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable, OptionToken up, address bridge) =
            _deployFactoryWithSeriesAndBridge();
        _split(cWETH, factory, 1_000_000);

        vm.prank(bridge);
        stable.burnBalance(seller);
        _settle(factory, 4_000);

        vm.prank(seller);
        factory.redeem(strike, maturityTimestamp);

        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(cWETH.plainBalanceOf(seller), 500_000);
    }

    function testSettleIsOracleOnly() public {
        (, OptionFactory factory,,) = _deployFactoryWithSeries();

        vm.warp(maturityTimestamp + 1);
        vm.expectRevert(OptionFactory.OptionFactory__NotOracle.selector);
        factory.settle(strike, maturityTimestamp, 4_000);
    }

    function testMatchingEngineListingFillAndCancel() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        MockConfidentialToken quote = new MockConfidentialToken("Confidential USD", "cUSD");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        ConfidentialMatchingEngine engine = new ConfidentialMatchingEngine();
        factory.setMatchingEngine(address(engine));
        (address stableAddr,) = factory.createSeries(strike, maturityTimestamp);
        OptionToken stable = OptionToken(stableAddr);

        _split(cWETH, factory, 1_000);
        quote.mintPlain(buyer, 1_000);

        vm.prank(seller);
        uint256 listingId = engine.createListing(
            stable, IEngineQuoteToken(address(quote)), strike, maturityTimestamp, _ext(300), _ext(150), proof, proof
        );

        vm.startPrank(buyer);
        quote.approve(address(engine), _ext(200), proof);
        engine.fill(listingId, _ext(200), _ext(300), proof, proof);
        vm.stopPrank();

        assertEq(_plain(stable.balanceOf(buyer)), 300);
        assertEq(quote.plainBalanceOf(seller), 150);
        (,,,,, bool active) = engine.getListing(listingId);
        assertFalse(active);

        vm.prank(seller);
        uint256 cancelId = engine.createListing(
            stable, IEngineQuoteToken(address(quote)), strike, maturityTimestamp, _ext(100), _ext(50), proof, proof
        );
        vm.prank(seller);
        engine.cancelListing(cancelId);
        (,,,,, bool cancelActive) = engine.getListing(cancelId);
        assertFalse(cancelActive);
    }

    function testSeriesPoolDepositFillWithdrawAndOnePoolPerSide() public {
        (MockConfidentialToken cWETH, OptionFactory factory, OptionToken stable,) = _deployFactoryWithSeries();
        MockConfidentialToken quote = new MockConfidentialToken("Confidential USD", "cUSD");
        _split(cWETH, factory, 1_000);
        quote.mintPlain(buyer, 1_000);

        SeriesPool implementation = new SeriesPool();
        factory.setPoolImplementation(address(implementation));
        address poolAddr = factory.createPool(strike, maturityTimestamp, true, address(quote), 500_000);
        SeriesPool pool = SeriesPool(poolAddr);

        vm.expectRevert(OptionFactory.OptionFactory__PoolAlreadyExists.selector);
        factory.createPool(strike, maturityTimestamp, true, address(quote), 500_000);

        vm.prank(seller);
        pool.deposit(_ext(400), proof);
        assertEq(pool.sellerCount(), 1);
        assertEq(_plain(pool.encPoolBalance()), 400);

        vm.startPrank(buyer);
        quote.approve(poolAddr, _ext(200), proof);
        pool.fill(_ext(200), _ext(400), proof, proof);
        vm.stopPrank();

        assertEq(_plain(stable.balanceOf(buyer)), 400);
        assertEq(_plain(pool.encPoolBalance()), 0);

        vm.prank(seller);
        pool.withdraw();
        assertEq(quote.plainBalanceOf(seller), 200);
    }

    function testConfidentialCreateSeriesAndSplitUsesClientEncryptedInput() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        (address predictedStable, address predictedUp) = factory.predictTokenAddresses(strike, maturityTimestamp);

        cWETH.mintPlain(seller, 1_000);
        vm.startPrank(seller);
        cWETH.approve(address(factory.vault()), _ext(1_000), proof);
        (address stable, address up) = factory.createSeriesAndSplit(strike, maturityTimestamp, _ext(1_000), proof);
        vm.stopPrank();

        assertEq(stable, predictedStable);
        assertEq(up, predictedUp);
        assertEq(_plain(OptionToken(stable).balanceOf(seller)), 1_000);
        assertEq(_plain(OptionToken(up).balanceOf(seller)), 1_000);
        assertEq(cWETH.plainBalanceOf(address(factory.vault())), 1_000);
    }

    function testConfidentialSplitUsesVaultAsCollateralAllowanceSpender() public {
        // Local fhEVM mocks do not verify proof target binding. This test covers the on-chain
        // spender path used after the factory has converted the browser-provided external input.
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        (address stableAddr, address upAddr) = factory.createSeries(strike, maturityTimestamp);
        OptionToken stable = OptionToken(stableAddr);
        OptionToken up = OptionToken(upAddr);
        cWETH.mintPlain(seller, 1_000);

        vm.startPrank(seller);
        cWETH.approve(address(factory), _ext(1_000), proof);
        factory.split(strike, maturityTimestamp, _ext(1_000), proof);
        vm.stopPrank();

        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(cWETH.plainBalanceOf(address(factory.vault())), 0);

        vm.startPrank(seller);
        cWETH.approve(address(factory.vault()), _ext(1_000), proof);
        factory.split(strike, maturityTimestamp, _ext(1_000), proof);
        vm.stopPrank();

        assertEq(_plain(stable.balanceOf(seller)), 1_000);
        assertEq(_plain(up.balanceOf(seller)), 1_000);
        assertEq(cWETH.plainBalanceOf(address(factory.vault())), 1_000);
    }

    function testConfidentialSplitMintsOnlyActualTransferredCollateral() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        (address stableAddr, address upAddr) = factory.createSeries(strike, maturityTimestamp);
        OptionToken stable = OptionToken(stableAddr);
        OptionToken up = OptionToken(upAddr);
        cWETH.mintPlain(seller, 1_000);

        vm.startPrank(seller);
        cWETH.approve(address(factory.vault()), _ext(400), proof);
        factory.split(strike, maturityTimestamp, _ext(1_000), proof);
        vm.stopPrank();

        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(cWETH.plainBalanceOf(address(factory.vault())), 0);
    }

    function testConfidentialPredictAddressesMatchAndRepeatedCreateReverts() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        (address predictedStable, address predictedUp) = factory.predictTokenAddresses(strike, maturityTimestamp);

        (address stable, address up) = factory.createSeries(strike, maturityTimestamp);

        assertEq(stable, predictedStable);
        assertEq(up, predictedUp);
        assertTrue(factory.seriesExists(strike, maturityTimestamp));

        vm.expectRevert(OptionFactory.OptionFactory__SeriesExists.selector);
        factory.createSeries(strike, maturityTimestamp);
    }

    function testConfidentialTokenImplementationsAndClonesCannotBeReinitialized() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        address implementation = factory.stableTokenImplementation();

        vm.expectRevert(OptionTokenBase.OptionTokenBase__AlreadyInitialized.selector);
        OptionToken(implementation).initialize("bad", "BAD", address(this), strike, maturityTimestamp, true);

        (address stable,) = factory.createSeries(strike, maturityTimestamp);

        vm.expectRevert(OptionTokenBase.OptionTokenBase__AlreadyInitialized.selector);
        OptionToken(stable).initialize("again", "AGAIN", address(this), strike, maturityTimestamp, true);
    }

    function testConfidentialTokenLegacyAliasesReturnStrikeAndMaturityTimestamp() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        (address stable,) = factory.createSeries(strike, maturityTimestamp);

        assertEq(OptionToken(stable).strike(), strike);
        assertEq(OptionToken(stable).strikePrice(), strike);
        assertEq(OptionToken(stable).maturity(), maturityTimestamp);
        assertEq(OptionToken(stable).maturityTimestamp(), maturityTimestamp);
    }

    function testConfidentialSplitRejectsStrikeAboveHalfCurrentEthPrice() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        uint256 highStrike = 2_050;
        factory.createSeries(highStrike, maturityTimestamp);
        cWETH.mintPlain(seller, 1_000);

        vm.startPrank(seller);
        cWETH.approve(address(factory.vault()), _ext(1_000), proof);
        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__StrikeAboveDepositLimit.selector);
        factory.split(highStrike, maturityTimestamp, _ext(1_000), proof);
        vm.stopPrank();
    }

    function testConfidentialCreateSeriesAndSplitRejectsStrikeAboveHalfCurrentEthPrice() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle, address(feed), 1 days);
        uint256 highStrike = 2_050;
        cWETH.mintPlain(seller, 1_000);

        vm.startPrank(seller);
        cWETH.approve(address(factory.vault()), _ext(1_000), proof);
        vm.expectRevert(OptionFactoryBase.OptionFactoryBase__StrikeAboveDepositLimit.selector);
        factory.createSeriesAndSplit(highStrike, maturityTimestamp, _ext(1_000), proof);
        vm.stopPrank();
    }
}
