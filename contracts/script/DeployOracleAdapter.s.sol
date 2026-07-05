// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ChainlinkEthUsdOracleAdapter} from "../src/oracle/ChainlinkEthUsdOracleAdapter.sol";

contract DeployOracleAdapter is Script {
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function run() external returns (ChainlinkEthUsdOracleAdapter adapter) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address ethUsdFeed = vm.envOr("ETH_USD_FEED", SEPOLIA_ETH_USD_FEED);
        uint256 maxStaleness = vm.envUint("MAX_STALENESS");
        address owner = vm.envOr("ORACLE_OWNER", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);
        adapter = new ChainlinkEthUsdOracleAdapter(ethUsdFeed, maxStaleness, owner);
        vm.stopBroadcast();

        string memory object = "oracleAdapter";
        string memory json = vm.serializeUint(object, "chainId", block.chainid);
        json = vm.serializeAddress(object, "adapter", address(adapter));
        json = vm.serializeAddress(object, "ethUsdFeed", ethUsdFeed);
        json = vm.serializeUint(object, "maxStaleness", maxStaleness);
        json = vm.serializeAddress(object, "owner", owner);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-oracle-adapter.json"));
    }
}
