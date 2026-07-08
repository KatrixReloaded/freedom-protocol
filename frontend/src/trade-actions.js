import { MATCHING_ENGINE_SELECTORS } from "./config.js";
import { encodeCall, isAddress } from "./abi.js";
import { authorizeConfidentialToken } from "./cweth-authorization.js";
import { encryptAmount } from "./encryption.js";
import { parseUnits } from "./format.js";
import { quoteTokenForAddress, selectedCreateAmountRaw, selectedCreateSide, selectedQuoteToken } from "./trade-pricing.js";

function createTradeActions(ctx) {
  const { activeFactoryConfig, isWrongNetwork, maturityTimestamp, render, selectedSeries, sendTx, setToast, setTx, state, updateTx } = ctx;

  async function runCreateTradeListing() {
    const blocked = tradeBlocked("tradeCreateQuoteToken");
    if (blocked) return setToast(blocked);
    const series = selectedSeries();
    const factory = activeFactoryConfig();
    const engine = factory.matchingEngine || "";
    const quote = selectedQuoteToken(state, factory, "tradeCreateQuoteToken");
    const minReceive = parseUnits(state.form.tradeMinReceive || "", quote.decimals);
    const side = selectedCreateSide(state.form);
    const token = side === "P" ? series?.stable_token : side === "N" ? series?.up_token : "";
    const amount = selectedCreateAmountRaw(state.form);
    if (!isAddress(quote.address)) return setToast(`${quote.symbol} is not configured.`);
    if (!isAddress(token)) return setToast(side ? `${side} token is not created.` : "Enter P or N amount to sell.");
    if (!amount || amount <= 0n) return setToast("Enter amount to sell.");
    if (!minReceive || minReceive <= 0n) return setToast("Enter minimum receive.");

    try {
      setTx([`Encrypt ${side} listing amount`, "Encrypt minimum receive", `Create ${side} confidential listing`]);
      updateTx(0, { status: "submitted" });
      const encAmount = await encryptAmount({
        contractAddress: engine,
        userAddress: state.wallet.account,
        value: amount,
        fhe: factory.fhe
      });
      updateTx(0, { status: "confirmed" });
      updateTx(1, { status: "submitted" });
      const encMinReceive = await encryptAmount({
        contractAddress: engine,
        userAddress: state.wallet.account,
        value: minReceive,
        fhe: factory.fhe
      });
      updateTx(1, { status: "confirmed" });
      const data = encodeCall(MATCHING_ENGINE_SELECTORS.createListing, [
        { type: "address", value: token },
        { type: "address", value: quote.address },
        { type: "uint", value: BigInt(state.form.strike) },
        { type: "uint", value: BigInt(maturityTimestamp()) },
        { type: "bytes32", value: encAmount.handle },
        { type: "bytes32", value: encMinReceive.handle },
        { type: "bytes", value: encAmount.proof },
        { type: "bytes", value: encMinReceive.proof }
      ]);
      updateTx(2, { status: "submitted" });
      const hash = await sendTx(engine, data, 0n);
      await waitForTransactionReceipt(hash);
      updateTx(2, { status: "confirmed", hash });
      state.form.tradeSellAmount = "";
      state.form.tradeMinReceive = "";
      setToast(`${side}/${quote.symbol} confidential listing submitted.`);
    } catch (error) {
      markTradeFailed(error);
    }
  }

  async function runFillTradeListing(listing = selectedTradeListing()) {
    const blocked = tradeBlocked();
    if (blocked) return setToast(blocked);
    const context = fillListingContext(listing);
    if (context.error) return setToast(context.error);
    const { engine, factory, quote, listingId } = context;
    const payment = parseUnits(state.form.tradeFillPayment || "", quote.decimals);
    const expected = parseUnits(state.form.tradeFillExpected || "", 6);
    if (!payment || payment <= 0n) return setToast("Enter payment amount.");
    if (!expected || expected <= 0n) return setToast("Enter expected receive amount.");

    try {
      setTx([`Authorize ${quote.symbol} engine`, "Encrypt payment", "Encrypt expected receive", "Fill confidential listing"]);
      updateTx(0, { status: "submitted" });
      const auth = await authorizeConfidentialToken({
        token: quote.address,
        vault: engine,
        userAddress: state.wallet.account,
        amount: payment,
        sendTx,
        fhe: factory.fhe,
        mode: quote.authMode,
        operatorUntil: quote.operatorUntil
      });
      if (auth.hash) await waitForTransactionReceipt(auth.hash);
      updateTx(0, { status: "confirmed", hash: auth.hash || "" });
      updateTx(1, { status: "submitted" });
      const encPayment = await encryptAmount({
        contractAddress: engine,
        userAddress: state.wallet.account,
        value: payment,
        fhe: factory.fhe
      });
      updateTx(1, { status: "confirmed" });
      updateTx(2, { status: "submitted" });
      const encExpected = await encryptAmount({
        contractAddress: engine,
        userAddress: state.wallet.account,
        value: expected,
        fhe: factory.fhe
      });
      updateTx(2, { status: "confirmed" });
      const data = encodeCall(MATCHING_ENGINE_SELECTORS.fill, [
        { type: "uint", value: listingId },
        { type: "bytes32", value: encPayment.handle },
        { type: "bytes32", value: encExpected.handle },
        { type: "bytes", value: encPayment.proof },
        { type: "bytes", value: encExpected.proof }
      ]);
      updateTx(3, { status: "submitted" });
      const hash = await sendTx(engine, data, 0n);
      await waitForTransactionReceipt(hash);
      updateTx(3, { status: "confirmed", hash });
      state.form.tradeFillPayment = "";
      state.form.tradeFillExpected = "";
      setToast("Confidential fill submitted.");
    } catch (error) {
      markTradeFailed(error);
    }
  }

  async function runCancelTradeListing(listing) {
    const blocked = tradeBlocked();
    if (blocked) return setToast(blocked);
    if (!listing?.listingId) return setToast("Select a listing.");
    const engine = activeFactoryConfig().matchingEngine || "";
    try {
      setTx(["Cancel confidential listing"]);
      const data = encodeCall(MATCHING_ENGINE_SELECTORS.cancelListing, [{ type: "uint", value: BigInt(listing.listingId) }]);
      updateTx(0, { status: "submitted" });
      const hash = await sendTx(engine, data, 0n);
      await waitForTransactionReceipt(hash);
      updateTx(0, { status: "confirmed", hash });
      setToast("Cancel submitted.");
    } catch (error) {
      markTradeFailed(error);
    }
  }

  function selectedTradeListing() {
    const id = String(state.form.tradeSelectedListingId || "");
    return (state.trade.listings || []).find((listing) => listingSelectionKey(listing) === id) || null;
  }

  function listingSelectionKey(listing) {
    return String(listing?.id || `${listing?.engineAddress || ""}:${listing?.listingId || ""}`);
  }

  function tradeBlocked(quoteKey = "") {
    const factory = activeFactoryConfig();
    if (state.mode !== "confidential") return "Switch to confidential mode.";
    if (!state.wallet.connected) return "Connect wallet.";
    if (isWrongNetwork()) return "Switch network.";
    if (!isAddress(state.wallet.account)) return "Wallet account is not ready.";
    if (!isAddress(factory.matchingEngine)) return "Matching engine is not configured.";
    if (quoteKey) {
      const quote = selectedQuoteToken(state, factory, quoteKey);
      if (!isAddress(quote.address)) return `${quote.symbol} address missing from env.`;
    }
    return "";
  }

  function fillListingContext(listing) {
    const factory = activeFactoryConfig();
    const activeEngine = factory.matchingEngine || "";
    const listingEngine = isAddress(listing?.engineAddress) ? listing.engineAddress : "";
    const engine = listingEngine || activeEngine;
    const quote = quoteTokenForAddress(listing?.quoteToken, factory);
    const token = listing?.tokenAddress || listing?.token || "";
    const listingIdText = String(listing?.listingId ?? "");
    const error = fillListingError({ listing, activeEngine, engine, quote, token, listingIdText });
    return {
      error,
      factory,
      engine,
      authorizationTarget: engine,
      encryptionTarget: engine,
      activeEngine,
      confidentialFactory: factory.factory || "",
      cWETH: factory.cWETH || "",
      quote,
      quoteToken: listing?.quoteToken || "",
      token,
      tokenSide: listing?.side || listing?.tokenSide || "",
      listingId: error ? 0n : BigInt(listingIdText),
      listingIdText,
      listing,
      chainId: Number(factory.chain?.chainId || state.wallet.chainId || 0),
      walletChainId: Number(state.wallet.chainId || 0),
      listingChainId: Number(listing?.chainId || 0),
      engineMatchesActive: !listingEngine || sameAddress(listingEngine, activeEngine),
      quoteMatchedConfigured: Boolean(quote)
    };
  }

  function fillListingError({ listing, activeEngine, engine, quote, token, listingIdText }) {
    if (!listing) return "Select a listing.";
    if (!listingIdText || !/^\d+$/.test(listingIdText)) return "Listing id is invalid.";
    if (listing.chainId && state.wallet.chainId && Number(listing.chainId) !== Number(state.wallet.chainId)) return "Stale listing: wrong chain.";
    if (listing.mode && String(listing.mode).toLowerCase() !== "confidential") return "Stale listing: not a confidential listing.";
    if (listing.active === false) return "Listing is not active.";
    if (!isAddress(engine)) return "Matching engine is not configured.";
    if (listing.engineAddress && !isAddress(listing.engineAddress)) return "Listing engine is invalid.";
    if (isAddress(listing.engineAddress) && isAddress(activeEngine) && !sameAddress(listing.engineAddress, activeEngine)) {
      return "Stale listing from a previous matching engine.";
    }
    if (!isAddress(token)) return "Listing token is invalid.";
    if (!isAddress(listing.quoteToken)) return "Listing quote token is invalid.";
    if (!quote || !isAddress(quote.address)) return "Listing quote token is not configured.";
    return "";
  }

  function sameAddress(a, b) {
    return String(a || "").toLowerCase() === String(b || "").toLowerCase();
  }

  async function waitForTransactionReceipt(hash) {
    for (let i = 0; i < 60; i++) {
      const receipt = await window.ethereum?.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null);
      if (receipt) return receipt;
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    return null;
  }

  function markTradeFailed(error) {
    const index = Math.max(
      0,
      state.tx.findIndex((step) => step.status === "pending" || step.status === "submitted")
    );
    if (state.tx[index]) updateTx(index, { status: "failed" });
    setToast(normalizeTradeError(error));
    render();
  }

  function normalizeTradeError(error) {
    const message = String(error?.message || error || "");
    if (/user rejected|denied|rejected request/i.test(message)) return "User rejected signature.";
    if (/not configured|missing|invalid address/i.test(message)) return message;
    if (/gas limit too high|gas required exceeds|execution reverted|estimateGas|simulation/i.test(message)) {
      return "Fill failed during contract simulation. Check listing freshness, quote token authorization, or contract ACL.";
    }
    return message.length > 140 ? "Trade transaction failed." : message || "Trade transaction failed.";
  }

  return { runCancelTradeListing, runCreateTradeListing, runFillTradeListing };
}

export { createTradeActions };
