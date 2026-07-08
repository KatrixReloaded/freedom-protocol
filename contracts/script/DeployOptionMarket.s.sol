// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ProtocolConstants} from "../src/libraries/ProtocolConstants.sol";

interface IOptionMarketFactory {
    function createSeries(uint256 strikePrice, uint64 maturityTimestamp) external returns (address stable, address up);
    function getTokens(uint256 strikePrice, uint64 maturityTimestamp) external view returns (address stable, address up);
    function seriesExists(uint256 strikePrice, uint64 maturityTimestamp) external view returns (bool);
}

interface IConfidentialPoolFactory {
    function createPool(
        uint256 strikePrice,
        uint64 maturityTimestamp,
        bool isStable,
        address quoteToken,
        uint64 minPricePerToken
    ) external returns (address pool);
}

contract DeployOptionMarket is Script {
    struct PoolConfig {
        bool createStablePool;
        bool createUpPool;
        address quoteToken;
        uint64 stableMinPricePerToken;
        uint64 upMinPricePerToken;
    }

    error DeployOptionMarket__MissingQuoteToken();

    function run() external returns (address stableToken, address upToken, address stablePool, address upPool) {
        address factory = vm.envAddress("FACTORY");
        uint256 strike = vm.envUint("STRIKE");
        uint64 maturityTimestamp = uint64(vm.envUint("MATURITY_TIMESTAMP"));
        PoolConfig memory poolConfig = _poolConfig();

        _startBroadcast();
        if (IOptionMarketFactory(factory).seriesExists(strike, maturityTimestamp)) {
            (stableToken, upToken) = IOptionMarketFactory(factory).getTokens(strike, maturityTimestamp);
        } else {
            (stableToken, upToken) = IOptionMarketFactory(factory).createSeries(strike, maturityTimestamp);
        }

        if (poolConfig.createStablePool) {
            stablePool = IConfidentialPoolFactory(factory)
                .createPool(strike, maturityTimestamp, true, poolConfig.quoteToken, poolConfig.stableMinPricePerToken);
        }
        if (poolConfig.createUpPool) {
            upPool = IConfidentialPoolFactory(factory)
                .createPool(strike, maturityTimestamp, false, poolConfig.quoteToken, poolConfig.upMinPricePerToken);
        }
        vm.stopBroadcast();

        _writeDeployment(factory, strike, maturityTimestamp, stableToken, upToken, stablePool, upPool, poolConfig);
    }

    function _poolConfig() internal view returns (PoolConfig memory config) {
        config.createStablePool = vm.envOr("CREATE_STABLE_POOL", false);
        config.createUpPool = vm.envOr("CREATE_UP_POOL", false);
        if (config.createStablePool || config.createUpPool) {
            config.quoteToken = vm.envAddress("QUOTE_TOKEN");
            if (config.quoteToken == ProtocolConstants.ZERO_ADDRESS) revert DeployOptionMarket__MissingQuoteToken();
            config.stableMinPricePerToken = uint64(vm.envOr("STABLE_MIN_PRICE_PER_TOKEN", uint256(0)));
            config.upMinPricePerToken = uint64(vm.envOr("UP_MIN_PRICE_PER_TOKEN", uint256(0)));
        }
    }

    function _writeDeployment(
        address factory,
        uint256 strike,
        uint64 maturityTimestamp,
        address stableToken,
        address upToken,
        address stablePool,
        address upPool,
        PoolConfig memory poolConfig
    ) internal {
        string memory object = "optionMarket";
        string memory json = vm.serializeUint(object, "chainId", block.chainid);
        json = vm.serializeAddress(object, "factory", factory);
        json = vm.serializeUint(object, "strike", strike);
        json = vm.serializeUint(object, "maturityTimestamp", maturityTimestamp);
        json = vm.serializeAddress(object, "stableToken", stableToken);
        json = vm.serializeAddress(object, "upToken", upToken);
        json = vm.serializeBool(object, "stablePoolCreated", poolConfig.createStablePool);
        json = vm.serializeBool(object, "upPoolCreated", poolConfig.createUpPool);
        json = vm.serializeAddress(object, "quoteToken", poolConfig.quoteToken);
        json = vm.serializeUint(object, "stableMinPricePerToken", poolConfig.stableMinPricePerToken);
        json = vm.serializeUint(object, "upMinPricePerToken", poolConfig.upMinPricePerToken);
        json = vm.serializeAddress(object, "stablePool", stablePool);
        json = vm.serializeAddress(object, "upPool", upPool);

        vm.writeJson(
            json,
            string.concat(
                "deployments/",
                vm.toString(block.chainid),
                "-market-",
                vm.toString(factory),
                "-",
                vm.toString(strike),
                "-",
                vm.toString(uint256(maturityTimestamp)),
                ".json"
            )
        );
    }

    function _startBroadcast() internal {
        if (vm.envExists("PRIVATE_KEY")) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        } else {
            vm.startBroadcast();
        }
    }
}
