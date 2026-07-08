// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ShieldBridge} from "../src/bridge/ShieldBridge.sol";
import {OptionFactory} from "../src/confidential/OptionFactory.sol";
import {ConfidentialMatchingEngine} from "../src/confidential/ConfidentialMatchingEngine.sol";
import {SeriesPool} from "../src/confidential/SeriesPool.sol";
import {ChainlinkEthUsdOracleAdapter} from "../src/oracle/ChainlinkEthUsdOracleAdapter.sol";
import {PublicOptionFactory} from "../src/public/PublicOptionFactory.sol";
import {ProtocolConstants} from "../src/libraries/ProtocolConstants.sol";

contract DeployFullProtocol is Script {
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    uint256 internal constant DEFAULT_MAX_STALENESS = 5 minutes;

    error DeployFullProtocol__MissingWeth();

    function run()
        external
        returns (
            PublicOptionFactory publicFactory,
            OptionFactory confidentialFactory,
            SeriesPool poolImplementation,
            ConfidentialMatchingEngine matchingEngine,
            ShieldBridge bridge
        )
    {
        address broadcaster;
        if (vm.envExists("PRIVATE_KEY")) {
            uint256 deployerKey = vm.envUint("PRIVATE_KEY");
            broadcaster = vm.addr(deployerKey);
            vm.startBroadcast(deployerKey);
        } else {
            broadcaster = msg.sender;
            vm.startBroadcast();
        }

        address collateralToken = vm.envOr("WETH", vm.envOr("COLLATERAL_TOKEN", ProtocolConstants.ZERO_ADDRESS));
        if (collateralToken == ProtocolConstants.ZERO_ADDRESS) revert DeployFullProtocol__MissingWeth();
        address cWETH = vm.envAddress("CWETH");
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

        publicFactory = new PublicOptionFactory(collateralToken, oracle, ethUsdFeed, maxStaleness);

        confidentialFactory = new OptionFactory(cWETH, oracle, ethUsdFeed, maxStaleness);
        poolImplementation = new SeriesPool();
        matchingEngine = new ConfidentialMatchingEngine();
        confidentialFactory.setPoolImplementation(address(poolImplementation));
        confidentialFactory.setMatchingEngine(address(matchingEngine));

        bridge = new ShieldBridge(address(confidentialFactory), address(publicFactory));
        publicFactory.setBridge(address(bridge));
        confidentialFactory.setBridge(address(bridge));

        vm.stopBroadcast();

        string memory publicObject = "publicFactory";
        string memory publicJson = vm.serializeUint(publicObject, "chainId", block.chainid);
        publicJson = vm.serializeAddress(publicObject, "oracle", oracle);
        publicJson = vm.serializeAddress(publicObject, "ethUsdFeed", ethUsdFeed);
        publicJson = vm.serializeUint(publicObject, "depositPriceMaxStaleness", maxStaleness);
        publicJson = vm.serializeAddress(publicObject, "weth", collateralToken);
        publicJson = vm.serializeAddress(publicObject, "collateralToken", collateralToken);
        publicJson = vm.serializeAddress(publicObject, "oracleAdapter", oracleAdapter);
        publicJson = vm.serializeBool(publicObject, "oracleAdapterDeployedByScript", oracleAdapterDeployedByScript);
        publicJson = vm.serializeAddress(publicObject, "factory", address(publicFactory));
        publicJson = vm.serializeAddress(publicObject, "vault", address(publicFactory.vault()));
        publicJson =
            vm.serializeAddress(publicObject, "stableTokenImplementation", publicFactory.stableTokenImplementation());
        publicJson = vm.serializeAddress(publicObject, "upTokenImplementation", publicFactory.upTokenImplementation());
        publicJson = vm.serializeAddress(publicObject, "bridge", address(bridge));
        vm.writeJson(publicJson, string.concat("deployments/", vm.toString(block.chainid), "-public.json"));

        string memory confidentialObject = "confidentialFactory";
        string memory confidentialJson = vm.serializeUint(confidentialObject, "chainId", block.chainid);
        confidentialJson = vm.serializeAddress(confidentialObject, "oracle", oracle);
        confidentialJson = vm.serializeAddress(confidentialObject, "ethUsdFeed", ethUsdFeed);
        confidentialJson = vm.serializeUint(confidentialObject, "depositPriceMaxStaleness", maxStaleness);
        confidentialJson = vm.serializeAddress(confidentialObject, "oracleAdapter", oracleAdapter);
        confidentialJson =
            vm.serializeBool(confidentialObject, "oracleAdapterDeployedByScript", oracleAdapterDeployedByScript);
        confidentialJson = vm.serializeAddress(confidentialObject, "cWETH", cWETH);
        confidentialJson = vm.serializeAddress(confidentialObject, "factory", address(confidentialFactory));
        confidentialJson = vm.serializeAddress(confidentialObject, "vault", address(confidentialFactory.vault()));
        confidentialJson =
            vm.serializeAddress(confidentialObject, "seriesPoolImplementation", address(poolImplementation));
        confidentialJson = vm.serializeAddress(confidentialObject, "matchingEngine", address(matchingEngine));
        confidentialJson = vm.serializeAddress(
            confidentialObject, "stableTokenImplementation", confidentialFactory.stableTokenImplementation()
        );
        confidentialJson = vm.serializeAddress(
            confidentialObject, "upTokenImplementation", confidentialFactory.upTokenImplementation()
        );
        confidentialJson = vm.serializeAddress(confidentialObject, "bridge", address(bridge));
        vm.writeJson(confidentialJson, string.concat("deployments/", vm.toString(block.chainid), "-confidential.json"));

        string memory bridgeObject = "bridge";
        string memory bridgeJson = vm.serializeUint(bridgeObject, "chainId", block.chainid);
        bridgeJson = vm.serializeAddress(bridgeObject, "bridge", address(bridge));
        bridgeJson = vm.serializeAddress(bridgeObject, "publicFactory", address(publicFactory));
        bridgeJson = vm.serializeAddress(bridgeObject, "confidentialFactory", address(confidentialFactory));
        vm.writeJson(bridgeJson, string.concat("deployments/", vm.toString(block.chainid), "-bridge.json"));

        string memory fullObject = "fullProtocol";
        string memory fullJson = vm.serializeUint(fullObject, "chainId", block.chainid);
        fullJson = vm.serializeAddress(fullObject, "oracle", oracle);
        fullJson = vm.serializeAddress(fullObject, "oracleAdapter", oracleAdapter);
        fullJson = vm.serializeBool(fullObject, "oracleAdapterDeployedByScript", oracleAdapterDeployedByScript);
        fullJson = vm.serializeAddress(fullObject, "ethUsdFeed", ethUsdFeed);
        fullJson = vm.serializeUint(fullObject, "depositPriceMaxStaleness", maxStaleness);
        fullJson = vm.serializeAddress(fullObject, "weth", collateralToken);
        fullJson = vm.serializeAddress(fullObject, "cWETH", cWETH);
        fullJson = vm.serializeAddress(fullObject, "publicFactory", address(publicFactory));
        fullJson = vm.serializeAddress(fullObject, "publicVault", address(publicFactory.vault()));
        fullJson = vm.serializeAddress(
            fullObject, "publicStableTokenImplementation", publicFactory.stableTokenImplementation()
        );
        fullJson = vm.serializeAddress(fullObject, "publicUpTokenImplementation", publicFactory.upTokenImplementation());
        fullJson = vm.serializeAddress(fullObject, "confidentialFactory", address(confidentialFactory));
        fullJson = vm.serializeAddress(fullObject, "confidentialVault", address(confidentialFactory.vault()));
        fullJson = vm.serializeAddress(
            fullObject, "confidentialStableTokenImplementation", confidentialFactory.stableTokenImplementation()
        );
        fullJson = vm.serializeAddress(
            fullObject, "confidentialUpTokenImplementation", confidentialFactory.upTokenImplementation()
        );
        fullJson = vm.serializeAddress(fullObject, "seriesPoolImplementation", address(poolImplementation));
        fullJson = vm.serializeAddress(fullObject, "matchingEngine", address(matchingEngine));
        fullJson = vm.serializeAddress(fullObject, "bridge", address(bridge));
        vm.writeJson(fullJson, string.concat("deployments/", vm.toString(block.chainid), "-full.json"));
    }
}
