// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

interface ISeriesCreator {
    function createSeries(uint256 strike, uint64 maturity) external returns (address stable, address up);
    function getTokens(uint256 strike, uint64 maturity) external view returns (address stable, address up);
}

contract CreateSeries is Script {
    function run() external returns (address stable, address up) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address factory = vm.envAddress("FACTORY");
        uint256 strike = vm.envUint("STRIKE");
        uint64 maturity = uint64(vm.envUint("MATURITY"));

        vm.startBroadcast(deployerKey);
        (stable, up) = ISeriesCreator(factory).createSeries(strike, maturity);
        vm.stopBroadcast();

        string memory entry = _seriesEntry(factory, strike, maturity, stable, up);
        string memory key = _seriesKey(factory, strike, maturity);
        string memory json = string.concat('{"', key, '":', entry, "}");
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-series.json"));
    }

    function _seriesKey(address factory, uint256 strike, uint64 maturity) internal view returns (string memory) {
        return string.concat(
            vm.toString(block.chainid),
            ":",
            vm.toString(factory),
            ":",
            vm.toString(strike),
            ":",
            vm.toString(uint256(maturity))
        );
    }

    function _seriesEntry(address factory, uint256 strike, uint64 maturity, address stable, address up)
        internal
        view
        returns (string memory)
    {
        return string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"factory":"',
            vm.toString(factory),
            '","strike":',
            vm.toString(strike),
            ',"maturity":',
            vm.toString(uint256(maturity)),
            ',"stableToken":"',
            vm.toString(stable),
            '","upToken":"',
            vm.toString(up),
            '"}'
        );
    }
}

