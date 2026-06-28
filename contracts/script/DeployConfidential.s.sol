// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {OptionFactory} from "../src/confidential/OptionFactory.sol";
import {SeriesPool} from "../src/confidential/SeriesPool.sol";
import {ConfidentialMatchingEngine} from "../src/confidential/ConfidentialMatchingEngine.sol";

contract DeployConfidential is Script {
    function run()
        external
        returns (OptionFactory factory, SeriesPool poolImplementation, ConfidentialMatchingEngine matchingEngine)
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address cWETH = vm.envAddress("CWETH");
        address oracle = vm.envAddress("ORACLE");

        vm.startBroadcast(deployerKey);
        factory = new OptionFactory(cWETH, oracle);
        poolImplementation = new SeriesPool();
        matchingEngine = new ConfidentialMatchingEngine();
        factory.setPoolImplementation(address(poolImplementation));
        factory.setMatchingEngine(address(matchingEngine));
        vm.stopBroadcast();

        string memory object = "confidentialFactory";
        string memory json = vm.serializeUint(object, "chainId", block.chainid);
        json = vm.serializeAddress(object, "oracle", oracle);
        json = vm.serializeAddress(object, "cWETH", cWETH);
        json = vm.serializeAddress(object, "factory", address(factory));
        json = vm.serializeAddress(object, "vault", address(factory.vault()));
        json = vm.serializeAddress(object, "seriesPoolImplementation", address(poolImplementation));
        json = vm.serializeAddress(object, "matchingEngine", address(matchingEngine));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-confidential.json"));
    }
}

