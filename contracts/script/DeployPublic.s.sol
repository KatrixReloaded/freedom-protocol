// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PublicOptionFactory} from "../src/public/PublicOptionFactory.sol";
import {ChainlinkEthUsdOracleAdapter} from "../src/oracle/ChainlinkEthUsdOracleAdapter.sol";
import {ProtocolConstants} from "../src/libraries/ProtocolConstants.sol";

contract DeployPublic is Script {
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function run() external returns (PublicOptionFactory factory) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address collateralToken = vm.envOr("COLLATERAL_TOKEN", ProtocolConstants.ZERO_ADDRESS);
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
        factory = new PublicOptionFactory(collateralToken, oracle, ethUsdFeed, maxStaleness);
        vm.stopBroadcast();

        string memory object = "publicFactory";
        string memory json = vm.serializeUint(object, "chainId", block.chainid);
        json = vm.serializeAddress(object, "oracle", oracle);
        json = vm.serializeAddress(object, "ethUsdFeed", ethUsdFeed);
        json = vm.serializeUint(object, "depositPriceMaxStaleness", maxStaleness);
        json = vm.serializeAddress(object, "collateralToken", collateralToken);
        json = vm.serializeAddress(object, "oracleAdapter", oracleAdapter);
        json = vm.serializeBool(object, "oracleAdapterDeployedByScript", oracleAdapterDeployedByScript);
        json = vm.serializeAddress(object, "factory", address(factory));
        json = vm.serializeAddress(object, "vault", address(factory.vault()));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-public.json"));
    }
}
