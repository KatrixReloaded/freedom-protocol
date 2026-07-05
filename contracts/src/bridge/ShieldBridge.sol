// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {IOptionFactory} from "../interfaces/IOptionFactory.sol";
import {OptionToken} from "../confidential/OptionToken.sol";
import {PublicOptionToken} from "../public/PublicOptionToken.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

interface IConfidentialBridgeFactory is IOptionFactory {
    function authorizeBridge(uint256 strikePrice, uint64 maturityTimestamp) external;
    function createSeries(uint256 strikePrice, uint64 maturityTimestamp) external returns (address stable, address up);
    function bridgeMint(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, address to, uint256 amount)
        external;
}

interface IPublicOptionFactory is IOptionFactory {
    function authorizeBridge(uint256 strikePrice, uint64 maturityTimestamp) external;
    function createSeries(uint256 strikePrice, uint64 maturityTimestamp) external returns (address stable, address up);
    function bridgeMint(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, address to, uint256 amount)
        external;
}

contract ShieldBridge {
    IConfidentialBridgeFactory public immutable confidentialFactory;
    IPublicOptionFactory public immutable publicFactory;

    struct UnshieldRequest {
        address user;
        uint256 strikePrice;
        uint64 maturityTimestamp;
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
        uint256 indexed strikePrice,
        uint64 maturityTimestamp,
        bool isStable,
        uint64 requestedAmount,
        bytes32 burnedAmountHandle
    );
    event UnshieldFinalized(
        uint256 indexed requestId,
        address indexed user,
        uint256 indexed strikePrice,
        uint64 maturityTimestamp,
        bool isStable,
        uint64 amount
    );
    event Shielded(
        address indexed user,
        bytes32 indexed seriesId,
        uint256 indexed strikePrice,
        uint64 maturityTimestamp,
        bool isStable,
        uint256 amount
    );

    error ShieldBridge__SeriesNotFound();
    error ShieldBridge__AmountTooLarge();
    error ShieldBridge__RequestNotFound();
    error ShieldBridge__AlreadyFinalized();
    error ShieldBridge__BurnExceedsRequest();

    constructor(address confFactory_, address pubFactory_) {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        confidentialFactory = IConfidentialBridgeFactory(confFactory_);
        publicFactory = IPublicOptionFactory(pubFactory_);
    }

    function authorizeSeries(uint256 strikePrice, uint64 maturityTimestamp) external {
        (address confStable, address confUp) = confidentialFactory.getTokens(strikePrice, maturityTimestamp);
        if (confStable != ProtocolConstants.ZERO_ADDRESS || confUp != ProtocolConstants.ZERO_ADDRESS) {
            confidentialFactory.authorizeBridge(strikePrice, maturityTimestamp);
        }

        (address pubStable, address pubUp) = publicFactory.getTokens(strikePrice, maturityTimestamp);
        if (pubStable != ProtocolConstants.ZERO_ADDRESS || pubUp != ProtocolConstants.ZERO_ADDRESS) {
            publicFactory.authorizeBridge(strikePrice, maturityTimestamp);
        }
    }

    /// @notice Burns up to `amount` confidential tokens and starts a public-decryption-backed mint request.
    /// @dev The public mint is completed by `finalizeUnshield` after KMS proof verification.
    ///      The requested amount is plaintext; the actual burned amount is publicly decrypted for safety.
    function unshield(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, uint256 amount)
        external
        returns (uint256 requestId)
    {
        if (amount > type(uint64).max) revert ShieldBridge__AmountTooLarge();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 requestedAmount = uint64(amount);

        OptionToken confToken = _confidentialToken(strikePrice, maturityTimestamp, isStable);
        euint64 burnedAmount = _burnConfidential(confToken, requestedAmount);

        requestId = nextRequestId++;
        _recordRequest(requestId, strikePrice, maturityTimestamp, isStable, requestedAmount, burnedAmount);

        emit UnshieldRequested(
            requestId,
            msg.sender,
            strikePrice,
            maturityTimestamp,
            isStable,
            requestedAmount,
            FHE.toBytes32(burnedAmount)
        );
    }

    /// @notice Verifies the public decryption of the actual burned amount and mints exactly that amount publicly.
    /// @dev `abiEncodedCleartexts` must ABI-encode one uint64 matching the request's `burnedAmount` handle.
    function finalizeUnshield(uint256 requestId, bytes calldata abiEncodedCleartexts, bytes calldata decryptionProof)
        external
    {
        UnshieldRequest storage request = requests[requestId];
        if (request.user == ProtocolConstants.ZERO_ADDRESS) revert ShieldBridge__RequestNotFound();
        if (request.finalized) revert ShieldBridge__AlreadyFinalized();

        bytes32[] memory handlesList = new bytes32[](ProtocolConstants.SINGLE_FHE_HANDLE);
        handlesList[ProtocolConstants.FIRST_ARRAY_INDEX] = FHE.toBytes32(request.burnedAmount);
        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        uint64 actualBurned = abi.decode(abiEncodedCleartexts, (uint64));
        if (actualBurned > request.requestedAmount) revert ShieldBridge__BurnExceedsRequest();
        request.finalized = true;

        _ensurePublicSeries(request.strikePrice, request.maturityTimestamp);

        publicFactory.bridgeMint(
            request.strikePrice, request.maturityTimestamp, request.isStable, request.user, actualBurned
        );

        emit UnshieldFinalized(
            requestId, request.user, request.strikePrice, request.maturityTimestamp, request.isStable, actualBurned
        );
    }

    /// @notice Burns public option tokens and mints the same amount as confidential option tokens.
    /// @dev The amount is public because the source token is a public ERC-20.
    function shield(uint256 strikePrice, uint64 maturityTimestamp, bool isStable, uint256 amount) external {
        if (amount > type(uint64).max) revert ShieldBridge__AmountTooLarge();

        PublicOptionToken pubToken = _publicToken(strikePrice, maturityTimestamp, isStable);
        pubToken.burn(msg.sender, amount);

        _ensureConfidentialSeries(strikePrice, maturityTimestamp);
        confidentialFactory.bridgeMint(strikePrice, maturityTimestamp, isStable, msg.sender, amount);

        emit Shielded(
            msg.sender,
            publicFactory.seriesId(strikePrice, maturityTimestamp),
            strikePrice,
            maturityTimestamp,
            isStable,
            amount
        );
    }

    function _confidentialToken(uint256 strikePrice, uint64 maturityTimestamp, bool isStable)
        internal
        view
        returns (OptionToken)
    {
        (address confStable, address confUp) = confidentialFactory.getTokens(strikePrice, maturityTimestamp);
        address confTokenAddr = isStable ? confStable : confUp;
        if (confTokenAddr == ProtocolConstants.ZERO_ADDRESS) revert ShieldBridge__SeriesNotFound();
        return OptionToken(confTokenAddr);
    }

    function _publicToken(uint256 strikePrice, uint64 maturityTimestamp, bool isStable)
        internal
        view
        returns (PublicOptionToken)
    {
        (address pubStable, address pubUp) = publicFactory.getTokens(strikePrice, maturityTimestamp);
        address pubTokenAddr = isStable ? pubStable : pubUp;
        if (pubTokenAddr == ProtocolConstants.ZERO_ADDRESS) revert ShieldBridge__SeriesNotFound();
        return PublicOptionToken(pubTokenAddr);
    }

    function _burnConfidential(OptionToken confToken, uint64 requestedAmount) internal returns (euint64 burnedAmount) {
        euint64 encAmount = FHE.asEuint64(requestedAmount);
        FHE.allow(encAmount, address(confToken));
        burnedAmount = confToken.burn(msg.sender, encAmount);
        FHE.makePubliclyDecryptable(burnedAmount);
    }

    function _recordRequest(
        uint256 requestId,
        uint256 strikePrice,
        uint64 maturityTimestamp,
        bool isStable,
        uint64 requestedAmount,
        euint64 burnedAmount
    ) internal {
        UnshieldRequest storage request = requests[requestId];
        request.user = msg.sender;
        request.strikePrice = strikePrice;
        request.maturityTimestamp = maturityTimestamp;
        request.isStable = isStable;
        request.requestedAmount = requestedAmount;
        request.burnedAmount = burnedAmount;
    }

    function _ensurePublicSeries(uint256 strikePrice, uint64 maturityTimestamp) internal {
        (address pubStable, address pubUp) = publicFactory.getTokens(strikePrice, maturityTimestamp);
        if (pubStable == ProtocolConstants.ZERO_ADDRESS && pubUp == ProtocolConstants.ZERO_ADDRESS) {
            publicFactory.createSeries(strikePrice, maturityTimestamp);
        }
    }

    function _ensureConfidentialSeries(uint256 strikePrice, uint64 maturityTimestamp) internal {
        (address confStable, address confUp) = confidentialFactory.getTokens(strikePrice, maturityTimestamp);
        if (confStable == ProtocolConstants.ZERO_ADDRESS && confUp == ProtocolConstants.ZERO_ADDRESS) {
            confidentialFactory.createSeries(strikePrice, maturityTimestamp);
        }
    }
}
