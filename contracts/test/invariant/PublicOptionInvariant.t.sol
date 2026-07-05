// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";

contract PublicOptionInvariantTest is Test {
    address oracle = address(0xA11CE);

    function testPairRedeemsToOneCollateralAcrossPrices(uint256 rawPrice) public {
        uint256 strike = 2_000;
        uint64 maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        uint256 amount = 1_000_000;
        uint256 oraclePrice = bound(rawPrice, 0, 10_000);

        MockEthUsdAggregator feed = new MockEthUsdAggregator(8);
        feed.setRoundData(10, 4_000e8, block.timestamp, block.timestamp, 10);
        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        factory.createSeries(strike, maturityTimestamp);
        factory.split{value: amount}(strike, maturityTimestamp, amount);

        vm.warp(maturityTimestamp + 1);
        vm.prank(oracle);
        factory.settle(strike, maturityTimestamp, oraclePrice);

        uint256 balanceBefore = address(this).balance;
        factory.redeem(strike, maturityTimestamp);
        assertEq(address(this).balance - balanceBefore, amount);
    }

    receive() external payable {}
}
