// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FHE, euint64, externalEuint64} from "fhevm/lib/FHE.sol";
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

contract ConfidentialProtocolTest is Test {
    address constant LOCAL_ACL = 0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D;
    address constant LOCAL_EXECUTOR = 0xe3a9105a3a932253A70F126eb1E3b589C643dD24;
    address constant LOCAL_KMS = 0x901F8942346f7AB3a01F6D7613119Bca447Bb030;

    address oracle = address(0xA11CE);
    address seller = address(0xB0B);
    address buyer = address(0xCAFE);
    uint256 strike = 2_000;
    uint64 maturity;
    bytes proof = "input-proof";

    function setUp() public {
        maturity = uint64(block.timestamp + 7 days);
        _installFheMocks();
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
        factory = new OptionFactory(address(cWETH), oracle);
        (address stableAddr, address upAddr) = factory.createSeries(strike, maturity);
        stable = OptionToken(stableAddr);
        up = OptionToken(upAddr);
    }

    function _split(MockConfidentialToken cWETH, OptionFactory factory, uint64 amount) internal {
        cWETH.mintPlain(seller, amount);
        vm.startPrank(seller);
        cWETH.approve(address(factory.vault()), _ext(amount), proof);
        factory.split(strike, maturity, _ext(amount), proof);
        vm.stopPrank();
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
        factory.merge(strike, maturity, _enc(400_000));
        assertEq(_plain(stable.balanceOf(seller)), 600_000);
        assertEq(_plain(up.balanceOf(seller)), 600_000);
        assertEq(cWETH.plainBalanceOf(seller), 400_000);

        vm.warp(maturity);
        vm.prank(oracle);
        factory.settle(strike, maturity, 4_000);

        (,, bool settled, euint64 stablePayout, euint64 upPayout) = factory.series(factory.seriesId(strike, maturity));
        assertTrue(settled);
        assertEq(_plain(stablePayout), 500_000);
        assertEq(_plain(upPayout), 500_000);
        assertEq(_plain(stablePayout) + _plain(upPayout), factory.SCALE());

        vm.prank(seller);
        factory.redeem(strike, maturity);
        assertEq(_plain(stable.balanceOf(seller)), 0);
        assertEq(_plain(up.balanceOf(seller)), 0);
        assertEq(cWETH.plainBalanceOf(seller), 1_000_000);
    }

    function testSettleIsOracleOnly() public {
        (, OptionFactory factory,,) = _deployFactoryWithSeries();

        vm.warp(maturity);
        vm.expectRevert(OptionFactory.NotOracle.selector);
        factory.settle(strike, maturity, 4_000);
    }

    function testMatchingEngineListingFillAndCancel() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        MockConfidentialToken quote = new MockConfidentialToken("Confidential USD", "cUSD");
        OptionFactory factory = new OptionFactory(address(cWETH), oracle);
        ConfidentialMatchingEngine engine = new ConfidentialMatchingEngine();
        factory.setMatchingEngine(address(engine));
        (address stableAddr,) = factory.createSeries(strike, maturity);
        OptionToken stable = OptionToken(stableAddr);

        _split(cWETH, factory, 1_000);
        quote.mintPlain(buyer, 1_000);

        vm.prank(seller);
        uint256 listingId = engine.createListing(
            stable, IEngineQuoteToken(address(quote)), strike, maturity, _ext(300), _ext(150), proof, proof
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
            stable, IEngineQuoteToken(address(quote)), strike, maturity, _ext(100), _ext(50), proof, proof
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
        address poolAddr = factory.createPool(strike, maturity, true, address(quote), 500_000);
        SeriesPool pool = SeriesPool(poolAddr);

        vm.expectRevert(OptionFactory.PoolAlreadyExists.selector);
        factory.createPool(strike, maturity, true, address(quote), 500_000);

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
}
