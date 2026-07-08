// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ShieldBridge} from "../src/bridge/ShieldBridge.sol";
import {PublicOptionFactory} from "../src/public/PublicOptionFactory.sol";
import {OptionFactory} from "../src/confidential/OptionFactory.sol";

contract DeployBridge is Script {
    function run() external returns (ShieldBridge bridge) {
        address confidentialFactory = vm.envAddress("CONFIDENTIAL_FACTORY");
        address publicFactory = vm.envAddress("PUBLIC_FACTORY");

        _startBroadcast();
        bridge = new ShieldBridge(confidentialFactory, publicFactory);
        PublicOptionFactory(publicFactory).setBridge(address(bridge));
        OptionFactory(confidentialFactory).setBridge(address(bridge));
        vm.stopBroadcast();

        string memory object = "bridge";
        string memory json = vm.serializeUint(object, "chainId", block.chainid);
        json = vm.serializeAddress(object, "bridge", address(bridge));
        json = vm.serializeAddress(object, "publicFactory", publicFactory);
        json = vm.serializeAddress(object, "confidentialFactory", confidentialFactory);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-bridge.json"));
    }

    function _startBroadcast() internal {
        if (vm.envExists("PRIVATE_KEY")) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        } else {
            vm.startBroadcast();
        }
    }
}
