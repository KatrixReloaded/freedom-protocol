import { CURRENT_ETH_PRICE, DEFAULT_STRIKE, MAX_STRIKE } from "./config.js";
import { button, field, h, labelWithInfo, segmented } from "./dom.js";
import {
  decimalInput,
  decimalTextAttrs,
  formatAddress,
  formatDateTime,
  formatProtocolUnits,
  maturitySlotOptions,
  numericTextAttrs,
} from "./format.js";

function createViews(ctx) {
  const {
    state,
    routes,
    balanceDisplay,
    balanceRetrySeconds,
    collateralSymbol,
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
    revealBalance,
    runClaim,
    runDeposit,
    runSettleSeries,
    runShieldBridge,
    runWrapWeth,
    selectedSeries,
    setMode,
    marketApiUrl,
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

    return h("section", { class: "panel series-panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Series"), h("span", { class: `status ${statusFor(displaySeries).toLowerCase().replace(" ", "-")}` }, statusFor(displaySeries))]),
      h("div", { class: "form-grid three" }, [
        field(
          "strike",
          labelWithInfo("Strike price", `Positive multiple of $50. Default is 50% of ETH price: $${DEFAULT_STRIKE}. Max: $${MAX_STRIKE}.`),
          h("input", numericTextAttrs({
            id: "strike",
            min: "1",
            max: String(MAX_STRIKE),
            step: "1",
            value: state.form.strike,
            oninput: (event) => updateForm("strike", ctx.strikeInput(event.target.value))
          }))
        ),
        field(
          "maturity",
          labelWithInfo("Maturity slot", "PoC series use 10-minute maturity slots. New deposits require a future slot."),
          h("select", {
            id: "maturity",
            value: state.form.maturity,
            onchange: (event) => updateForm("maturity", event.target.value)
          }, maturitySlotOptions({ includePast: state.route === "/settle" || state.route === "/trade" || state.route === "/shield", selected: state.form.maturity }).map((slot) =>
            h("option", { value: slot }, `${formatDateTime(slot)} UTC`)
          ))
        ),
        side
          ? h("div", { class: "field" }, [h("span", { class: "field-label" }, "Token side"), segmented("Side", ["P", "N"], state.form.side, (value) => updateForm("side", value))])
          : h("div", { class: "metric series-metric" }, [h("span", {}, "ETH price"), h("strong", {}, `$${CURRENT_ETH_PRICE.toLocaleString()}.00`)])
      ]),
      compactDetails(displaySeries)
    ]);
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
              h("small", {}, step.hash ? formatAddress(step.hash) : labelForStatus(step.status))
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

  function pageClass() {
    return state.animatePage ? "page enter" : "page";
  }

  function depositPage() {
    const series = selectedSeries();
    const amount = state.form.amount || "0.000000";
    const symbol = collateralSymbol(series);
    return h("main", { class: pageClass() }, [
      pageHeader("Deposit", "Split collateral into equal P stableETH and N upETH tokens."),
      networkPanel(),
      h("div", { class: "layout two" }, [
        h("section", { class: "panel" }, [
          h("div", { class: "panel-title" }, [h("h2", {}, "Deposit"), h("span", {}, state.mode === "public" ? "plaintext" : "encrypted")]),
          state.mode === "public"
            ? h("div", { class: "field" }, [h("span", { class: "field-label" }, "Collateral"), segmented("Collateral", ["ETH", "WETH"], state.form.collateral, (value) => updateForm("collateral", value))])
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
          h("div", { class: "actions" }, [button("Confirm", { variant: "primary", onclick: runDeposit })])
        ]),
        h("div", { class: "stack" }, [seriesSelector(), txStepper()])
      ])
    ]);
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
      h("summary", {}, "Wrap Sepolia ETH to WETH"),
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
      h("p", { class: "field-hint" }, "WETH9 wraps Sepolia ETH through deposit(); this is not a faucet mint.")
    ]);
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
      revealButton({ key, tokenAddress, entry }),
      entry.error ? h("small", { class: "error-text reveal-error" }, entry.error) : null
    ]);
  }

  function tradePage() {
    const series = selectedSeries();
    const status = tradeSeriesStatus();
    return h("main", { class: pageClass() }, [
      pageHeader("Trade", "Market shell for live and settled P/N tokens."),
      networkPanel(),
      seriesSelector({ side: true }),
      marketFilters(),
      tradeSeriesPanel(series, status),
      indexerPlaceholder(series),
      sellReadinessPanel(series, status),
      userOrders(),
      txStepper()
    ]);
  }

  function marketFilters() {
    return h("section", { class: "panel compact-panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Market states"), h("span", {}, "default: all")]),
      segmented("Market filter", ["All", "Live", "Settled"], state.form.marketFilter || "All", (value) => updateForm("marketFilter", value)),
      h("p", { class: "field-hint" }, "Live includes matured series while settlement is pending. Settled tokens remain transferable until redeemed or burned by their contracts.")
    ]);
  }

  function tradeSeriesPanel(series, status) {
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [
        h("h2", {}, "Selected market"),
        h("span", { class: `status ${status.className}` }, status.label)
      ]),
      h("div", { class: "details-grid" }, [
        detail("Filter", state.form.marketFilter || "All"),
        detail("Selected side", state.form.side === "P" ? "P stableETH" : "N upETH"),
        detail("Maturity", `${maturityTimestamp()} / ${formatDateTime(state.form.maturity)} UTC`),
        detail("Token", state.form.side === "P" ? formatAddress(series?.stable_token) : formatAddress(series?.up_token), state.form.side === "P" ? series?.stable_token : series?.up_token)
      ]),
      status.message ? h("p", { class: "field-hint" }, status.message) : null,
      state.seriesRead.settled ? settledPayoutPanel() : null,
      status.pendingSettlement
        ? h("div", { class: "actions" }, [
            h("a", { class: "button", href: "/settle", onclick: navigate }, "Open Settle")
          ])
        : null
    ]);
  }

  function tradeSeriesStatus() {
    const exists = Boolean(state.seriesRead.exists);
    const settled = Boolean(state.seriesRead.settled);
    const matured = Number(state.form.maturity) <= Math.floor(Date.now() / 1000);
    if (!exists) return { label: "Not created", className: "not-created", message: "This series has no deployed P/N tokens yet." };
    if (settled) {
      return {
        label: "Settled",
        className: "settled",
        message: "Payout ratios are fixed. P/N tokens may still be sold if the token contract allows transfer."
      };
    }
    if (matured) {
      return {
        label: "Matured, settlement pending",
        className: "matured",
        pendingSettlement: true,
        message: "This series remains under Live while keeper settlement is pending. Maturity alone does not disable selling."
      };
    }
    return { label: "Live", className: "active", message: "Series is not settled yet." };
  }

  function settledPayoutPanel() {
    return h("div", { class: "payout-grid" }, [
      h("div", {}, [h("span", {}, "P fixed payout"), h("strong", {}, payoutText("stablePayout"))]),
      h("div", {}, [h("span", {}, "N fixed payout"), h("strong", {}, payoutText("upPayout"))])
    ]);
  }

  function shieldPage() {
    const factory = activeFactoryConfig();
    const bridge = factory.chain?.bridge || "";
    const isPublicSource = state.mode === "public";
    return h("main", { class: pageClass() }, [
      pageHeader("Shield", isPublicSource ? "Move public P or N into confidential tokens." : "Request public P or N from confidential tokens."),
      networkPanel(),
      h("div", { class: "layout two" }, [
        h("section", { class: "panel" }, [
          h("div", { class: "panel-title" }, [h("h2", {}, isPublicSource ? "Public to confidential" : "Confidential to public"), h("span", {}, bridge ? formatAddress(bridge) : "missing bridge")]),
          h("div", { class: "field" }, [h("span", { class: "field-label" }, "Token side"), segmented("Side", ["P", "N"], state.form.side, (value) => updateForm("side", value))]),
          field(
            "shield-amount",
            "Amount",
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
          h("div", { class: "notice compact" }, [
            h("strong", {}, isPublicSource ? "Shield amount is public." : "Unshield intentionally reveals amount."),
            h("p", {}, isPublicSource ? "The source token is public, so the bridge amount is visible before minting confidential tokens." : "Unshield requests public decryption so public tokens can be minted later. Finalization is not faked in this UI.")
          ]),
          isPublicSource ? null : bridgeStatusPanel(bridge),
          h("div", { class: "actions" }, [
            button(isPublicSource ? "Shield" : "Request unshield", {
              variant: "primary",
              disabled: !state.wallet.connected || isWrongNetwork() || !bridge || !state.form.shieldAmount,
              onclick: runShieldBridge
            })
          ]),
          !isPublicSource ? h("p", { class: "field-hint" }, "Backend keeper finalizes unshield when configured. This UI only tracks status.") : null
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
    const oracleAdapter = configuredOracleAdapter();
    const status = !exists ? "Not created" : settled ? "Settled" : matured ? "Matured" : "Active";
    const oracleReady = state.oracleRead.status === "ready" && BigInt(state.oracleRead.price || 0) > 0n && BigInt(state.oracleRead.updatedAt || 0) > 0n;
    const canTrySettle = state.wallet.connected && exists && matured && !settled && Boolean(oracleAdapter) && oracleReady && !isWrongNetwork() && !publicSeriesChainMismatch();
    const canRedeem = state.wallet.connected && exists && settled && !isWrongNetwork() && !publicSeriesChainMismatch();

    return h("main", { class: pageClass() }, [
      pageHeader("Settle", "Settle matured series through the Chainlink adapter, then redeem P or N."),
      networkPanel(),
      h("div", { class: "layout two" }, [
        h("div", { class: "stack" }, [seriesSelector(), settlementStatusPanel(status, matured)]),
        h("div", { class: "stack" }, [positionsPanel(canRedeem), settleActionPanel({ canTrySettle, settled, matured, oracleAdapter, exists }), txStepper()])
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
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Positions"), h("span", {}, state.mode)]),
      state.mode === "public" ? publicPositionBalances() : confidentialPositionBalances(),
      h("div", { class: "payout-grid" }, [
        h("div", {}, [h("span", {}, "P payout"), h("strong", {}, payoutText("stablePayout"))]),
        h("div", {}, [h("span", {}, "N payout"), h("strong", {}, payoutText("upPayout"))])
      ]),
      button(canRedeem ? "Redeem settled positions" : "Redeem unavailable", {
        variant: "primary",
        disabled: !canRedeem,
        onclick: () => runClaim(selectedSeries())
      })
    ]);
  }

  function payoutText(key) {
    if (!state.seriesRead.settled) return "pending";
    if (state.mode === "confidential") return "encrypted";
    return formatProtocolUnits(state.seriesRead[key]);
  }

  function publicPositionBalances() {
    return h("div", { class: "balance-grid" }, [
      balanceCard("P stableETH", optionBalanceText("stable")),
      balanceCard("N upETH", optionBalanceText("up")),
      balanceCard("Collateral", balanceDisplay(collateralSymbol()).max || "unavailable")
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

  function settleActionPanel({ canTrySettle, settled, matured, oracleAdapter, exists }) {
    const oracle = state.oracleRead;
    const title = settleDisabledReason({ settled, matured, oracleAdapter, exists });
    return h("section", { class: "panel" }, [
      h("div", { class: "panel-title" }, [h("h2", {}, "Chainlink settlement"), h("span", {}, oracleAdapter ? formatAddress(oracleAdapter) : "missing adapter")]),
      h("div", { class: "details-grid" }, [
        detail("ETH/USD", oraclePriceText()),
        detail("Updated", oracle.updatedAt ? formatOracleUpdatedAt(oracle.updatedAt) : oracle.status === "loading" ? "loading" : "unavailable"),
        detail("Adapter", oracleAdapter ? formatAddress(oracleAdapter) : "Not configured", oracleAdapter)
      ]),
      oracle.error ? h("p", { class: "error-text" }, oracle.error) : null,
      h("p", { class: "field-hint" }, "Settlement reads Chainlink ETH/USD through the adapter. No manual price is submitted by the frontend."),
      h("div", { class: "actions" }, [
        button(settled ? "Already settled" : canTrySettle ? "Settle series" : "Settle unavailable", {
          variant: "primary",
          disabled: settled || !canTrySettle,
          title,
          onclick: runSettleSeries
        }),
        button("Refresh", { onclick: refreshSelectedSeries })
      ])
    ]);
  }

  function configuredOracleAdapter() {
    const factory = activeFactoryConfig();
    const configured = factory.oracleAdapter || factory.chain?.oracleAdapter || "";
    return /^0x[a-fA-F0-9]{40}$/.test(configured) ? configured : state.seriesRead.oracle || "";
  }

  function settleDisabledReason({ settled, matured, oracleAdapter, exists }) {
    if (settled) return "Series already settled.";
    if (!exists) return "Series not found.";
    if (!matured) return "Series has not reached maturity.";
    if (!oracleAdapter) return "Oracle adapter address missing from env.";
    if (state.oracleRead.status === "error") return state.oracleRead.error;
    if (state.oracleRead.status !== "ready") return "Oracle adapter unavailable.";
    return "";
  }

  function oraclePriceText() {
    const oracle = state.oracleRead;
    if (oracle.status === "loading") return "loading";
    if (!oracle.price) return "unavailable";
    return `$${wholeUsdFromOraclePrice(oracle.price).toLocaleString()}`;
  }

  function wholeUsdFromOraclePrice(value) {
    const raw = BigInt(value || 0);
    if (raw > 1_000_000_000n) return Number(raw / 100_000_000n);
    return Number(raw);
  }

  function formatOracleUpdatedAt(value) {
    const timestamp = Number(value || 0);
    if (!timestamp) return "unavailable";
    return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
  }

  function emptyState(title, body) {
    return h("div", { class: "empty" }, [h("strong", {}, title), h("p", {}, body)]);
  }

  function appShell() {
    return h("div", { class: "app" }, [header(), content(), bottomNav(), state.toast ? h("div", { class: "toast" }, state.toast) : null]);
  }

  function header() {
    return h("header", { class: "topbar" }, [
      h("a", { class: "wordmark", href: "/deposit", onclick: navigate }, "Freedom"),
      h("nav", { class: "primary-nav", "aria-label": "Primary" }, routes.map((route) => navLink(route))),
      h("div", { class: "top-actions" }, [
        h("div", { class: "desktop-mode" }, modeSwitch()),
        h("button", { class: `network network-button ${networkStateClass()}`, title: networkActionTitle(), onclick: handleNetworkAction }, networkLabel()),
        button(state.wallet.connected ? `${formatAddress(state.wallet.account)} / Disconnect` : "Connect wallet", {
          onclick: state.wallet.connected ? disconnectWallet : connectWallet
        })
      ])
    ]);
  }

  function bottomNav() {
    return h("nav", { class: "bottom-nav", "aria-label": "Primary mobile navigation" }, routes.map((route) => navLink(route)));
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
