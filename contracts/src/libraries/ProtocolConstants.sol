// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library ProtocolConstants {
    address internal constant ZERO_ADDRESS = address(0);
    address internal constant INITIALIZED_IMPLEMENTATION_SENTINEL = address(1);

    uint256 internal constant ZERO_UINT256 = 0;
    uint64 internal constant ZERO_UINT64 = 0;
    uint32 internal constant ZERO_UINT32 = 0;
    uint256 internal constant FIRST_ARRAY_INDEX = 0;

    uint8 internal constant TOKEN_DECIMALS = 6;
    uint8 internal constant MAX_CHAINLINK_FEED_DECIMALS = 18;

    uint64 internal constant PAYOUT_SCALE = 1_000_000;
    uint256 internal constant STRIKE_TICK = 50;
    uint256 internal constant MAX_DEPOSIT_STRIKE_BPS = 5_000;

    uint256 internal constant SECONDS_PER_DAY = 1 days;
    uint256 internal constant POC_MATURITY_INTERVAL = 10 minutes;

    uint256 internal constant FLASH_FEE_BPS = 5;
    uint256 internal constant BASIS_POINTS = 10_000;
    bytes32 internal constant FLASH_CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    uint256 internal constant MAX_POOL_SELLERS = 50;

    uint256 internal constant SINGLE_FHE_HANDLE = 1;

    uint8 internal constant ASCII_ZERO = 48;
    uint256 internal constant DECIMAL_RADIX = 10;

    string internal constant ZERO_STRING = "0";
    string internal constant STABLE_TOKEN_NAME_PREFIX = "stableETH-";
    string internal constant STABLE_TOKEN_SYMBOL_PREFIX = "stETH-";
    string internal constant UP_TOKEN_NAME_PREFIX = "upETH-";
    string internal constant TOKEN_NAME_SEPARATOR = "-";
}
