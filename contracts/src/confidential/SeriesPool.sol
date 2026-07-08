// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, externalEuint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {OptionToken} from "./OptionToken.sol";
import {ProtocolConstants} from "../libraries/ProtocolConstants.sol";

/// @notice Aggregated liquidity pool for one option token series.
///
/// Privacy model — same as ConfidentialMatchingEngine:
///   Deposit amounts:  encrypted  (nobody sees individual seller sizes)
///   Pool total:       encrypted  (pool TVL is hidden)
///   Buy size:         encrypted  (buyer's requested amount hidden)
///   Payment:          encrypted  (buyer's price hidden)
///   Seller earnings:  encrypted  (accumulated quote per seller hidden)
///
/// Seller ordering is FIFO and public (join order is on-chain).
/// Quote earned per seller = FHE.div(FHE.mul(taken, minPricePerToken), SCALE).
///
/// @dev Deployed as an EIP-1167 clone per series. Call initialize() once after cloning.

interface IConfidentialQuoteToken {
    function transferFrom(address from, address to, externalEuint64 encAmt, bytes calldata proof)
        external
        returns (bool);
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64);
}

contract SeriesPool {
    uint64 public constant SCALE = ProtocolConstants.PAYOUT_SCALE;
    uint256 public constant MAX_SELLERS = ProtocolConstants.MAX_POOL_SELLERS;

    // ── Immutable series config (set in initialize) ────────────────────────
    OptionToken public optionToken;
    IConfidentialQuoteToken public quoteToken;
    uint256 public strikePrice;
    uint64 public maturityTimestamp;
    /// @notice Pool-wide minimum price: quote tokens per option token at SCALE precision.
    ///         e.g. 633000 means 0.633 cUSDC per stableETH token.
    uint64 public minPricePerToken;
    address public factory;
    bool public initialized;

    // ── Encrypted pool state ───────────────────────────────────────────────
    euint64 internal _encPoolBalance; // total option tokens currently held
    euint64 internal _encMinReceive; // = _encPoolBalance * minPricePerToken / SCALE; updated on each deposit

    // ── Seller FIFO accounting ─────────────────────────────────────────────
    address[] public sellers; // join order (public)
    mapping(address => euint64) public encShares; // remaining tokens per seller (encrypted)
    mapping(address => euint64) public encAccumulatedQuote; // earned quote per seller (encrypted)
    mapping(address => bool) public hasSeller;

    event Deposited(address indexed seller);
    event Filled(address indexed buyer);
    event Withdrawn(address indexed seller);

    error SeriesPool__AlreadyInitialized();
    error SeriesPool__NotFactory();
    error SeriesPool__NotYetMatured();
    error SeriesPool__AlreadyMatured();
    error SeriesPool__PoolFull();

    function initialize(
        address optionToken_,
        address quoteToken_,
        uint256 strikePrice_,
        uint64 maturityTimestamp_,
        uint64 minPricePerToken_,
        address factory_
    ) external {
        if (initialized) revert SeriesPool__AlreadyInitialized();
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        initialized = true;
        optionToken = OptionToken(optionToken_);
        quoteToken = IConfidentialQuoteToken(quoteToken_);
        strikePrice = strikePrice_;
        maturityTimestamp = maturityTimestamp_;
        minPricePerToken = minPricePerToken_;
        factory = factory_;

        _encPoolBalance = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);
        FHE.allowThis(_encPoolBalance);
    }

    // ── Seller: deposit ────────────────────────────────────────────────────

    /// @notice Seller locks encrypted option tokens into the pool.
    ///         Deposit amount is never revealed — pool balance stays encrypted.
    function deposit(externalEuint64 encAmount, bytes calldata proof) external {
        if (block.timestamp >= maturityTimestamp) revert SeriesPool__AlreadyMatured();
        if (!hasSeller[msg.sender]) {
            if (sellers.length >= MAX_SELLERS) revert SeriesPool__PoolFull();
            sellers.push(msg.sender);
            hasSeller[msg.sender] = true;
            encShares[msg.sender] = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);
            encAccumulatedQuote[msg.sender] = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);
            FHE.allowThis(encShares[msg.sender]);
            FHE.allowThis(encAccumulatedQuote[msg.sender]);
        }

        euint64 amount = FHE.fromExternal(encAmount, proof);

        // Pull tokens from seller into this pool
        optionToken.pullFrom(msg.sender, amount);

        // Update seller's share and pool balance
        euint64 newShare = FHE.add(encShares[msg.sender], amount);
        encShares[msg.sender] = newShare;
        FHE.allowThis(newShare);
        FHE.allow(newShare, msg.sender);

        euint64 newBalance = FHE.add(_encPoolBalance, amount);
        _encPoolBalance = newBalance;
        FHE.allowThis(newBalance);

        emit Deposited(msg.sender);
    }

    // ── Buyer: fill ────────────────────────────────────────────────────────

    /// @notice Buyer attempts to purchase option tokens from the pool.
    ///         Uses same FHE matching logic as ConfidentialMatchingEngine:
    ///           C1: payment >= expected * minPricePerToken / SCALE
    ///           C2: poolBalance >= expected
    ///         If both pass: tokens go to buyer, quote accumulates to sellers (FIFO).
    ///         If either fails: full refund, nothing leaked.
    function fill(
        externalEuint64 encPayment,
        externalEuint64 encExpected,
        bytes calldata paymentProof,
        bytes calldata expectedProof
    ) external {
        if (block.timestamp >= maturityTimestamp) revert SeriesPool__AlreadyMatured();

        euint64 payment = FHE.fromExternal(encPayment, paymentProof);
        euint64 expected = FHE.fromExternal(encExpected, expectedProof);

        // Escrow buyer's payment using the internal handle already decoded by this pool.
        FHE.allow(payment, address(quoteToken));
        quoteToken.confidentialTransferFrom(msg.sender, address(this), payment);

        // Compute minimum required payment: expected * minPricePerToken / SCALE
        euint64 encRequired = FHE.div(FHE.mul(expected, FHE.asEuint64(minPricePerToken)), SCALE);

        // FHE match checks
        ebool c1 = FHE.ge(payment, encRequired); // buyer pays enough
        ebool c2 = FHE.ge(_encPoolBalance, expected); // pool has enough
        ebool matched = FHE.and(c1, c2);

        // Tokens transferred to buyer (0 if no match)
        euint64 filled =
            FHE.select(matched, FHE.min(_encPoolBalance, expected), FHE.asEuint64(ProtocolConstants.ZERO_UINT64));
        // Quote kept by pool (0 if no match)
        euint64 kept = FHE.select(matched, encRequired, FHE.asEuint64(ProtocolConstants.ZERO_UINT64));
        // Refund to buyer
        euint64 refund = FHE.sub(payment, kept);

        // Update pool balance
        euint64 newBalance = FHE.sub(_encPoolBalance, filled);
        _encPoolBalance = newBalance;
        FHE.allowThis(newBalance);

        // Transfer tokens to buyer via authorizedTransfer (pool → buyer)
        FHE.allow(filled, msg.sender);
        optionToken.authorizedTransfer(address(this), msg.sender, filled);

        // Refund excess quote to buyer
        FHE.allow(refund, address(quoteToken));
        FHE.allow(refund, msg.sender);
        quoteToken.confidentialTransfer(msg.sender, refund);

        // Distribute earned quote to sellers in FIFO order
        _distributeToSellers(filled, kept);

        emit Filled(msg.sender);
    }

    // ── Seller: withdraw ───────────────────────────────────────────────────

    /// @notice Seller withdraws their remaining option tokens and accumulated quote.
    ///         Can be called at any time (before or after maturity).
    function withdraw() external {
        euint64 remainingTokens = encShares[msg.sender];
        euint64 earnedQuote = encAccumulatedQuote[msg.sender];

        // Zero out before transfer (re-entrancy protection)
        encShares[msg.sender] = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);
        encAccumulatedQuote[msg.sender] = FHE.asEuint64(ProtocolConstants.ZERO_UINT64);
        FHE.allowThis(encShares[msg.sender]);
        FHE.allowThis(encAccumulatedQuote[msg.sender]);

        // Update pool balance
        euint64 newBalance = FHE.sub(_encPoolBalance, remainingTokens);
        _encPoolBalance = newBalance;
        FHE.allowThis(newBalance);

        // Return remaining tokens to seller
        FHE.allow(remainingTokens, msg.sender);
        optionToken.authorizedTransfer(address(this), msg.sender, remainingTokens);

        // Return accumulated quote to seller
        FHE.allow(earnedQuote, address(quoteToken));
        FHE.allow(earnedQuote, msg.sender);
        quoteToken.confidentialTransfer(msg.sender, earnedQuote);

        emit Withdrawn(msg.sender);
    }

    // ── Internal ───────────────────────────────────────────────────────────

    /// @notice Walk sellers FIFO, drain `filled` tokens and distribute proportional quote.
    ///         All arithmetic stays in FHE — no amounts revealed.
    function _distributeToSellers(
        euint64 filled,
        euint64 /* kept */
    )
        internal
    {
        euint64 remaining = filled; // tokens left to account for
        uint256 n = sellers.length;

        for (uint256 i = 0; i < n; i++) {
            address seller = sellers[i];

            // How many tokens came from this seller this fill
            euint64 taken = FHE.min(remaining, encShares[seller]);

            // Reduce seller's share
            euint64 newShare = FHE.sub(encShares[seller], taken);
            encShares[seller] = newShare;
            FHE.allowThis(newShare);
            FHE.allow(newShare, seller);

            // Reduce remaining
            remaining = FHE.sub(remaining, taken);

            // Quote earned by this seller: taken * minPricePerToken / SCALE
            // (proportional to how many of their tokens were sold)
            euint64 quoteEarned = FHE.div(FHE.mul(taken, FHE.asEuint64(minPricePerToken)), SCALE);
            euint64 newQuote = FHE.add(encAccumulatedQuote[seller], quoteEarned);
            encAccumulatedQuote[seller] = newQuote;
            FHE.allowThis(newQuote);
            FHE.allow(newQuote, seller);
        }

        // Any rounding dust in `kept` that exceeds distributed quote stays in pool
        // and is effectively a tiny protocol fee. This is bounded by n * (SCALE-1) / SCALE.
    }

    // ── View ───────────────────────────────────────────────────────────────

    function sellerCount() external view returns (uint256) {
        return sellers.length;
    }

    function encPoolBalance() external view returns (euint64) {
        return _encPoolBalance;
    }
}
