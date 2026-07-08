// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PublicOptionFactory} from "../src/public/PublicOptionFactory.sol";
import {ChainlinkEthUsdOracleAdapter} from "../src/oracle/ChainlinkEthUsdOracleAdapter.sol";
import {ProtocolConstants} from "../src/libraries/ProtocolConstants.sol";

contract DeployPublic is Script {
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    uint256 internal constant DEFAULT_MAX_STALENESS = 5 minutes;

    error DeployPublic__MissingWeth();

    function run() external returns (PublicOptionFactory factory) {
        address broadcaster = _startBroadcast();
        address collateralToken = _weth();
        address ethUsdFeed = vm.envOr("ETH_USD_FEED", SEPOLIA_ETH_USD_FEED);
        uint256 maxStaleness = vm.envOr("MAX_STALENESS", DEFAULT_MAX_STALENESS);
        address oracle = vm.envOr("ORACLE", ProtocolConstants.ZERO_ADDRESS);
        address oracleAdapter = oracle;
        bool oracleAdapterDeployedByScript;

        if (oracle == ProtocolConstants.ZERO_ADDRESS) {
            address owner = vm.envOr("ORACLE_OWNER", broadcaster);
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
        json = vm.serializeAddress(object, "weth", collateralToken);
        json = vm.serializeAddress(object, "collateralToken", collateralToken);
        json = vm.serializeAddress(object, "oracleAdapter", oracleAdapter);
        json = vm.serializeBool(object, "oracleAdapterDeployedByScript", oracleAdapterDeployedByScript);
        json = vm.serializeAddress(object, "factory", address(factory));
        json = vm.serializeAddress(object, "vault", address(factory.vault()));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-public.json"));
    }

    function _weth() internal view returns (address weth) {
        weth = vm.envOr("WETH", vm.envOr("COLLATERAL_TOKEN", ProtocolConstants.ZERO_ADDRESS));
        if (weth == ProtocolConstants.ZERO_ADDRESS) revert DeployPublic__MissingWeth();
    }

    function _startBroadcast() internal returns (address broadcaster) {
        if (vm.envExists("PRIVATE_KEY")) {
            uint256 deployerKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(deployerKey);
            vm.startBroadcast(deployerKey);
        } else {
            broadcaster = msg.sender;
            vm.startBroadcast();
        }
    }
}
