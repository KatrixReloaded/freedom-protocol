// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {IOptionFactory} from "../interfaces/IOptionFactory.sol";
import {OptionToken} from "../confidential/OptionToken.sol";

interface IBridgeAuthorizableFactory is IOptionFactory {
    function authorizeBridge(uint256 strike, uint64 maturity) external;
}

interface IPublicOptionFactory is IOptionFactory {
    function bridgeMint(uint256 strike, uint64 maturity, bool isStable, address to, uint256 amount) external;
}

contract UnshieldBridge {
    IBridgeAuthorizableFactory public immutable confidentialFactory;
    IPublicOptionFactory public immutable publicFactory;

    struct UnshieldRequest {
        address user;
        uint256 strike;
        uint64 maturity;
        bool isStable;
        uint64 requestedAmount;
        euint64 burnedAmount;
        bool finalized;
    }

    uint256 public nextRequestId;
    mapping(uint256 => UnshieldRequest) public requests;

    event UnshieldRequested(
        uint256 indexed requestId,
        address indexed user,
        uint256 indexed strike,
        uint64 maturity,
        bool isStable,
        uint64 requestedAmount,
        bytes32 burnedAmountHandle
    );
    event UnshieldFinalized(
        uint256 indexed requestId,
        address indexed user,
        uint256 indexed strike,
        uint64 maturity,
        bool isStable,
        uint64 amount
    );

    error SeriesNotFound();
    error AmountTooLarge();
    error RequestNotFound();
    error AlreadyFinalized();
    error BurnExceedsRequest();

    constructor(address confFactory_, address pubFactory_) {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        confidentialFactory = IBridgeAuthorizableFactory(confFactory_);
        publicFactory = IPublicOptionFactory(pubFactory_);
    }

    function authorizeSeries(uint256 strike, uint64 maturity) external {
        confidentialFactory.authorizeBridge(strike, maturity);
    }

    /// @notice Burns up to `amount` confidential tokens and starts a public-decryption-backed mint request.
    /// @dev The public mint is completed by `finalizeUnshield` after KMS proof verification.
    ///      The requested amount is plaintext; the actual burned amount is publicly decrypted for safety.
    function unshield(uint256 strike, uint64 maturity, bool isStable, uint256 amount)
        external
        returns (uint256 requestId)
    {
        (address confStable, address confUp) = confidentialFactory.getTokens(strike, maturity);
        (address pubStable, address pubUp) = publicFactory.getTokens(strike, maturity);
        address confTokenAddr = isStable ? confStable : confUp;
        address pubTokenAddr = isStable ? pubStable : pubUp;
        if (confTokenAddr == address(0) || pubTokenAddr == address(0)) revert SeriesNotFound();
        if (amount > type(uint64).max) revert AmountTooLarge();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 requestedAmount = uint64(amount);

        OptionToken confToken = OptionToken(confTokenAddr);

        euint64 encAmount = FHE.asEuint64(requestedAmount);
        FHE.allow(encAmount, address(confToken));
        euint64 burnedAmount = confToken.burn(msg.sender, encAmount);
        FHE.makePubliclyDecryptable(burnedAmount);

        requestId = nextRequestId++;
        requests[requestId] = UnshieldRequest({
            user: msg.sender,
            strike: strike,
            maturity: maturity,
            isStable: isStable,
            requestedAmount: requestedAmount,
            burnedAmount: burnedAmount,
            finalized: false
        });

        emit UnshieldRequested(
            requestId, msg.sender, strike, maturity, isStable, requestedAmount, FHE.toBytes32(burnedAmount)
        );
    }

    /// @notice Verifies the public decryption of the actual burned amount and mints exactly that amount publicly.
    /// @dev `abiEncodedCleartexts` must ABI-encode one uint64 matching the request's `burnedAmount` handle.
    function finalizeUnshield(uint256 requestId, bytes calldata abiEncodedCleartexts, bytes calldata decryptionProof)
        external
    {
        UnshieldRequest storage request = requests[requestId];
        if (request.user == address(0)) revert RequestNotFound();
        if (request.finalized) revert AlreadyFinalized();

        bytes32[] memory handlesList = new bytes32[](1);
        handlesList[0] = FHE.toBytes32(request.burnedAmount);
        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        uint64 actualBurned = abi.decode(abiEncodedCleartexts, (uint64));
        if (actualBurned > request.requestedAmount) revert BurnExceedsRequest();
        request.finalized = true;

        publicFactory.bridgeMint(request.strike, request.maturity, request.isStable, request.user, actualBurned);

        emit UnshieldFinalized(
            requestId, request.user, request.strike, request.maturity, request.isStable, actualBurned
        );
    }
}
