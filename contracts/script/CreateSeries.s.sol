// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

interface ISeriesCreator {
    function createSeries(uint256 strikePrice, uint64 maturityTimestamp) external returns (address stable, address up);
    function getTokens(uint256 strikePrice, uint64 maturityTimestamp) external view returns (address stable, address up);
}

contract CreateSeries is Script {
    function run() external returns (address stable, address up) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address factory = vm.envAddress("FACTORY");
        uint256 strike = vm.envUint("STRIKE");
        uint64 maturityTimestamp = uint64(vm.envUint("MATURITY_TIMESTAMP"));

        vm.startBroadcast(deployerKey);
        (stable, up) = ISeriesCreator(factory).createSeries(strike, maturityTimestamp);
        vm.stopBroadcast();

        string memory entry = _seriesEntry(factory, strike, maturityTimestamp, stable, up);
        string memory key = _seriesKey(factory, strike, maturityTimestamp);
        string memory json = string.concat('{"', key, '":', entry, "}");
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-series.json"));
    }

    function _seriesKey(address factory, uint256 strike, uint64 maturityTimestamp)
        internal
        view
        returns (string memory)
    {
        return string.concat(
            vm.toString(block.chainid),
            ":",
            vm.toString(factory),
            ":",
            vm.toString(strike),
            ":",
            vm.toString(uint256(maturityTimestamp))
        );
    }

    function _seriesEntry(address factory, uint256 strike, uint64 maturityTimestamp, address stable, address up)
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
            ',"maturityTimestamp":',
            vm.toString(uint256(maturityTimestamp)),
            ',"stableToken":"',
            vm.toString(stable),
            '","upToken":"',
            vm.toString(up),
            '"}'
        );
    }
}
