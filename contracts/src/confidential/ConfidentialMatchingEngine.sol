// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, externalEuint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {OptionToken} from "./OptionToken.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

/// @notice Blind OTC matching engine for stableETH/upETH against a confidential quote token.
///
/// Flow:
///   Seller: createListing(token, quoteToken, strikePrice, maturityTimestamp, encAmount, encMinReceive, proof)
///     → locks encrypted token amount in escrow
///
///   Buyer:  fill(listingId, encPayment, encExpected, proof)
///     → locks encrypted payment in escrow
///     → FHE verifies: payment >= minReceive AND locked >= expected
///     → If match: atomic swap; else full refund to both
///
/// Nothing about amounts, prices, or match outcomes is revealed on-chain.

interface IConfidentialQuoteToken {
    function transferFrom(address from, address to, externalEuint64 encAmt, bytes calldata proof)
        external
        returns (bool);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64);
    function balanceOf(address account) external view returns (euint64);
}

contract ConfidentialMatchingEngine {
    struct Listing {
        address seller;
        OptionToken token; // stableETH or upETH being sold
        IConfidentialQuoteToken quoteToken; // e.g. cUSDC
        uint256 strikePrice;
        uint64 maturityTimestamp;
        euint64 lockedAmount; // encrypted: seller's tokens in escrow
        euint64 minReceive; // encrypted: seller's price floor
        bool active;
    }

    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address token,
        address quoteToken,
        uint256 strikePrice,
        uint64 maturityTimestamp
    );
    event FillAttempted(uint256 indexed listingId, address indexed buyer);
    event ListingCancelled(uint256 indexed listingId);

    error ConfidentialMatchingEngine__ListingNotActive();
    error ConfidentialMatchingEngine__NotSeller();

    constructor() {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
    }

    // ── Seller: create a listing ───────────────────────────────────────────

    /// @notice Seller escrows encrypted stableETH/upETH and sets an encrypted minimum price.
    /// @param token        The OptionToken contract being sold.
    /// @param quoteToken   The confidential token accepted as payment (e.g. cUSDC).
    /// @param encAmount    Encrypted amount of tokens to list.
    /// @param encMinReceive Encrypted minimum payment the seller will accept.
    function createListing(
        OptionToken token,
        IConfidentialQuoteToken quoteToken,
        uint256 strikePrice,
        uint64 maturityTimestamp,
        externalEuint64 encAmount,
        externalEuint64 encMinReceive,
        bytes calldata amountProof,
        bytes calldata minProof
    ) external returns (uint256 listingId) {
        euint64 amount = FHE.fromExternal(encAmount, amountProof);
        euint64 minPay = FHE.fromExternal(encMinReceive, minProof);

        // Pull seller's tokens into escrow
        FHE.allow(amount, address(token));
        token.pullFrom(msg.sender, amount);

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            token: token,
            quoteToken: quoteToken,
            strikePrice: strikePrice,
            maturityTimestamp: maturityTimestamp,
            lockedAmount: amount,
            minReceive: minPay,
            active: true
        });

        FHE.allowThis(amount);
        FHE.allowThis(minPay);
        FHE.allow(minPay, msg.sender); // seller can view their own min

        emit ListingCreated(listingId, msg.sender, address(token), address(quoteToken), strikePrice, maturityTimestamp);
    }

    // ── Buyer: attempt a fill ──────────────────────────────────────────────

    /// @notice Buyer submits encrypted payment and expected receive amount.
    ///         Contract verifies match via FHE. If both conditions hold, swap executes.
    ///         Otherwise, full refund to both — nothing about terms is leaked.
    ///
    /// Match conditions (evaluated in FHE):
    ///   C1: buyerPayment >= seller.minReceive
    ///   C2: seller.lockedAmount >= buyerExpected
    ///
    /// If C1 && C2:
    ///   buyer receives min(lockedAmount, expected) tokens
    ///   seller receives min(payment, minReceive) quote tokens
    ///   excess refunded to respective parties
    function fill(
        uint256 listingId,
        externalEuint64 encPayment,
        externalEuint64 encExpected,
        bytes calldata paymentProof,
        bytes calldata expectedProof
    ) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert ConfidentialMatchingEngine__ListingNotActive();

        euint64 payment = FHE.fromExternal(encPayment, paymentProof);
        euint64 expected = FHE.fromExternal(encExpected, expectedProof);

        // Escrow buyer's payment using the internal handle already decoded by this engine.
        FHE.allow(payment, address(l.quoteToken));
        l.quoteToken.confidentialTransferFrom(msg.sender, address(this), payment);

        // ── FHE match verification ─────────────────────────────────────────
        ebool c1 = FHE.ge(payment, l.minReceive); // buyer pays enough
        ebool c2 = FHE.ge(l.lockedAmount, expected); // seller has enough
        ebool matched = FHE.and(c1, c2);

        // ── Compute transfer amounts (all encrypted) ───────────────────────
        // tokenOut: buyer gets min(lockedAmount, expected) if matched, else 0
        euint64 tokenOut =
            FHE.select(matched, FHE.min(l.lockedAmount, expected), FHE.asEuint64(ProtocolConstants.ZERO_UINT64));
        // quoteOut: seller gets min(payment, minReceive) if matched, else 0
        euint64 quoteOut =
            FHE.select(matched, FHE.min(payment, l.minReceive), FHE.asEuint64(ProtocolConstants.ZERO_UINT64));
        // refunds
        euint64 tokenBack = FHE.sub(l.lockedAmount, tokenOut); // unsold tokens back to seller
        euint64 quoteBack = FHE.sub(payment, quoteOut); // excess quote back to buyer

        // ── Execute transfers ──────────────────────────────────────────────
        // Token → buyer (escrowed tokens held by this contract)
        // Allow the token contract to operate on FHE-computed handles before crossing the call boundary.
        FHE.allow(tokenOut, address(l.token));
        FHE.allow(tokenOut, msg.sender);
        l.token.authorizedTransfer(address(this), msg.sender, tokenOut);

        // Token refund → seller (unsold portion of escrow)
        FHE.allow(tokenBack, address(l.token));
        FHE.allow(tokenBack, l.seller);
        l.token.authorizedTransfer(address(this), l.seller, tokenBack);

        // Quote → seller
        FHE.allow(quoteOut, address(l.quoteToken));
        FHE.allow(quoteOut, l.seller);
        l.quoteToken.confidentialTransfer(l.seller, quoteOut);

        // Quote refund → buyer
        FHE.allow(quoteBack, address(l.quoteToken));
        FHE.allow(quoteBack, msg.sender);
        l.quoteToken.confidentialTransfer(msg.sender, quoteBack);

        // Deactivate listing (fully consumed or failed — amounts handle it)
        l.active = false;
        l.lockedAmount = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);

        emit FillAttempted(listingId, msg.sender);
    }

    // ── Seller: cancel listing ─────────────────────────────────────────────

    /// @notice Seller cancels and retrieves locked tokens.
    function cancelListing(uint256 listingId) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert ConfidentialMatchingEngine__ListingNotActive();
        if (l.seller != msg.sender) revert ConfidentialMatchingEngine__NotSeller();

        euint64 amount = l.lockedAmount;
        l.active = false;
        l.lockedAmount = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);

        // Return escrowed tokens to seller via authorizedTransfer (not mint).
        FHE.allow(amount, address(l.token));
        FHE.allow(amount, l.seller);
        l.token.authorizedTransfer(address(this), l.seller, amount);

        emit ListingCancelled(listingId);
    }

    // ── View ───────────────────────────────────────────────────────────────

    function getListing(uint256 listingId)
        external
        view
        returns (
            address seller,
            address token,
            address quoteToken,
            uint256 strikePrice,
            uint64 maturityTimestamp,
            bool active
        )
    {
        Listing storage l = listings[listingId];
        return (l.seller, address(l.token), address(l.quoteToken), l.strikePrice, l.maturityTimestamp, l.active);
    }
}
