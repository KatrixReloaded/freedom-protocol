// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";

contract PublicOptionInvariantTest is Test {
    address oracle = address(0xA11CE);

    function testPairRedeemsToOneCollateralAcrossPrices(uint256 rawPrice) public {
        uint256 strike = 2_000;
        uint64 maturity = uint64(block.timestamp + 1 days);
        uint256 amount = 1_000_000;
        uint256 oraclePrice = bound(rawPrice, 0, 10_000);

        PublicOptionFactory factory = new PublicOptionFactory(address(0), oracle);
        factory.createSeries(strike, maturity);
        factory.split{value: amount}(strike, maturity, amount);

        vm.warp(maturity);
        vm.prank(oracle);
        factory.settle(strike, maturity, oraclePrice);

        uint256 balanceBefore = address(this).balance;
        factory.redeem(strike, maturity);
        assertEq(address(this).balance - balanceBefore, amount);
    }

    receive() external payable {}
}

