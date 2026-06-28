// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PublicOptionFactory} from "../src/public/PublicOptionFactory.sol";

contract DeployPublic is Script {
    function run() external returns (PublicOptionFactory factory) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address collateralToken = vm.envOr("COLLATERAL_TOKEN", address(0));
        address oracle = vm.envAddress("ORACLE");

        vm.startBroadcast(deployerKey);
        factory = new PublicOptionFactory(collateralToken, oracle);
        vm.stopBroadcast();

        string memory object = "publicFactory";
        string memory json = vm.serializeUint(object, "chainId", block.chainid);
        json = vm.serializeAddress(object, "oracle", oracle);
        json = vm.serializeAddress(object, "collateralToken", collateralToken);
        json = vm.serializeAddress(object, "factory", address(factory));
        json = vm.serializeAddress(object, "vault", address(factory.vault()));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-public.json"));
    }
}

