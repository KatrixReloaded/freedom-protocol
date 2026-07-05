// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {ChainlinkEthUsdOracleAdapter} from "../../src/oracle/ChainlinkEthUsdOracleAdapter.sol";
import {OptionFactory} from "../../src/confidential/OptionFactory.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {LocalFheAclMock, LocalFheExecutorMock, MockConfidentialToken} from "../mocks/LocalFheMocks.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";

contract ChainlinkEthUsdOracleAdapterTest is Test {
    address constant LOCAL_ACL = 0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D;
    address constant LOCAL_EXECUTOR = 0xe3a9105a3a932253A70F126eb1E3b589C643dD24;

    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint64 maturityTimestamp;
    uint256 maxStaleness = 1 days;
    int256 chainlink8DecimalScale = 1e8;
    int256 chainlink18DecimalScale = 1e18;

    MockEthUsdAggregator feed;
    ChainlinkEthUsdOracleAdapter adapter;

    event FeedUpdated(address indexed feed);
    event MaxStalenessUpdated(uint256 maxStaleness);

    function setUp() public {
        vm.etch(LOCAL_ACL, address(new LocalFheAclMock()).code);
        vm.etch(LOCAL_EXECUTOR, address(new LocalFheExecutorMock()).code);

        maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        feed = new MockEthUsdAggregator(8);
        adapter = new ChainlinkEthUsdOracleAdapter(address(feed), maxStaleness, address(this));
    }

    function _plain(euint64 value) internal pure returns (uint64) {
        return uint64(uint256(FHE.toBytes32(value)));
    }

    function _setFreshPrice(uint256 timestamp, int256 answer) internal {
        feed.setRoundData(10, answer, timestamp, timestamp, 10);
    }

    function testLatestEthUsdPriceNormalizesFeedDecimalsToWholeUsd() public {
        uint256 updatedAt = block.timestamp;
        _setFreshPrice(updatedAt, 3_000 * chainlink8DecimalScale);

        (uint256 price, uint256 priceUpdatedAt) = adapter.latestEthUsdPrice();

        assertEq(price, 3_000);
        assertEq(priceUpdatedAt, updatedAt);

        feed.setDecimals(18);
        feed.setRoundData(11, 3_000 * chainlink18DecimalScale, updatedAt, updatedAt, 11);
        (price, priceUpdatedAt) = adapter.latestEthUsdPrice();

        assertEq(price, 3_000);
        assertEq(priceUpdatedAt, updatedAt);

        feed.setDecimals(0);
        feed.setRoundData(12, 3_000, updatedAt, updatedAt, 12);
        (price, priceUpdatedAt) = adapter.latestEthUsdPrice();

        assertEq(price, 3_000);
        assertEq(priceUpdatedAt, updatedAt);
    }

    function testSetFeedValidatesDecimalsAndEmitsEvent() public {
        MockEthUsdAggregator newFeed = new MockEthUsdAggregator(18);

        vm.expectEmit(true, false, false, true, address(adapter));
        emit FeedUpdated(address(newFeed));
        adapter.setFeed(address(newFeed));

        assertEq(address(adapter.ethUsdFeed()), address(newFeed));

        MockEthUsdAggregator invalidFeed = new MockEthUsdAggregator(19);
        vm.expectRevert(ChainlinkEthUsdOracleAdapter.ChainlinkEthUsdOracleAdapter__InvalidDecimals.selector);
        adapter.setFeed(address(invalidFeed));

        vm.expectRevert(ChainlinkEthUsdOracleAdapter.ChainlinkEthUsdOracleAdapter__InvalidDecimals.selector);
        new ChainlinkEthUsdOracleAdapter(address(invalidFeed), maxStaleness, address(this));
    }

    function testSetMaxStalenessEmitsEvent() public {
        uint256 newMaxStaleness = 2 days;

        vm.expectEmit(false, false, false, true, address(adapter));
        emit MaxStalenessUpdated(newMaxStaleness);
        adapter.setMaxStaleness(newMaxStaleness);

        assertEq(adapter.maxStaleness(), newMaxStaleness);
    }

    function testSettlesPublicFactoryThroughAdapter() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), address(adapter), address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);

        vm.warp(maturityTimestamp + 1);
        _setFreshPrice(block.timestamp, 4_000 * chainlink8DecimalScale);

        adapter.settlePublic(address(factory), strike, maturityTimestamp);

        PublicOptionFactory.Series memory series = factory.getSeries(strike, maturityTimestamp);
        assertTrue(series.settled);
        assertEq(series.stablePayout, 500_000);
        assertEq(series.upPayout, 500_000);
    }

    function testSettlesConfidentialFactoryThroughAdapter() public {
        MockConfidentialToken cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        OptionFactory factory = new OptionFactory(address(cWETH), address(adapter), address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);

        vm.warp(maturityTimestamp + 1);
        _setFreshPrice(block.timestamp, 4_000 * chainlink8DecimalScale);

        adapter.settleConfidential(address(factory), strike, maturityTimestamp);

        OptionFactory.Series memory series = factory.getSeries(strike, maturityTimestamp);
        assertTrue(series.settled);
        assertEq(_plain(series.stablePayout), 500_000);
        assertEq(_plain(series.upPayout), 500_000);
    }

    function testDirectUserCallToFactoryStillFails() public {
        PublicOptionFactory factory = new PublicOptionFactory(address(0), address(adapter), address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);

        vm.warp(maturityTimestamp + 1);
        vm.prank(user);
        vm.expectRevert(PublicOptionFactory.PublicOptionFactory__NotOracle.selector);
        factory.settle(strike, maturityTimestamp, 4_000);
    }

    function testRevertsOnStalePrice() public {
        uint256 nowTimestamp = 2_000_000;
        vm.warp(nowTimestamp);
        feed.setRoundData(
            10, 4_000 * chainlink8DecimalScale, nowTimestamp - maxStaleness - 1, nowTimestamp - maxStaleness - 1, 10
        );

        vm.expectRevert(ChainlinkEthUsdOracleAdapter.ChainlinkEthUsdOracleAdapter__StalePrice.selector);
        adapter.latestEthUsdPrice();
    }

    function testRevertsOnZeroOrNegativeAnswer() public {
        _setFreshPrice(block.timestamp, 0);
        vm.expectRevert(ChainlinkEthUsdOracleAdapter.ChainlinkEthUsdOracleAdapter__InvalidAnswer.selector);
        adapter.latestEthUsdPrice();

        _setFreshPrice(block.timestamp, -1);
        vm.expectRevert(ChainlinkEthUsdOracleAdapter.ChainlinkEthUsdOracleAdapter__InvalidAnswer.selector);
        adapter.latestEthUsdPrice();
    }

    function testRevertsOnIncompleteRound() public {
        uint256 updatedAt = block.timestamp;
        feed.setRoundData(11, 4_000 * chainlink8DecimalScale, updatedAt, updatedAt, 10);

        vm.expectRevert(ChainlinkEthUsdOracleAdapter.ChainlinkEthUsdOracleAdapter__IncompleteRound.selector);
        adapter.latestEthUsdPrice();
    }

    function testRevertsOnZeroUpdatedAt() public {
        feed.setRoundData(10, 4_000 * chainlink8DecimalScale, 0, 0, 10);

        vm.expectRevert(ChainlinkEthUsdOracleAdapter.ChainlinkEthUsdOracleAdapter__InvalidTimestamp.selector);
        adapter.latestEthUsdPrice();
    }
}
