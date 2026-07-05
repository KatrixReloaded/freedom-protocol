// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {OptionFactory} from "../src/confidential/OptionFactory.sol";
import {SeriesPool} from "../src/confidential/SeriesPool.sol";
import {ConfidentialMatchingEngine} from "../src/confidential/ConfidentialMatchingEngine.sol";
import {ChainlinkEthUsdOracleAdapter} from "../src/oracle/ChainlinkEthUsdOracleAdapter.sol";
import {ProtocolConstants} from "../src/libraries/ProtocolConstants.sol";

contract DeployConfidential is Script {
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function run()
        external
        returns (OptionFactory factory, SeriesPool poolImplementation, ConfidentialMatchingEngine matchingEngine)
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address cWETH = vm.envAddress("CWETH");
        address ethUsdFeed = vm.envOr("ETH_USD_FEED", SEPOLIA_ETH_USD_FEED);
        uint256 maxStaleness = vm.envUint("MAX_STALENESS");
        address oracle = vm.envOr("ORACLE", ProtocolConstants.ZERO_ADDRESS);
        address oracleAdapter = oracle;
        bool oracleAdapterDeployedByScript;

        vm.startBroadcast(deployerKey);
        if (oracle == ProtocolConstants.ZERO_ADDRESS) {
            address owner = vm.envOr("ORACLE_OWNER", vm.addr(deployerKey));
            ChainlinkEthUsdOracleAdapter adapter = new ChainlinkEthUsdOracleAdapter(ethUsdFeed, maxStaleness, owner);
            oracle = address(adapter);
            oracleAdapter = address(adapter);
            oracleAdapterDeployedByScript = true;
        }
        factory = new OptionFactory(cWETH, oracle, ethUsdFeed, maxStaleness);
        poolImplementation = new SeriesPool();
        matchingEngine = new ConfidentialMatchingEngine();
        factory.setPoolImplementation(address(poolImplementation));
        factory.setMatchingEngine(address(matchingEngine));
        vm.stopBroadcast();

        string memory object = "confidentialFactory";
        string memory json = vm.serializeUint(object, "chainId", block.chainid);
        json = vm.serializeAddress(object, "oracle", oracle);
        json = vm.serializeAddress(object, "ethUsdFeed", ethUsdFeed);
        json = vm.serializeUint(object, "depositPriceMaxStaleness", maxStaleness);
        json = vm.serializeAddress(object, "oracleAdapter", oracleAdapter);
        json = vm.serializeBool(object, "oracleAdapterDeployedByScript", oracleAdapterDeployedByScript);
        json = vm.serializeAddress(object, "cWETH", cWETH);
        json = vm.serializeAddress(object, "factory", address(factory));
        json = vm.serializeAddress(object, "vault", address(factory.vault()));
        json = vm.serializeAddress(object, "seriesPoolImplementation", address(poolImplementation));
        json = vm.serializeAddress(object, "matchingEngine", address(matchingEngine));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-confidential.json"));
    }
}
