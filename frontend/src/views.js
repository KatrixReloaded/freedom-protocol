import { PUBLIC_COLLATERAL_OPTION_SCALE, SCALE } from "./config.js";
import { isAddress } from "./abi.js";
import { button, field, h, labelWithInfo, segmented } from "./dom.js";
import {
  decimalInput,
  decimalTextAttrs,
  formatAddress,
  formatDateTime,
  formatProtocolUnits,
  formatTokenUnits,
  maturitySlotOptions,
  numericTextAttrs,
  parseUnits,
} from "./format.js";
import {
  fairQuoteRawForOptionRaw,
  pnlPercentText,
  quoteTokenForAddress,
  quoteTokenOptions,
  selectedCreateAmountRaw,
  selectedCreateSide,
  selectedQuoteToken
} from "./trade-pricing.js";

function createViews(ctx) {
  const {
    state,
    routes,
    balanceDisplay,
    balanceRetrySeconds,
    collateralSymbol,
    defaultStrike,
    ethPrice,
    activeFactoryConfig,
    targetChainConfig,
    connectWallet,
    disconnectWallet,
    handleNetworkAction,
    isWrongNetwork,
    maturityTimestamp,
    navigate,
    networkActionTitle,
    networkLabel,
    networkStateClass,
    optionBalanceText,
    publicSeriesChainMismatch,
    refreshBridgeRequests,
    refreshPublicCollateralBalance,
    refreshSelectedSeries,
    refreshActiveSeries,
    refreshTradeListings,
    revealBalance,
    runClaim,
    runDeposit,
    runCancelTradeListing,
    runCreateTradeListing,
    runFillTradeListing,
    runShieldBridge,
    runWrapWeth,
    selectedSeries,
    setMode,
    selectActiveSeries,
    marketApiUrl,
    maxStrike,
    hideReveal,
    statusFor,
    switchToZama,
    timeToMaturity,
    updateForm
  } = ctx;

  function pageHeader(title, subtitle) {
    return h("section", { class: "page-head" }, [h("div", {}, [h("h1", {}, title), h("p", {}, subtitle)])]);
  }

  function modeSwitch() {
    return segmented("Mode", ["public", "confidential"], state.mode, setMode);
  }

  function networkPanel() {
    if (state.mode !== "confidential") return null;
    const wrong = state.wallet.connected && isWrongNetwork();
    if (!wrong) return null;
    const target = targetChainConfig();
    return h("section", { class: "notice blocking" }, [
      h("div", {}, [
        h("strong", {}, "Wrong network for confidential mode."),
        h("p", {}, `Switch to ${target?.label || `chain ${target?.chainId || ""}`} to use the configured confidential deployment.`)
      ]),
      button("Switch network", { variant: "primary", onclick: switchToZama })
    ]);
  }

  function seriesSelector({ side = false } = {}) {
    const series = selectedSeries();
    const displaySeries = series;
    const price = ethPrice();
    const strikeDefault = defaultStrike();
    const strikeMax = maxStrike();
    const isSettleRoute = state.route === "/settle";
    const useDateTimeMaturity = ["deposit", "trade", "shield", "settle"].includes(state.route.replace("/", ""));
    const formGridClass = isSettleRoute && !side ? "form-grid two" : useDateTimeMaturity ? "form-grid two series-datetime-grid" : "form-grid three";

    return h("section", { class: "panel series-panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Series"), h("span", { class: `status ${statusFor(displaySeries).toLowerCase().replace(" ", "-")}` }, statusFor(displaySeries))]),
      h("div", { class: formGridClass }, [
        field(
          "strike",
          labelWithInfo(
            "Strike price",
            isSettleRoute
              ? "Positive multiple of $50. Historical settled series can be redeemed even if the strike is above today's default deposit range."
              : `Positive multiple of $50. Default is the closest $50 multiple at or below 50% of ETH price: $${strikeDefault}.`
          ),
          h("input", numericTextAttrs({
            id: "strike",
            min: "1",
            max: isSettleRoute ? null : String(strikeMax),
            step: "1",
            value: state.form.strike,
            oninput: (event) => updateForm("strike", ctx.strikeInput(event.target.value))
          }))
        ),
        maturityField(useDateTimeMaturity),
        side
          ? h("div", { class: "field series-trailing" }, [h("span", { class: "field-label" }, "Token side"), segmented("Side", ["P", "N"], state.form.side, (value) => updateForm("side", value))])
          : isSettleRoute
            ? null
            : h("div", { class: "metric series-metric series-trailing" }, [h("span", {}, "ETH price"), h("strong", {}, ethPriceText(price))])
      ]),
      compactDetails(displaySeries)
    ]);
  }

  function maturityField(useDateTimeInput) {
    if (useDateTimeInput) {
      return field(
        "maturity",
        labelWithInfo("Maturity date/time", "Select a maturity date and time. The value is interpreted in your local timezone and must align to a 10-minute slot."),
        h("input", {
          type: "datetime-local",
          id: "maturity",
          step: "600",
          value: localDateTimeValue(state.form.maturity),
          oninput: (event) => updateForm("maturity", timestampFromLocalDateTime(event.target.value))
        }),
        state.form.maturity ? `${state.form.maturity} / ${formatDateTime(state.form.maturity)} UTC` : ""
      );
    }
    return field(
      "maturity",
      labelWithInfo("Maturity slot", "PoC series use 10-minute maturity slots. New deposits require a future slot."),
      h("select", {
        id: "maturity",
        value: state.form.maturity,
        onchange: (event) => updateForm("maturity", event.target.value)
      }, maturitySlotOptions({ includePast: state.route === "/trade" || state.route === "/shield", selected: state.form.maturity }).map((slot) =>
        h("option", { value: slot }, `${formatDateTime(slot)} UTC`)
      ))
    );
  }

  function ethPriceText(price) {
    return `$${Number(price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function receivePreviewAmount() {
    if (state.mode !== "public") return state.form.amount || "0.000000";
    const raw = parseUnits(state.form.amount || "0", 18) || 0n;
    const optionRaw = raw / PUBLIC_COLLATERAL_OPTION_SCALE;
    return formatTokenUnits(optionRaw, 6, 6);
  }

  function localDateTimeValue(timestamp) {
    const date = new Date(Number(timestamp || 0) * 1000);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function timestampFromLocalDateTime(value) {
    const timestamp = Math.floor(new Date(value).getTime() / 1000);
    return Number.isFinite(timestamp) && timestamp > 0 ? String(timestamp) : "";
  }

  function compactDetails(series) {
    const exists = series?.exists;
    return h("details", { class: "details" }, [
      h("summary", {}, "Token details"),
      h("div", { class: "details-grid" }, [
        detail("P stableETH", series?.stable_token ? formatAddress(series.stable_token) : "Not created", series?.stable_token),
        detail("N upETH", series?.up_token ? formatAddress(series.up_token) : "Not created", series?.up_token),
        detail("Series", exists ? "Registered" : "Predicted")
      ])
    ]);
  }

  function detail(label, value, copyValue) {
    return h("div", { class: "detail" }, [
      h("span", {}, label),
      h("button", { type: "button", class: "copy", onclick: () => copyValue && navigator.clipboard?.writeText(copyValue) }, value)
    ]);
  }

  function amountInput({ id, label, valueKey, symbol }) {
    const balance = balanceDisplay(symbol);
    const canUseMax = state.wallet.connected && !isWrongNetwork() && balance.max;
    const retryWait = balanceRetrySeconds();
    const canRetryBalance = state.mode === "public" && state.balances.publicCollateral.status === "error";
    return field(
      id,
      label,
      h("div", { class: "amount-row" }, [
        h("input", decimalTextAttrs({
          id,
          min: "0",
          step: "0.000001",
          placeholder: "0.000000",
          value: state.form[valueKey],
          oninput: (event) => updateForm(valueKey, decimalInput(event.target.value))
        })),
        h("span", { class: "token" }, symbol),
        button(canRetryBalance ? "Retry" : "Max", {
          disabled: canRetryBalance ? retryWait > 0 : !canUseMax,
          title: balance.hint,
          onclick: () => {
            if (canRetryBalance) refreshPublicCollateralBalance(true);
            else if (balance.max) updateForm(valueKey, balance.max);
          }
        })
      ]),
      balance.hint
    );
  }

  function txStepper() {
    if (!state.tx.length) return null;
    return h("section", { class: "panel tx-panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Transaction"), h("span", {}, `${state.tx.filter((step) => step.status === "confirmed").length}/${state.tx.length}`)]),
      h(
        "ol",
        { class: "tx-steps" },
        state.tx.map((step) =>
          h("li", { class: step.status }, [
            h("span", { class: "dot" }),
            h("div", {}, [
              h("strong", {}, step.label),
              h("small", {}, step.hash ? txLink(step.hash) : labelForStatus(step.status))
            ])
          ])
        )
      )
    ]);
  }

  function labelForStatus(status) {
    return {
      idle: "Waiting",
      pending: "Pending signature",
      submitted: "Submitted",
      confirmed: "Confirmed",
      failed: "Failed",
      unknown: "Unknown"
    }[status];
  }

  function txLink(hash) {
    const href = txExplorerUrl(hash);
    if (!href) return formatAddress(hash);
    return h("a", { class: "tx-link", href, target: "_blank", rel: "noreferrer" }, formatAddress(hash));
  }

  function txExplorerUrl(hash) {
    if (!hash) return "";
    const chainId = Number(activeFactoryConfig().chain?.chainId || state.wallet.chainId || 0);
    if (chainId !== 11155111) return "";
    return `https://sepolia.etherscan.io/tx/${hash}`;
  }

  function pageClass() {
    return state.animatePage ? "page enter" : "page";
  }

  function depositPage() {
    const series = selectedSeries();
    const amount = receivePreviewAmount();
    const symbol = collateralSymbol(series);
    const activeSeriesError = selectedActiveSeriesError();
    return h("main", { class: pageClass() }, [
      pageHeader("Deposit", "Pay with ETH or WETH to split WETH reserves into equal P stableETH and N upETH tokens."),
      networkPanel(),
      h("div", { class: "layout two" }, [
        h("section", { class: "panel" }, [
          h("div", { class: "panel-title" }, [h("h2", {}, "Deposit"), h("span", {}, state.mode === "public" ? "plaintext" : "encrypted")]),
          state.mode === "public"
            ? h("div", { class: "field" }, [h("span", { class: "field-label" }, "Pay with"), segmented("Payment asset", publicPaymentOptions(), state.form.collateral, (value) => updateForm("collateral", value))])
            : encryptedBalance("cWETH balance"),
          publicWethAcquirePanel(),
          amountInput({ id: "deposit-amount", label: "Amount", valueKey: "amount", symbol }),
          h("div", { class: "receive-box" }, [
            h("span", {}, "You receive"),
            h("div", {}, [h("strong", {}, `P stableETH-${state.form.strike}-${maturityTimestamp()}`), h("b", {}, `${amount} P`)]),
            h("div", {}, [h("strong", {}, `N upETH-${state.form.strike}-${maturityTimestamp()}`), h("b", {}, `${amount} N`)]),
            series && !series.exists ? h("p", {}, "This series does not exist yet. Your transaction will create it and mint both tokens.") : null,
            state.mode === "confidential" ? h("p", {}, "Amounts remain encrypted on-chain.") : null
          ]),
          confidentialAcquirePanel(),
          activeSeriesError ? h("p", { class: "error-text" }, activeSeriesError) : null,
          h("div", { class: "actions" }, [
            button("Confirm", { variant: "primary", onclick: runDeposit, disabled: Boolean(activeSeriesError), title: activeSeriesError || "" })
          ])
        ]),
        h("div", { class: "stack" }, [seriesSelector(), txStepper()])
      ]),
      activeSeriesPanel()
    ]);
  }

  function activeSeriesPanel() {
    const status = state.activeSeries.status;
    const rows = state.activeSeries.rows || [];
    return h("section", { class: "panel active-series-panel" }, [
      h("div", { class: "panel-title" }, [
        h("h2", {}, "Active series"),
        h("button", {
          class: `icon-button refresh-icon ${status === "loading" ? "spinning" : ""}`.trim(),
          type: "button",
          title: status === "loading" ? "Refreshing active series" : "Refresh active series",
          "aria-label": status === "loading" ? "Refreshing active series" : "Refresh active series",
          disabled: status === "loading",
          onclick: refreshActiveSeries
        }, "↻")
      ]),
      activeSeriesStatus(status, rows),
      rows.length ? h("div", { class: "active-series-list" }, rows.map(activeSeriesRow)) : null
    ]);
  }

  function activeSeriesStatus(status, rows) {
    if (status === "loading") return h("p", { class: "field-hint" }, "Loading active series...");
    if (status === "error") return h("p", { class: "field-hint" }, state.activeSeries.error || "Active series unavailable. Manual entry still works.");
    if (status === "unconfigured") return h("p", { class: "field-hint" }, "Active series unavailable. Manual entry still works.");
    if (!rows.length) return h("p", { class: "field-hint" }, "No active series found for this chain and mode. Manual entry still works.");
    return null;
  }

  function activeSeriesRow(row) {
    const selected = isSelectedActiveSeries(row);
    const invalid = activeSeriesStrikeError(row);
    return h("button", {
      class: `active-series-row ${selected ? "selected" : ""} ${invalid ? "invalid" : ""}`.trim(),
      type: "button",
      onclick: () => selectActiveSeries(row)
    }, [
      h("span", {}, [h("small", {}, "Strike"), h("strong", {}, `$${row.strikePrice}`)]),
      h("span", {}, [h("small", {}, "Maturity"), h("strong", {}, `${formatDateTime(row.maturityTimestamp)} UTC`)]),
      h("span", {}, [h("small", {}, "Mode / factory"), h("strong", {}, `${row.mode || state.mode} ${row.factoryAddress ? formatAddress(row.factoryAddress) : ""}`.trim())]),
      h("span", {}, [h("small", {}, "Status"), h("strong", { class: "status active" }, row.status || "active")]),
      invalid ? h("small", { class: "error-text active-series-error" }, "Strike price is too high for the current market price.") : null
    ]);
  }

  function isSelectedActiveSeries(row) {
    return String(row.strikePrice) === String(state.form.strike) && String(row.maturityTimestamp) === String(maturityTimestamp());
  }

  function selectedActiveSeriesError() {
    const selected = (state.activeSeries.rows || []).find(isSelectedActiveSeries);
    return selected ? activeSeriesStrikeError(selected) : "";
  }

  function activeSeriesStrikeError(row) {
    if (state.mode !== "public") return "";
    const strike = Number(row.strikePrice || 0);
    const marketMax = Number(ethPrice() || 0) / 2;
    if (strike > marketMax) return "Strike price is too high for the current market price.";
    return "";
  }

  function confidentialAcquirePanel() {
    if (state.mode !== "confidential") return null;
    const factory = activeFactoryConfig();
    const target = targetChainConfig();
    const rows = [
      ["Factory", factory.factory ? "configured" : "missing factory"],
      ["cWETH", factory.cWETH ? "configured" : "missing cWETH address"],
      ["cWETH auth", factory.cwethAuthMode || "allowance"],
      ["Network", isWrongNetwork() ? `switch to ${target?.chainId || "configured chain"}` : "ready"],
      ["FHE SDK", state.fhe.status === "error" ? state.fhe.error : state.fhe.status === "loading" ? "loading" : "loads on confirm"],
      ["cWETH acquisition", "use Zama test token faucet/mint from docs"]
    ];
    return h("details", { class: "inline-drawer" }, [
      h("summary", {}, "Confidential readiness"),
      h("div", { class: "details-grid" }, rows.map(([label, value]) => detail(label, value))),
      h("div", { class: "drawer-actions" }, [
        button("Mint test cWETH", { disabled: true, title: "Use Zama test token faucet/mint from docs. cWETH mint ABI is not verified." })
      ])
    ]);
  }

  function publicWethAcquirePanel() {
    if (state.mode !== "public" || state.form.collateral !== "WETH") return null;
    const factory = activeFactoryConfig();
    if (!factory.collateralToken) return null;
    const balance = state.balances.publicCollateral;
    const lacksWeth = state.wallet.connected && !isWrongNetwork() && balance.status === "ready" && BigInt(balance.raw || 0) === 0n;
    if (!lacksWeth && !state.form.wrapAmount) return null;
    return h("details", { class: "inline-drawer compact", open: lacksWeth ? "open" : null }, [
      h("summary", {}, "Get WETH for WETH payment"),
      h("div", { class: "amount-row" }, [
        h("input", decimalTextAttrs({
          id: "wrap-amount",
          min: "0",
          step: "0.000001",
          placeholder: "0.000000",
          value: state.form.wrapAmount,
          oninput: (event) => updateForm("wrapAmount", decimalInput(event.target.value, 18))
        })),
        h("span", { class: "token" }, "ETH"),
        button("Wrap", {
          variant: "primary",
          disabled: !state.wallet.connected || isWrongNetwork() || !state.form.wrapAmount,
          title: "Calls WETH9.deposit() payable directly from your wallet.",
          onclick: runWrapWeth
        })
      ]),
      h("p", { class: "field-hint" }, "Optional helper for WETH deposits. ETH deposits do not require wrapping.")
    ]);
  }

  function publicPaymentOptions() {
    const assets = activeFactoryConfig().paymentAssets;
    return Array.isArray(assets) && assets.length ? assets : ["ETH", "WETH"];
  }

  function encryptedBalance(label) {
    const factory = activeFactoryConfig();
    const tokenAddress = factory.cWETH;
    const key = confidentialRevealKey("deposit-cweth", tokenAddress);
    const entry = state.reveal[key] || { status: "idle", value: "", error: "" };
    if (!state.wallet.connected) {
      return h("div", { class: "encrypted-line error-line" }, [
        h("span", {}, label),
        h("strong", { class: "masked" }, "null"),
        button("Connect wallet", { disabled: true })
      ]);
    }
    if (isWrongNetwork()) {
      return h("div", { class: "encrypted-line error-line" }, [
        h("span", {}, label),
        h("strong", { class: "masked" }, "null"),
        button("Wrong network", { disabled: true })
      ]);
    }
    if (!tokenAddress) {
      return h("div", { class: "encrypted-line error-line" }, [
        h("span", {}, label),
        h("strong", { class: "masked" }, "null"),
        button("Missing cWETH", { disabled: true })
      ]);
    }
    return h("div", { class: "encrypted-line" }, [
      h("span", {}, label),
      h("strong", { class: entry.status === "ready" ? "revealed" : "masked" }, revealText(entry)),
      depositRevealButton({ key, tokenAddress, entry }),
      entry.error ? h("small", { class: "error-text reveal-error" }, entry.error) : null
    ]);
  }

  function tradePage() {
    const series = selectedSeries();
    if (state.mode !== "confidential") {
      return h("main", { class: pageClass() }, [
        pageHeader("Trade", "Confidential OTC listings for P/N tokens."),
        h("section", { class: "panel" }, [
          h("div", { class: "panel-title" }, [h("h2", {}, "Public market"), h("span", {}, "later")]),
          h("div", { class: "empty" }, [
            h("strong", {}, "Public market coming later."),
            h("p", {}, "Switch to confidential mode to create and fill encrypted listings.")
          ])
        ])
      ]);
    }
    return h("main", { class: pageClass() }, [
      pageHeader("Trade", "Create and fill encrypted P/N listings."),
      networkPanel(),
      seriesSelector(),
      tradeIntentSwitch(),
      state.form.tradeIntent === "Sell" ? createListingPanel(series) : confidentialListingsPanel(series),
      userOrders(),
      txStepper(),
      activeSeriesPanel()
    ]);
  }

  function tradeIntentSwitch() {
    const selected = state.form.tradeIntent || "Buy";
    return h("section", { class: "panel trade-mode-panel" }, [
      h("div", { class: "field" }, [
        h("span", { class: "field-label" }, "Action"),
        segmented("Trade action", ["Buy", "Sell"], selected, (value) => updateForm("tradeIntent", value))
      ])
    ]);
  }

  function confidentialListingsPanel(series) {
    const listings = state.trade.listings || [];
    return h("section", { class: "panel market-panel" }, [
      h("div", { class: "panel-title" }, [
        h("h2", {}, "Confidential listings"),
        h("div", { class: "panel-title-actions" }, [
          h("span", {}, tradeStatusText()),
          h("button", {
            class: `icon-button refresh-icon ${state.trade.status === "loading" ? "spinning" : ""}`.trim(),
            type: "button",
            title: "Refresh listings",
            "aria-label": "Refresh listings",
            disabled: state.trade.status === "loading",
            onclick: refreshTradeListings
          }, "↻")
        ])
      ]),
      h("div", { class: "form-grid two market-filter-grid" }, [
        h("div", { class: "field" }, [h("span", { class: "field-label" }, "Side"), segmented("Side filter", ["All", "P", "N"], state.form.tradeSideFilter || "All", (value) => updateForm("tradeSideFilter", value))]),
        h("div", { class: "field" }, [h("span", { class: "field-label" }, "Status"), segmented("Status filter", ["Active", "All"], state.form.tradeActiveFilter || "Active", (value) => updateForm("tradeActiveFilter", value))])
      ]),
      state.trade.error ? h("p", { class: "error-text" }, state.trade.error) : null,
      listings.length
        ? h("div", { class: "trade-list" }, listings.map((listing) => listingRow(listing, series)))
        : h("div", { class: "empty" }, [
            h("strong", {}, state.trade.status === "loading" ? "Loading listings..." : "No listings found."),
            h("p", {}, "Create, fill, and cancel actions submit directly from your wallet.")
          ])
    ]);
  }

  function listingRow(listing, series) {
    const key = listingSelectionKey(listing);
    const selected = String(state.form.tradeSelectedListingId || "") === key;
    const side = listingSide(listing, series);
    const own = isOwnListing(listing);
    const active = Boolean(listing.active);
    return h("article", { class: `trade-row ${selected ? "selected" : ""}`.trim() }, [
      h("div", { class: "trade-row-main" }, [
        h("div", {}, [
          h("strong", {}, `${side} / ${listing.strikePrice ? `$${listing.strikePrice}` : "strike ?"}`),
          h("p", {}, `${formatDateTime(listing.maturityTimestamp)} UTC`)
        ]),
        h("div", { class: "trade-row-actions" }, [
          h("span", { class: `status ${active ? "active" : "settled"}` }, listing.status || (active ? "active" : "inactive")),
          button(selected ? "Hide" : "Fill", {
            disabled: !active || tradeActionDisabled(),
            onclick: () => {
              updateForm("tradeSelectedListingId", selected ? "" : key);
            }
          }),
          own && active
            ? button("Cancel", {
                disabled: tradeActionDisabled(),
                onclick: () => runCancelTradeListing(listing)
              })
            : null
        ])
      ]),
      h("div", { class: "details-grid trade-details" }, [
        detail("Seller", formatAddress(listing.seller), listing.seller),
        detail("Quote token", formatAddress(listing.quoteToken), listing.quoteToken),
        detail("Token", formatAddress(listing.tokenAddress), listing.tokenAddress),
        detail("Fill count", String(listing.fillCount || 0)),
        detail("Listing", `#${listing.listingId || listing.id}`),
        detail("Tx", listing.txHash ? formatAddress(listing.txHash) : "unavailable", listing.txHash)
      ]),
      selected ? fillListingForm(listing, side) : null
    ]);
  }

  function listingSelectionKey(listing) {
    return String(listing?.id || `${listing?.engineAddress || ""}:${listing?.listingId || ""}`);
  }

  function fillListingForm(listing, side) {
    const quote = quoteForListing(listing);
    const fillError = fillListingInlineError(listing, quote);
    const pnl = fillPnlText(listing, side, quote);
    return h("div", { class: "trade-fill" }, [
      h("div", { class: "form-grid two" }, [
        tradeAmountField("trade-fill-payment", "Payment amount", "tradeFillPayment", quote.symbol, quote.decimals),
        tradeAmountField("trade-fill-expected", "Expected receive", "tradeFillExpected", side)
      ]),
      fillError ? h("p", { class: "error-text" }, fillError) : null,
      pnl ? h("p", { class: "field-hint trade-pnl" }, pnl) : null,
      h("div", { class: "actions" }, [
        button("Fill listing", {
          variant: "primary",
          disabled: tradeActionDisabled() || Boolean(fillError) || !state.form.tradeFillPayment || !state.form.tradeFillExpected,
          onclick: () => runFillTradeListing(listing)
        })
      ])
    ]);
  }

  function createListingPanel(series) {
    const quote = selectedQuoteForTrade();
    const selectedSide = state.form.tradeCreateSide || "P";
    const createError = createListingInlineError(series);
    const pnl = createListingPnlText(quote);
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [
        h("h2", {}, labelWithInfo("Create listing", "6 decimal encrypted amount. The backend does not receive encrypted intents.")),
        h("span", {}, `Sell P or N for ${quote.symbol}`)
      ]),
      h("div", { class: "form-grid two trade-form" }, [
        quoteTokenField("tradeCreateQuoteToken"),
        h("div", { class: "field" }, [
          h("span", { class: "field-label" }, "Side"),
          segmented("Create listing side", ["P", "N"], selectedSide, (value) => {
            updateForm("tradeCreateSide", value);
          })
        ]),
        tradeAmountField("trade-sell-amount", `${selectedSide} amount to sell`, "tradeSellAmount", selectedSide),
        tradeAmountField("trade-min-receive", `Minimum ${quote.symbol} receive`, "tradeMinReceive", quote.symbol, quote.decimals)
      ]),
      createError ? h("p", { class: "error-text" }, createError) : null,
      pnl ? h("p", { class: "field-hint trade-pnl" }, pnl) : null,
      h("div", { class: "actions" }, [
        button("Create confidential listing", {
          variant: "primary",
          disabled: tradeActionDisabled() || Boolean(createError) || !createListingAmountEntered() || !createListingMinReceiveEntered(),
          onclick: runCreateTradeListing
        })
      ])
    ]);
  }

  function quoteTokenField(key = "tradeQuoteToken") {
    const options = quoteTokenOptions(activeFactoryConfig());
    const selected = state.form[key] || state.form.tradeQuoteToken || "cWETH";
    const quote = selectedQuoteForTrade(key);
    return field(
      key,
      "Quote token",
      h("select", {
        id: key,
        value: selected,
        onchange: (event) => updateForm(key, event.target.value)
      }, options.map((option) =>
        h("option", { value: option.symbol, selected: option.symbol === selected, disabled: !option.address }, option.address ? option.symbol : `${option.symbol} not configured`)
      )),
      quote.address ? "" : `${selected} not configured.`
    );
  }

  function tradeAmountField(id, label, valueKey, symbol, decimals = 6) {
    return field(
      id,
      label,
      h("div", { class: "amount-row" }, [
        h("input", decimalTextAttrs({
          id,
          min: "0",
          step: "0.000001",
          placeholder: "0.000000",
          value: state.form[valueKey],
          oninput: (event) => updateForm(valueKey, decimalInput(event.target.value, decimals))
        })),
        h("span", { class: "token" }, symbol)
      ]),
      ""
    );
  }

  function createListingInlineError(series) {
    const side = selectedCreateSide(state.form);
    const quote = selectedQuoteForTrade();
    if (!quote.address) return `${quote.symbol} not configured.`;
    if (side === "P" && !series?.stable_token) return "P token is not created for this series.";
    if (side === "N" && !series?.up_token) return "N token is not created for this series.";
    return "";
  }

  function createListingAmountEntered() {
    return (parseUnits(state.form.tradeSellAmount || "", 6) || 0n) > 0n;
  }

  function createListingMinReceiveEntered() {
    const quote = selectedQuoteForTrade();
    return (parseUnits(state.form.tradeMinReceive || "", quote.decimals) || 0n) > 0n;
  }

  function selectedQuoteForTrade(key = "tradeCreateQuoteToken") {
    return selectedQuoteToken(state, activeFactoryConfig(), key);
  }

  function quoteForListing(listing) {
    return quoteTokenForAddress(listing?.quoteToken, activeFactoryConfig()) || {
      symbol: listing?.quoteSymbol || "quote",
      address: "",
      decimals: 6
    };
  }

  function createListingPnlText(quote = selectedQuoteForTrade()) {
    const side = selectedCreateSide(state.form);
    const amount = selectedCreateAmountRaw(state.form);
    const minReceive = parseUnits(state.form.tradeMinReceive || "", quote.decimals) || 0n;
    if (!side || amount <= 0n || minReceive <= 0n) return "";
    const fair = fairQuoteRawForOptionRaw({ state, optionRaw: amount, side, quote });
    if (fair == null || fair <= 0n) return "P&L unavailable";
    return pnlPercentText(minReceive, fair);
  }

  function fillListingInlineError(listing, quote = selectedQuoteForTrade()) {
    const factory = activeFactoryConfig();
    const activeEngine = factory.matchingEngine || "";
    const listingEngine = isAddress(listing?.engineAddress) ? listing.engineAddress : "";
    if (!listing?.listingId || !/^\d+$/.test(String(listing.listingId))) return "Listing id is invalid.";
    if (listing.chainId && state.wallet.chainId && Number(listing.chainId) !== Number(state.wallet.chainId)) return "Stale listing: wrong chain.";
    if (listing.mode && String(listing.mode).toLowerCase() !== "confidential") return "Stale listing: not a confidential listing.";
    if (listing.active === false) return "Listing is not active.";
    if (listing.engineAddress && !isAddress(listing.engineAddress)) return "Listing engine is invalid.";
    if (listingEngine && activeEngine && String(listingEngine).toLowerCase() !== String(activeEngine).toLowerCase()) {
      return "Stale listing from a previous matching engine.";
    }
    if (!isAddress(listing.tokenAddress || listing.token)) return "Listing token is invalid.";
    if (!isAddress(listing.quoteToken)) return "Listing quote token is invalid.";
    if (!quote.address) return "Listing quote token is not configured.";
    return "";
  }

  function fillPnlText(listing, side, quote = selectedQuoteForTrade()) {
    const payment = parseUnits(state.form.tradeFillPayment || "", quote.decimals) || 0n;
    const expected = parseUnits(state.form.tradeFillExpected || "", 6) || 0n;
    if (!side || payment <= 0n || expected <= 0n) return "";
    const expectedValue = fairQuoteRawForOptionRaw({ state, optionRaw: expected, side, quote });
    if (expectedValue == null || expectedValue <= 0n) return "P&L unavailable";
    return pnlPercentText(expectedValue, payment);
  }

  function tradeStatusText() {
    if (!marketApiUrl()) return "indexer not configured";
    if (state.trade.status === "loading") return "loading";
    if (state.trade.status === "error") return "read failed";
    const count = (state.trade.listings || []).length;
    return `${count} ${count === 1 ? "listing" : "listings"}`;
  }

  function listingSide(listing, series = selectedSeries()) {
    if (listing.side) return listing.side;
    const token = String(listing.tokenAddress || "").toLowerCase();
    if (token && token === String(series?.stable_token || "").toLowerCase()) return "P";
    if (token && token === String(series?.up_token || "").toLowerCase()) return "N";
    return "?";
  }

  function isOwnListing(listing) {
    return Boolean(state.wallet.account && listing.seller && String(listing.seller).toLowerCase() === String(state.wallet.account).toLowerCase());
  }

  function tradeActionDisabled() {
    const factory = activeFactoryConfig();
    return !state.wallet.connected || isWrongNetwork() || !factory.matchingEngine || !factory.cWETH;
  }

  function settledPayoutPanel() {
    return h("div", { class: "payout-grid" }, [
      h("div", {}, [h("span", {}, state.mode === "public" ? "P payout rate" : "P fixed payout"), h("strong", {}, payoutText("stablePayout"))]),
      h("div", {}, [h("span", {}, state.mode === "public" ? "N payout rate" : "N fixed payout"), h("strong", {}, payoutText("upPayout"))])
    ]);
  }

  function shieldPage() {
    const factory = activeFactoryConfig();
    const bridge = factory.chain?.bridge || "";
    const isPublicSource = state.mode === "public";
    const shieldInfo = isPublicSource
      ? "The source token is public, so the bridge amount is visible before minting confidential tokens."
      : "Unshield requests public decryption so public tokens can be minted later. Backend keeper finalization is tracked when configured.";
    return h("main", { class: pageClass() }, [
      pageHeader("Shield", isPublicSource ? "Move public P or N into confidential tokens." : "Request public P or N from confidential tokens."),
      networkPanel(),
      h("div", { class: "layout two" }, [
        h("section", { class: "panel" }, [
          h("div", { class: "panel-title" }, [
            h("h2", {}, labelWithInfo(isPublicSource ? "Public to confidential" : "Confidential to public", shieldInfo)),
            h("span", {}, bridge ? formatAddress(bridge) : "missing bridge")
          ]),
          h("div", { class: "field" }, [h("span", { class: "field-label" }, "Token side"), segmented("Side", ["P", "N"], state.form.side, (value) => updateForm("side", value))]),
          field(
            "shield-amount",
            labelWithInfo("Amount", shieldInfo),
            h("div", { class: "amount-row" }, [
              h("input", decimalTextAttrs({
                id: "shield-amount",
                min: "0",
                step: "0.000001",
                placeholder: "0.000000",
                value: state.form.shieldAmount,
                oninput: (event) => updateForm("shieldAmount", decimalInput(event.target.value))
              })),
              h("span", { class: "token" }, state.form.side)
            ])
          ),
          isPublicSource ? null : bridgeStatusPanel(bridge),
          h("div", { class: "actions" }, [
            button(isPublicSource ? "Shield" : "Request unshield", {
              variant: "primary",
              disabled: !state.wallet.connected || isWrongNetwork() || !bridge || !state.form.shieldAmount,
              onclick: runShieldBridge
            })
          ])
        ]),
        h("div", { class: "stack" }, [seriesSelector({ side: true }), txStepper()])
      ])
    ]);
  }

  function bridgeStatusPanel(bridge) {
    const apiUrl = marketApiUrl();
    const requests = state.bridgeRequests;
    const active = requests.active;
    const rows = requests.rows || [];
    const status = active?.status || (apiUrl ? "idle" : "unconfigured");
    const message = bridgeStatusMessage(status);
    return h("div", { class: "inline-drawer compact bridge-status" }, [
      h("div", { class: "panel-title" }, [
        h("h2", {}, "Unshield finalization"),
        h("span", { class: `status ${String(status).replaceAll("_", "-")}` }, statusLabel(status))
      ]),
      h("p", { class: "field-hint" }, apiUrl ? message : "Unshield request submitted. Finalization requires keeper/public decrypt."),
      active
        ? h("div", { class: "details-grid" }, [
            detail("Request", active.requestId ? `#${active.requestId}` : "waiting for indexer"),
            detail("Amount", formatProtocolUnits(active.requestedAmount || "0")),
            detail("Tx", formatAddress(active.requestTx || active.txHash), active.requestTx || active.txHash),
            active.finalizeTx || active.finalizeTxHash ? detail("Finalize tx", formatAddress(active.finalizeTx || active.finalizeTxHash), active.finalizeTx || active.finalizeTxHash) : null,
            active.error ? detail("Error", active.error) : null
          ])
        : h("p", { class: "field-hint" }, bridge ? "No unshield request selected yet." : "Configure ShieldBridge before requesting unshield."),
      apiUrl
        ? h("div", { class: "actions" }, [
            button(requests.status === "loading" ? "Refreshing" : "Refresh status", {
              disabled: requests.status === "loading" || !state.wallet.connected || !bridge,
              onclick: refreshBridgeRequests
            })
          ])
        : null,
      apiUrl && requests.error ? h("p", { class: "error-text" }, requests.error) : null,
      apiUrl && rows.length
        ? h("details", { class: "details" }, [
            h("summary", {}, "Recent unshield requests"),
            h("div", { class: "details-grid" }, rows.slice(0, 4).map((row) => detail(`#${row.requestId || "pending"} ${row.isStable ? "P" : "N"}`, `${statusLabel(row.status)} / ${formatProtocolUnits(row.requestedAmount || "0")}`)))
          ])
        : null
    ]);
  }

  function statusLabel(status) {
    return {
      submitted: "submitted",
      requested: "waiting",
      decrypting: "decrypting",
      finalize_submitted: "finalizing",
      finalized: "finalized",
      failed: "failed",
      idle: "idle",
      loading: "loading",
      ready: "ready",
      error: "error",
      unconfigured: "no backend"
    }[status] || status;
  }

  function bridgeStatusMessage(status) {
    return {
      submitted: "Wallet transaction submitted. Waiting for the indexer to see UnshieldRequested.",
      requested: "Waiting for keeper.",
      decrypting: "Public decrypt in progress.",
      finalize_submitted: "Finalize transaction submitted.",
      finalized: "Public tokens minted.",
      failed: "Keeper failed. Check backend logs or retry keeper processing.",
      idle: "Submit an unshield request to track keeper finalization.",
      loading: "Reading keeper status.",
      error: "Could not read keeper status.",
      unconfigured: "Unshield request submitted. Finalization requires keeper/public decrypt."
    }[status] || "Reading keeper status.";
  }

  function indexerPlaceholder(series) {
    return h("section", { class: "panel market-placeholder" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, state.mode === "public" ? "Public market" : "Confidential listings"), h("span", {}, "offline")]),
      h("div", { class: "empty" }, [
        h("strong", {}, "Market indexer not connected yet."),
        h("p", {}, "Trading is intentionally disabled until the watcher/indexer is introduced. No backend order API is used on this page."),
        h("p", {}, "When connected, listings must not be hidden or deactivated only because maturity passed. Use settled=true or listing lifecycle status for filtering.")
      ]),
      h("div", { class: "details-grid" }, [
        detail("Selected side", state.form.side === "P" ? "P stableETH" : "N upETH"),
        detail("Strike", `$${state.form.strike}`),
        detail("Maturity", `${maturityTimestamp()} / ${formatDateTime(state.form.maturity)} UTC`),
        detail("Token", state.form.side === "P" ? formatAddress(series?.stable_token) : formatAddress(series?.up_token), state.form.side === "P" ? series?.stable_token : series?.up_token)
      ])
    ]);
  }

  function sellReadinessPanel(series, status) {
    const balance = selectedSideBalance();
    const token = state.form.side === "P" ? series?.stable_token : series?.up_token;
    const tokenMissing = !token;
    const noBalance = state.mode === "public" && balance.raw <= 0n;
    const disabledReason = tokenMissing
      ? "Selected token is not created."
      : state.mode === "public" && balance.status === "error"
        ? "Token balance read failed."
        : noBalance
          ? "No selected-side balance."
          : "Market indexer not connected yet.";
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Sell selected token"), h("span", {}, status.label)]),
      h("div", { class: "details-grid" }, [
        detail("Token", state.form.side === "P" ? "P stableETH" : "N upETH"),
        detail("Balance", balance.value),
        detail("Trading state", status.label)
      ]),
      h("p", { class: "field-hint" }, "Sell availability must be based on balance, token transfer/listing errors, invalid listing terms, or backend listing lifecycle status. It must not be disabled solely because maturity passed."),
      h("div", { class: "actions" }, [
        button("Create sell listing", {
          variant: "primary",
          disabled: true,
          title: disabledReason
        })
      ])
    ]);
  }

  function selectedSideBalance() {
    if (state.mode !== "public") return { status: "encrypted", value: "use Reveal", raw: 1n };
    const balance = state.form.side === "P" ? state.balances.stable : state.balances.up;
    if (balance.status === "ready") return { ...balance, value: balance.value || "0.000000", raw: BigInt(balance.raw || 0) };
    if (balance.status === "error") return { ...balance, value: balance.error || "unavailable", raw: 0n };
    return { status: balance.status, value: state.seriesRead.exists ? "loading" : "series not created", raw: 0n };
  }

  function userOrders() {
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Selected-series balances"), h("span", {}, state.wallet.connected ? formatAddress(state.wallet.account) : "read-only")]),
      state.wallet.connected
        ? h("div", { class: "balance-grid" }, [
            state.mode === "public"
              ? balanceCard("P stableETH", optionBalanceText("stable"))
              : confidentialBalanceCard("P stableETH", state.seriesRead.stableToken, "trade-stable"),
            state.mode === "public" ? balanceCard("N upETH", optionBalanceText("up")) : confidentialBalanceCard("N upETH", state.seriesRead.upToken, "trade-up"),
            state.mode === "public"
              ? balanceCard(collateralSymbol(), balanceDisplay(collateralSymbol()).max || "unavailable")
              : confidentialBalanceCard(collateralSymbol(), activeFactoryConfig().cWETH, "trade-cweth")
          ])
        : emptyState("No active positions", "Deposit collateral to mint P and N.")
    ]);
  }

  function balanceCard(label, value) {
    return h("div", { class: "balance-card" }, [h("span", {}, label), h("strong", {}, value)]);
  }

  function confidentialBalanceCard(label, tokenAddress, scope) {
    const key = confidentialRevealKey(scope, tokenAddress);
    const entry = state.reveal[key] || { status: "idle", value: "", error: "" };
    const disabledReason = confidentialRevealDisabledReason(tokenAddress);
    return h("div", { class: entry.error ? "balance-card reveal-card error-line" : "balance-card reveal-card" }, [
      h("span", {}, label),
      h("strong", { class: entry.status === "ready" ? "revealed" : "masked" }, disabledReason ? "null" : revealText(entry)),
      revealButton({ key, tokenAddress, entry, disabledReason }),
      entry.error ? h("small", { class: "error-text reveal-error" }, entry.error) : null
    ]);
  }

  function settlePage() {
    const series = selectedSeries();
    const exists = Boolean(series?.exists);
    const matured = Number(state.form.maturity) <= Math.floor(Date.now() / 1000);
    const settled = Boolean(state.seriesRead.settled);
    const status = !exists ? "Not created" : settled ? "Settled" : matured ? "Matured" : "Active";
    const canRedeem = state.wallet.connected && exists && settled && !isWrongNetwork() && !publicSeriesChainMismatch();

    return h("main", { class: pageClass() }, [
      pageHeader("Settle", "Review matured series and claim settled P or N."),
      networkPanel(),
      h("div", { class: "layout two" }, [
        h("div", { class: "stack" }, [seriesSelector(), settlementStatusPanel(status, matured)]),
        h("div", { class: "stack" }, [positionsPanel(canRedeem), txStepper()])
      ])
    ]);
  }

  function settlementStatusPanel(status, matured) {
    const exists = Boolean(state.seriesRead.exists);
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Series state"), h("span", { class: `status ${status.toLowerCase().replace(" ", "-")}` }, status)]),
      h("div", { class: "details-grid" }, [
        detail("Exists", exists ? "Yes" : "No"),
        detail("Matured", matured ? "Yes" : "No"),
        detail("Settled", state.seriesRead.settled ? "Yes" : "No"),
        detail("Maturity UTC", `${formatDateTime(state.form.maturity)} UTC`)
      ]),
      state.seriesRead.error ? h("p", { class: "error-text" }, state.seriesRead.error) : null
    ]);
  }

  function positionsPanel(canRedeem) {
    const publicPayoutAsset = String(state.form.payoutAsset || "ETH").toUpperCase() === "WETH" ? "WETH" : "ETH";
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Positions"), h("span", {}, state.mode)]),
      state.mode === "public" ? publicPositionBalances() : confidentialPositionBalances(),
      state.mode === "public"
        ? h("div", { class: "field" }, [h("span", { class: "field-label" }, "Claim as"), segmented("Claim asset", ["ETH", "WETH"], publicPayoutAsset, (value) => updateForm("payoutAsset", value))])
        : null,
      state.mode === "public" ? publicPayoutEstimateGrid(publicPayoutAsset) : confidentialPayoutGrid(),
      button(canRedeem ? (state.mode === "public" ? `Claim as ${publicPayoutAsset}` : "Redeem settled positions") : "Redeem unavailable", {
        variant: "primary",
        disabled: !canRedeem,
        onclick: () => runClaim(selectedSeries())
      })
    ]);
  }

  function publicPayoutEstimateGrid(asset) {
    return h("div", { class: "payout-grid" }, [
      publicPayoutEstimate("P", "stable", "stablePayout", asset),
      publicPayoutEstimate("N", "up", "upPayout", asset)
    ]);
  }

  function confidentialPayoutGrid() {
    return h("div", { class: "payout-grid" }, [
      h("div", {}, [h("span", {}, "P payout"), h("strong", {}, payoutText("stablePayout"))]),
      h("div", {}, [h("span", {}, "N payout"), h("strong", {}, payoutText("upPayout"))])
    ]);
  }

  function publicPayoutEstimate(side, balanceKey, payoutKey, asset) {
    return h("div", {}, [
      h("span", {}, state.seriesRead.settled ? `${side} payout rate` : `${side} estimated payout rate`),
      h("strong", {}, payoutText(payoutKey)),
      h("small", {}, estimatedClaimText(balanceKey, payoutKey, asset))
    ]);
  }

  function payoutText(key) {
    const rate = payoutRateRaw(key);
    if (rate == null) return "pending";
    return `${payoutTextIsEstimate() ? "~" : ""}${payoutRateText(rate)}`;
  }

  function payoutRateRaw(key) {
    if (state.mode === "confidential") return settlementPreviewRateRaw(key);
    if (state.seriesRead.settled) return state.seriesRead[key];
    return publicPayoutRateRaw(key);
  }

  function payoutTextIsEstimate() {
    return state.mode === "confidential" || !state.seriesRead.settled;
  }

  function publicPayoutRateRaw(key) {
    if (state.seriesRead.settled) return state.seriesRead[key];
    if (state.route !== "/settle") return null;
    return settlementPreviewRateRaw(key);
  }

  function settlementPreviewRateRaw(key) {
    const price = oraclePriceNumber();
    const strike = Number(state.form.strike || 0);
    if (!Number.isFinite(price) || !Number.isFinite(strike) || price <= 0 || strike <= 0) return null;
    const stableRate = Math.min(1_000_000, Math.max(0, Math.floor((strike / price) * 1_000_000)));
    const upRate = 1_000_000 - stableRate;
    return String(key === "stablePayout" ? stableRate : upRate);
  }

  function oraclePriceNumber() {
    if (state.oracleRead.status !== "ready" || !state.oracleRead.price) return 0;
    const raw = BigInt(state.oracleRead.price || 0);
    if (raw > 1_000_000_000n) return Number(raw) / 100_000_000;
    return Number(raw);
  }

  function payoutRateText(value) {
    const rate = BigInt(String(value || "0"));
    const whole = rate / 10_000n;
    const fraction = (rate % 10_000n).toString().padStart(4, "0");
    return `${whole}.${fraction}%`;
  }

  function estimatedClaimText(balanceKey, payoutKey, asset) {
    const payoutRateRaw = publicPayoutRateRaw(payoutKey);
    if (payoutRateRaw == null) return "pending";
    const balance = state.balances[balanceKey];
    if (balance?.status === "loading") return "loading";
    if (balance?.status === "error") return "unavailable";
    if (balance?.status !== "ready") return state.wallet.connected ? "unavailable" : "connect wallet";
    const optionRaw = BigInt(balance.raw || 0);
    const claimProtocolRaw = (optionRaw * BigInt(payoutRateRaw)) / SCALE;
    const claimCollateralWei = claimProtocolRaw * 1_000_000n;
    return `${formatTokenUnits(claimCollateralWei, 18, 12)} ${asset}`;
  }

  function publicPositionBalances() {
    return h("div", { class: "balance-grid" }, [
      balanceCard("P stableETH", optionBalanceText("stable")),
      balanceCard("N upETH", optionBalanceText("up")),
      balanceCard("Reserve asset", "WETH")
    ]);
  }

  function confidentialPositionBalances() {
    return h("div", { class: "balance-grid" }, [
      confidentialBalanceCard("P stableETH", state.seriesRead.stableToken, "settle-stable"),
      confidentialBalanceCard("N upETH", state.seriesRead.upToken, "settle-up"),
      confidentialBalanceCard("cWETH", activeFactoryConfig().cWETH, "settle-cweth")
    ]);
  }

  function confidentialRevealKey(scope, tokenAddress) {
    return `${scope}:${state.wallet.chainId}:${tokenAddress || "missing"}:${state.wallet.account || "disconnected"}`;
  }

  function confidentialRevealDisabledReason(tokenAddress) {
    if (!state.wallet.connected) return "Connect wallet";
    if (isWrongNetwork()) return "Wrong network";
    if (!tokenAddress) return "Missing token";
    return "";
  }

  function revealText(entry) {
    if (entry.status === "ready") return entry.value;
    if (entry.status === "loading") return "decrypting...";
    return "encrypted";
  }

  function revealButton({ key, tokenAddress, entry, disabledReason = "" }) {
    if (entry.status === "ready") return button("Hide", { onclick: () => hideReveal(key) });
    return button(entry.status === "loading" ? "Revealing" : "Reveal", {
      disabled: Boolean(disabledReason) || entry.status === "loading",
      title: disabledReason || "Request wallet signature and decrypt in this browser.",
      onclick: () => revealBalance(key, tokenAddress)
    });
  }

  function depositRevealButton({ key, tokenAddress, entry }) {
    if (entry.status === "ready") {
      return button("Refresh", {
        title: "Re-read the current encrypted cWETH balance.",
        onclick: () => revealBalance(key, tokenAddress)
      });
    }
    return revealButton({ key, tokenAddress, entry });
  }

  function emptyState(title, body) {
    return h("div", { class: "empty" }, [h("strong", {}, title), h("p", {}, body)]);
  }

  function appShell() {
    return h("div", { class: "app" }, [header(), content(), bottomNav(), state.toast ? h("div", { class: "toast" }, state.toast) : null]);
  }

  function header() {
    const navRoutes = visibleRoutes();
    return h("header", { class: "topbar" }, [
      h("a", { class: "wordmark", href: "/deposit", onclick: navigate }, "Freedom"),
      h("nav", { class: "primary-nav", "aria-label": "Primary" }, [h("div", { class: "desktop-mode nav-mode" }, modeSwitch()), ...navRoutes.map((route) => navLink(route))]),
      h("div", { class: "top-actions" }, [
        h("button", { class: `network network-button ${networkStateClass()}`, title: networkActionTitle(), onclick: handleNetworkAction }, networkLabel()),
        button(state.wallet.connected ? `${formatAddress(state.wallet.account)} / Disconnect` : "Connect wallet", {
          onclick: state.wallet.connected ? disconnectWallet : connectWallet
        })
      ])
    ]);
  }

  function bottomNav() {
    return h("nav", { class: "bottom-nav", "aria-label": "Primary mobile navigation" }, visibleRoutes().map((route) => navLink(route)));
  }

  function visibleRoutes() {
    return routes.filter((route) => route.path !== "/shield");
  }

  function navLink(route) {
    return h(
      "a",
      {
        href: route.path,
        class: state.route === route.path ? "active" : "",
        onclick: navigate
      },
      route.label
    );
  }

  function content() {
    return h("div", { class: "content" }, [
      state.loading ? h("div", { class: "loader" }, "Loading protocol data...") : null,
      state.route === "/trade" ? tradePage() : state.route === "/shield" ? shieldPage() : state.route === "/settle" ? settlePage() : depositPage()
    ]);
  }

  return { appShell };
}

export { createViews };
