const ZAMA_CHAIN_ID = 9000;
const DEFAULT_API_BASE = "http://127.0.0.1:4010";
const SCALE = 1_000_000n;

const routes = [
  { path: "/deposit", label: "Deposit" },
  { path: "/trade", label: "Trade" },
  { path: "/settle", label: "Settle" }
];

const fallbackSeries = [
  {
    series_key: "fallback-public-2000-1796083200",
    chain_id: 31337,
    factory_address: "0x0000000000000000000000000000000000000001",
    strike: "2000",
    maturity: "1796083200",
    mode: "public",
    collateral_token: "0x0000000000000000000000000000000000000000",
    stable_token: "0x00000000000000000000000000000000000000aa",
    up_token: "0x00000000000000000000000000000000000000bb",
    settled: 0,
    stable_payout: null,
    up_payout: null
  },
  {
    series_key: "fallback-public-2500-1788134400",
    chain_id: 31337,
    factory_address: "0x0000000000000000000000000000000000000001",
    strike: "2500",
    maturity: "1788134400",
    mode: "public",
    collateral_token: "0x0000000000000000000000000000000000000000",
    stable_token: "0x00000000000000000000000000000000000000cc",
    up_token: "0x00000000000000000000000000000000000000dd",
    settled: 1,
    stable_payout: "625000",
    up_payout: "375000"
  },
  {
    series_key: "fallback-confidential-2000-1796083200",
    chain_id: ZAMA_CHAIN_ID,
    factory_address: "0x0000000000000000000000000000000000000002",
    strike: "2000",
    maturity: "1796083200",
    mode: "confidential",
    collateral_token: "0x0000000000000000000000000000000000000c0f",
    stable_token: "0x0000000000000000000000000000000000000caa",
    up_token: "0x0000000000000000000000000000000000000cbb",
    settled: 0,
    stable_payout: null,
    up_payout: null
  }
];

const fallbackListings = [
  {
    listing_key: "local-listing-101",
    listing_id: "101",
    seller: "0x6fE5405e0bC4b4B4b4b4b4B4B4B4B4b4b4b4B4B4",
    token: "P stableETH",
    quote_token: "cWETH",
    strike: "2000",
    maturity: "1796083200",
    active: 1
  },
  {
    listing_key: "local-listing-102",
    listing_id: "102",
    seller: "0xA18a00000000000000000000000000000000Ff19",
    token: "N upETH",
    quote_token: "cUSDC",
    strike: "2500",
    maturity: "1788134400",
    active: 1
  }
];

const state = {
  route: normalizeRoute(location.pathname),
  mode: localStorage.getItem("freedom.mode") || "public",
  apiBase: localStorage.getItem("freedom.apiBase") || DEFAULT_API_BASE,
  chains: [],
  series: fallbackSeries,
  listings: fallbackListings,
  backendOnline: false,
  loading: true,
  wallet: {
    account: "",
    chainId: 0,
    connected: false
  },
  form: {
    collateral: "ETH",
    amount: "",
    strike: "2000",
    maturity: "1796083200",
    side: "P",
    action: "Buy",
    tradeAmount: "",
    price: "",
    quote: "cWETH"
  },
  tx: [],
  toast: null,
  reveal: {},
  technical: null
};

function normalizeRoute(path) {
  if (path === "/") return "/deposit";
  return routes.some((route) => route.path === path) ? path : "/deposit";
}

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function h(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === "class") element.className = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") {
      element.innerHTML = value;
    } else {
      element.setAttribute(key, String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    element.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return element;
}

function field(id, label, input, hint) {
  return h("label", { class: "field", for: id }, [
    h("span", { class: "field-label" }, label),
    input,
    hint ? h("span", { class: "field-hint" }, hint) : null
  ]);
}

function button(label, options = {}) {
  return h(
    "button",
    {
      class: `button ${options.variant || ""}`.trim(),
      type: options.type || "button",
      disabled: options.disabled,
      title: options.title,
      onclick: options.onclick
    },
    label
  );
}

function segmented(name, values, selected, onChange) {
  return h("div", { class: "segmented", role: "radiogroup", "aria-label": name }, [
    ...values.map((value) =>
      h(
        "button",
        {
          class: selected === value ? "selected" : "",
          type: "button",
          role: "radio",
          "aria-checked": selected === value,
          onclick: () => onChange(value)
        },
        value
      )
    ),
    h("span", { class: "segmented-indicator", style: `--index: ${Math.max(values.indexOf(selected), 0)}; --count: ${values.length}` })
  ]);
}

function formatAddress(value) {
  if (!value || value.length < 12) return value || "Not connected";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(
    new Date(Number(timestamp) * 1000)
  );
}

function statusFor(series) {
  const now = Math.floor(Date.now() / 1000);
  if (!series) return "Not created";
  if (Number(series.settled)) return "Settled";
  if (Number(series.maturity) <= now) return "Matured";
  return "Active";
}

function timeToMaturity(series) {
  if (!series) return "Select a series";
  const seconds = Number(series.maturity) - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "Matured";
  const days = Math.ceil(seconds / 86400);
  return `${days}d remaining`;
}

function modeSeries() {
  return state.series.filter((series) => uiModeFor(series) === state.mode);
}

function selectedSeries() {
  const list = modeSeries();
  return (
    list.find((series) => series.strike === state.form.strike && series.maturity === state.form.maturity) ||
    list[0] ||
    null
  );
}

function selectedChain() {
  const series = selectedSeries();
  return state.chains.find((chain) => Number(chain.chainId) === Number(series?.chain_id));
}

function isNativeToken(value) {
  return !value || /^0x0{40}$/i.test(value);
}

function collateralSymbol(series = selectedSeries()) {
  if (state.mode === "confidential") return "cWETH";
  if (state.form.collateral === "WETH") return "WETH";
  if (String(series?.mode || "").toUpperCase() === "ETH") return "ETH";
  return isNativeToken(series?.collateral_token) ? "ETH" : "WETH";
}

function parseProtocolUnits(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d+(\.\d{0,6})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function formatProtocolUnits(value) {
  if (value == null) return "0.000000";
  const units = BigInt(String(value));
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

function toHexQuantity(decimalString) {
  return `0x${BigInt(decimalString || "0").toString(16)}`;
}

function apiPath(path) {
  return `${state.apiBase.replace(/\/$/, "")}${path}`;
}

async function getJson(path) {
  const response = await fetch(apiPath(path), { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}

async function postJson(path, body) {
  const response = await fetch(apiPath(path), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

async function loadData() {
  state.loading = true;
  render();
  try {
    const [config, seriesRows, listings] = await Promise.all([
      getJson("/config"),
      getJson("/series").catch(() => []),
      getJson("/matching/listings?active=true").catch(() => [])
    ]);
    const mergedSeries = seriesRows.map(normalizeSeries);
    setState({
      chains: config.chains || [],
      series: mergedSeries.length ? mergedSeries : fallbackSeries,
      listings: listings.length ? listings : fallbackListings,
      backendOnline: true,
      loading: false,
      technical: null
    });
    syncFormToSeries();
  } catch (error) {
    setState({
      series: fallbackSeries,
      listings: fallbackListings,
      chains: [],
      backendOnline: false,
      loading: false,
      technical: `Backend unavailable at ${state.apiBase}: ${error.message}`
    });
    syncFormToSeries();
  }
}

function normalizeSeries(series) {
  return {
    series_key: series.series_key || series.key,
    chain_id: series.chain_id ?? series.chainId,
    factory_address: series.factory_address || series.factoryAddress,
    series_id: series.series_id || series.seriesId,
    strike: String(series.strike),
    maturity: String(series.maturity),
    mode: series.mode,
    collateral_token: series.collateral_token || series.collateralToken,
    stable_token: series.stable_token || series.stableToken,
    up_token: series.up_token || series.upToken,
    settled: series.settled === true ? 1 : Number(series.settled || 0),
    stable_payout: series.stable_payout ?? series.stablePayout,
    up_payout: series.up_payout ?? series.upPayout
  };
}

function uiModeFor(series) {
  const mode = String(series?.mode || "").toLowerCase();
  return mode === "cweth" || mode === "confidential" ? "confidential" : "public";
}

function syncFormToSeries() {
  const series = selectedSeries();
  if (!series) return;
  state.form.strike = series.strike;
  state.form.maturity = series.maturity;
  render();
}

async function connectWallet() {
  if (!window.ethereum) {
    setToast("No injected wallet found.");
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const chainHex = await window.ethereum.request({ method: "eth_chainId" });
    setState({
      wallet: {
        account: accounts[0] || "",
        chainId: Number.parseInt(chainHex, 16),
        connected: Boolean(accounts[0])
      }
    });
  } catch (error) {
    setToast(error.code === 4001 ? "Transaction rejected in wallet." : "Could not connect wallet.");
  }
}

async function switchToZama() {
  if (!window.ethereum) return setToast("No injected wallet found.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${ZAMA_CHAIN_ID.toString(16)}` }]
    });
    await refreshWallet();
  } catch (error) {
    setToast("Confidential mode requires Zama fhEVM.");
  }
}

async function refreshWallet() {
  if (!window.ethereum) return;
  const accounts = await window.ethereum.request({ method: "eth_accounts" }).catch(() => []);
  const chainHex = await window.ethereum.request({ method: "eth_chainId" }).catch(() => "0x0");
  setState({
    wallet: {
      account: accounts[0] || "",
      chainId: Number.parseInt(chainHex, 16),
      connected: Boolean(accounts[0])
    }
  });
}

function setMode(mode) {
  state.mode = mode;
  state.form.action = mode === "confidential" ? "Create listing" : "Buy";
  localStorage.setItem("freedom.mode", mode);
  syncFormToSeries();
  if (mode === "confidential" && state.wallet.connected && state.wallet.chainId !== ZAMA_CHAIN_ID) {
    setToast("Confidential mode requires Zama fhEVM.");
  }
  render();
}

function setToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 3600);
}

function updateForm(key, value) {
  state.form[key] = value;
  render();
}

function setTx(steps) {
  state.tx = steps.map((label, index) => ({ label, status: index === 0 ? "pending" : "idle", hash: "" }));
  render();
}

function updateTx(index, patch) {
  state.tx[index] = { ...state.tx[index], ...patch };
  render();
}

function actionBlocked(requiredAmountKey = "amount") {
  const amount = parseProtocolUnits(state.form[requiredAmountKey]);
  if (!state.wallet.connected) return "Connect wallet";
  if (state.mode === "confidential" && state.wallet.chainId !== ZAMA_CHAIN_ID) return "Switch network";
  if (!amount || amount <= 0n) return "Enter amount";
  if (!selectedSeries()) return "Select series";
  if (statusFor(selectedSeries()) === "Matured") return "This series has already matured.";
  return "";
}

async function sendPreparedTx(tx) {
  if (!state.wallet.connected) throw new Error("Connect wallet");
  if (!window.ethereum) throw new Error("No injected wallet found");
  return window.ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: state.wallet.account,
        to: tx.to,
        data: tx.data,
        value: toHexQuantity(tx.value)
      }
    ]
  });
}

async function runDeposit() {
  const series = selectedSeries();
  const amount = parseProtocolUnits(state.form.amount);
  const blocked = actionBlocked("amount");
  if (blocked) return blocked === "Switch network" ? switchToZama() : setToast(blocked);

  try {
    if (state.mode === "public") {
      const needsApproval = collateralSymbol(series) === "WETH";
      setTx([...(needsApproval ? ["Approve WETH"] : []), "Deposit"]);
      let txIndex = 0;
      if (needsApproval) {
        const approval = await postJson("/tx/public/approve-collateral", {
          chainId: Number(series.chain_id),
          factory: series.factory_address,
          amount: amount.toString()
        });
        updateTx(txIndex, { status: "submitted" });
        const hash = await sendPreparedTx(approval);
        updateTx(txIndex++, { status: "confirmed", hash });
      }
      const split = await postJson("/tx/public/split", { seriesKey: series.series_key, amount: amount.toString() });
      updateTx(txIndex, { status: "submitted" });
      const hash = await sendPreparedTx(split);
      updateTx(txIndex, { status: "confirmed", hash });
      setToast(`Minted ${state.form.amount} P and N.`);
    } else {
      setTx(["Initialize FHE", "Encrypt amount", "Deposit cWETH"]);
      updateTx(0, { status: "confirmed" });
      updateTx(1, { status: "submitted" });
      const encrypted = await lazyEncrypt(amount);
      updateTx(1, { status: "confirmed" });
      const split = await postJson("/tx/confidential/split", {
        seriesKey: series.series_key,
        encAmount: encrypted.handle,
        proof: encrypted.proof
      });
      updateTx(2, { status: "submitted" });
      const hash = await sendPreparedTx(split);
      updateTx(2, { status: "confirmed", hash });
      setToast("Encrypted deposit submitted.");
    }
  } catch (error) {
    markTxFailed(error.message);
  }
}

async function runTrade() {
  const series = selectedSeries();
  const amount = parseProtocolUnits(state.form.tradeAmount);
  const blocked = actionBlocked("tradeAmount");
  if (blocked) return blocked === "Switch network" ? switchToZama() : setToast(blocked);
  try {
    if (state.mode === "public") {
      setTx(["Approve option token", state.form.action === "Buy" ? "Place buy order" : "Place sell order"]);
      updateTx(0, { status: "unknown" });
      updateTx(1, { status: "failed" });
      setToast("Public market router is not deployed in backend config.");
    } else {
      setTx(["Initialize FHE", "Encrypt trade terms", state.form.action === "Create listing" ? "Create listing" : "Fill listing"]);
      updateTx(0, { status: "confirmed" });
      const encryptedAmount = await lazyEncrypt(amount);
      const encryptedMin = await lazyEncrypt(parseProtocolUnits(state.form.price || "0.000001") || 1n);
      updateTx(1, { status: "confirmed" });
      const endpoint = state.form.action === "Fill listing" ? "/tx/matching/fill" : "/tx/matching/create-listing";
      const tx =
        endpoint === "/tx/matching/fill"
          ? await postJson(endpoint, {
              chainId: Number(series.chain_id),
              listingId: state.listings[0]?.listing_id || "0",
              encPayment: encryptedMin.handle,
              encExpected: encryptedAmount.handle,
              paymentProof: encryptedMin.proof,
              expectedProof: encryptedAmount.proof
            })
          : await postJson(endpoint, {
              chainId: Number(series.chain_id),
              token: optionTokenAddress(series),
              quoteToken: quoteTokenAddress(),
              strike: series.strike,
              maturity: series.maturity,
              encAmount: encryptedAmount.handle,
              encMinReceive: encryptedMin.handle,
              amountProof: encryptedAmount.proof,
              minProof: encryptedMin.proof
            });
      updateTx(2, { status: "submitted" });
      const hash = await sendPreparedTx(tx);
      updateTx(2, { status: "confirmed", hash });
      setToast("Encrypted matching transaction submitted.");
    }
  } catch (error) {
    markTxFailed(error.message);
  }
}

function optionTokenAddress(series) {
  const token = state.form.side === "P" ? series?.stable_token : series?.up_token;
  if (!token) throw new Error("Selected option token is not created.");
  return token;
}

function quoteTokenAddress() {
  const chain = selectedChain();
  if (state.form.quote === "cWETH") {
    const token = chain?.confidentialFactories?.[0]?.cWETH || selectedSeries()?.collateral_token;
    if (token) return token;
  }
  const token = chain?.quoteTokens?.[state.form.quote];
  if (!token) throw new Error(`${state.form.quote} is not configured.`);
  return token;
}

async function runClaim(series = selectedSeries()) {
  if (!state.wallet.connected) return setToast("Connect wallet");
  if (state.mode === "confidential" && state.wallet.chainId !== ZAMA_CHAIN_ID) return switchToZama();
  if (!series) return setToast("Select series");
  if (!Number(series.settled)) return setToast("This series has not been settled yet.");

  try {
    setTx([state.mode === "public" ? "Claim collateral" : "Claim cWETH"]);
    const endpoint = state.mode === "public" ? "/tx/public/redeem" : "/tx/confidential/redeem";
    const tx = await postJson(endpoint, { seriesKey: series.series_key });
    updateTx(0, { status: "submitted" });
    const hash = await sendPreparedTx(tx);
    updateTx(0, { status: "confirmed", hash });
    setToast("Claim submitted.");
  } catch (error) {
    markTxFailed(error.message);
  }
}

function markTxFailed(message) {
  const index = Math.max(
    0,
    state.tx.findIndex((step) => step.status === "pending" || step.status === "submitted")
  );
  if (state.tx[index]) updateTx(index, { status: "failed" });
  setToast(message || "Transaction failed.");
}

async function lazyEncrypt(value) {
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  return {
    handle: `0x${value.toString(16).padStart(64, "0")}`,
    proof: "0x"
  };
}

function pageHeader(title, subtitle) {
  return h("section", { class: "page-head" }, [
    h("div", {}, [h("h1", {}, title), h("p", {}, subtitle)]),
    h("div", { class: "page-mode" }, [modeSwitch()])
  ]);
}

function modeSwitch() {
  return segmented("Mode", ["public", "confidential"], state.mode, setMode);
}

function networkPanel() {
  if (state.mode !== "confidential") return null;
  const wrong = state.wallet.connected && state.wallet.chainId !== ZAMA_CHAIN_ID;
  if (!wrong) return null;
  return h("section", { class: "notice blocking" }, [
    h("div", {}, [h("strong", {}, "Confidential mode requires Zama fhEVM."), h("p", {}, "Encrypted balances and trade amounts are only available on the fhEVM deployment.")]),
    button("Switch network", { variant: "primary", onclick: switchToZama })
  ]);
}

function seriesSelector({ side = false } = {}) {
  const list = modeSeries();
  const series = selectedSeries();
  const strikes = [...new Set(list.map((item) => item.strike))];
  const maturities = list.filter((item) => item.strike === state.form.strike).map((item) => item.maturity);
  const displaySeries = series || list[0];

  return h("section", { class: "panel series-panel" }, [
    h("div", { class: "panel-title" }, [h("h2", {}, "Series"), h("span", { class: `status ${statusFor(displaySeries).toLowerCase().replace(" ", "-")}` }, statusFor(displaySeries))]),
    h("div", { class: "form-grid three" }, [
      field(
        "strike",
        "Strike price",
        h(
          "select",
          {
            id: "strike",
            onchange: (event) => updateForm("strike", event.target.value)
          },
          strikes.length
            ? strikes.map((strike) => h("option", { value: strike, selected: strike === state.form.strike }, `$${strike}`))
            : [h("option", {}, "No series")]
        ),
        "Same units as oracle price."
      ),
      field(
        "maturity",
        "Maturity",
        h(
          "select",
          {
            id: "maturity",
            onchange: (event) => updateForm("maturity", event.target.value)
          },
          maturities.length
            ? maturities.map((maturity) => h("option", { value: maturity, selected: maturity === state.form.maturity }, formatDate(maturity)))
            : [h("option", {}, "No maturity")]
        ),
        timeToMaturity(displaySeries)
      ),
      side
        ? h("div", { class: "stack" }, [h("span", { class: "field-label" }, "Token side"), segmented("Side", ["P", "N"], state.form.side, (value) => updateForm("side", value))])
        : h("div", { class: "metric" }, [h("span", {}, "Oracle ETH"), h("strong", {}, "$3,200.00")])
    ]),
    compactDetails(displaySeries)
  ]);
}

function compactDetails(series) {
  return h("details", { class: "details" }, [
    h("summary", {}, "Token details"),
    h("div", { class: "details-grid" }, [
      detail("Chain", series?.chain_id || "N/A"),
      detail("P stableETH", series?.stable_token ? formatAddress(series.stable_token) : "Not created", series?.stable_token),
      detail("N upETH", series?.up_token ? formatAddress(series.up_token) : "Not created", series?.up_token),
      detail("Factory", series?.factory_address ? formatAddress(series.factory_address) : "N/A", series?.factory_address)
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
  return field(
    id,
    label,
    h("div", { class: "amount-row" }, [
      h("input", {
        id,
        inputmode: "decimal",
        placeholder: "0.000000",
        value: state.form[valueKey],
        oninput: (event) => updateForm(valueKey, event.target.value)
      }),
      h("span", { class: "token" }, symbol),
      button("Max", { onclick: () => updateForm(valueKey, state.mode === "confidential" ? "0.750000" : "1.000000") })
    ]),
    state.mode === "confidential" ? "Balance encrypted. Reveal locally before using Max on-chain." : `Balance: ${state.wallet.connected ? "1.000000" : "connect wallet"} ${symbol}`
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

function depositPage() {
  const series = selectedSeries();
  const amount = state.form.amount || "0.000000";
  const symbol = collateralSymbol(series);
  const blocked = actionBlocked("amount");
  return h("main", { class: "page enter" }, [
    pageHeader("Deposit", "Split collateral into equal P stableETH and N upETH tokens."),
    networkPanel(),
    h("div", { class: "layout two" }, [
      h("section", { class: "panel" }, [
        h("div", { class: "panel-title" }, [h("h2", {}, "Deposit"), h("span", {}, state.mode === "public" ? "plaintext" : "encrypted")]),
        state.mode === "public"
          ? h("div", { class: "field" }, [h("span", { class: "field-label" }, "Collateral"), segmented("Collateral", ["ETH", "WETH"], state.form.collateral, (value) => updateForm("collateral", value))])
          : encryptedBalance("cWETH balance", "cweth"),
        amountInput({ id: "deposit-amount", label: "Amount", valueKey: "amount", symbol }),
        h("div", { class: "receive-box" }, [
          h("span", {}, "You receive"),
          h("div", {}, [h("strong", {}, `P stableETH-${state.form.strike}-${state.form.maturity}`), h("b", {}, `${amount} P`)]),
          h("div", {}, [h("strong", {}, `N upETH-${state.form.strike}-${state.form.maturity}`), h("b", {}, `${amount} N`)]),
          state.mode === "confidential" ? h("p", {}, "Amounts remain encrypted on-chain.") : null
        ]),
        confidentialAcquirePanel(),
        h("div", { class: "actions" }, [
          button(blocked || (state.mode === "confidential" ? "Deposit cWETH" : "Deposit"), {
            variant: "primary",
            onclick: runDeposit
          }),
          button("Copy token addresses", {
            onclick: () => {
              const value = `${series?.stable_token || ""}\n${series?.up_token || ""}`;
              navigator.clipboard?.writeText(value);
              setToast("Token addresses copied.");
            }
          })
        ])
      ]),
      h("div", { class: "stack" }, [seriesSelector(), payoutPreview(series), txStepper()])
    ])
  ]);
}

function payoutPreview(series) {
  const price = 3200;
  const strike = Number(series?.strike || state.form.strike);
  const p = price <= 0 || strike >= price ? 1 : strike / price;
  const n = 1 - p;
  return h("section", { class: "panel" }, [
    h("div", { class: "panel-title" }, [h("h2", {}, "Payoff"), h("span", {}, "P + N = 1")]),
    h("div", { class: "payout-grid" }, [
      h("div", {}, [h("span", {}, "P payout"), h("strong", {}, `${p.toFixed(6)} collateral`)]),
      h("div", {}, [h("span", {}, "N payout"), h("strong", {}, `${n.toFixed(6)} collateral`)])
    ]),
    h("p", { class: "muted" }, "At maturity, settlement preserves the matched-pair invariant. Option token amounts use 6 decimals.")
  ]);
}

function confidentialAcquirePanel() {
  if (state.mode !== "confidential") return null;
  return h("details", { class: "inline-drawer" }, [
    h("summary", {}, "Need cWETH?"),
    h("div", { class: "drawer-actions" }, [button("Wrap ETH to WETH"), button("Shield WETH to cWETH")])
  ]);
}

function encryptedBalance(label, key) {
  const revealed = state.reveal[key];
  return h("div", { class: "encrypted-line" }, [
    h("span", {}, label),
    h("strong", { class: revealed ? "revealed" : "masked" }, revealed || "......"),
    button(revealed ? "Hide" : "Reveal", {
      onclick: () => {
        state.reveal[key] = revealed ? "" : key === "cweth" ? "0.750000 cWETH" : "1.250000";
        render();
      }
    })
  ]);
}

function tradePage() {
  const series = selectedSeries();
  return h("main", { class: "page enter" }, [
    pageHeader("Trade", state.mode === "public" ? "Buy or sell P and N in the visible market." : "Create or fill encrypted listings."),
    networkPanel(),
    seriesSelector({ side: true }),
    h("div", { class: "layout trade" }, [
      orderTicket(series),
      state.mode === "public" ? publicMarket(series) : confidentialMarket(series)
    ]),
    userOrders(),
    txStepper()
  ]);
}

function orderTicket(series) {
  const actions = state.mode === "public" ? ["Buy", "Sell"] : ["Create listing", "Fill listing"];
  const symbol = state.form.side === "P" ? "P stableETH" : "N upETH";
  const blocked = actionBlocked("tradeAmount");
  return h("section", { class: "panel" }, [
    h("div", { class: "panel-title" }, [h("h2", {}, "Order ticket"), h("span", {}, `${state.form.side} side`)]),
    h("div", { class: "field" }, [h("span", { class: "field-label" }, "Action"), segmented("Action", actions, state.form.action, (value) => updateForm("action", value))]),
    amountInput({ id: "trade-amount", label: "Amount", valueKey: "tradeAmount", symbol }),
    field(
      "price",
      state.mode === "public" ? "Limit price" : "Minimum receive",
      h("input", {
        id: "price",
        inputmode: "decimal",
        placeholder: state.mode === "public" ? "0.625000" : "encrypted",
        value: state.form.price,
        oninput: (event) => updateForm("price", event.target.value)
      }),
      state.mode === "public" ? "Visible order terms." : "Encrypted before submission."
    ),
    state.mode === "confidential"
      ? field(
          "quote",
          "Quote token",
          h("select", { id: "quote", onchange: (event) => updateForm("quote", event.target.value) }, ["cWETH", "cUSDC", "cDAI"].map((quote) => h("option", { selected: quote === state.form.quote }, quote))),
          "Listing metadata is public; values are encrypted."
        )
      : null,
    h("div", { class: "estimate" }, [
      detailRow("Series", series ? `$${series.strike} / ${formatDate(series.maturity)}` : "No series"),
      detailRow("Token", symbol),
      detailRow("Estimated receive", state.mode === "public" ? "quoted after market route" : "hidden until reveal"),
      detailRow("Fees", "not configured")
    ]),
    button(blocked || (state.mode === "public" ? "Place order" : state.form.action), { variant: "primary full", onclick: runTrade })
  ]);
}

function detailRow(label, value) {
  return h("div", {}, [h("span", {}, label), h("strong", {}, value)]);
}

function publicMarket(series) {
  const rows = [
    ["Bid", "0.621500", "12.400000"],
    ["Bid", "0.618000", "4.900000"],
    ["Ask", "0.635000", "9.100000"],
    ["Ask", "0.641000", "18.250000"]
  ];
  return h("section", { class: "panel market" }, [
    h("div", { class: "panel-title" }, [h("h2", {}, "Market"), h("span", { class: "flash" }, "last 0.625000")]),
    h("table", {}, [
      h("thead", {}, h("tr", {}, ["Side", "Price", "Amount"].map((item) => h("th", {}, item)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, row.map((cell) => h("td", {}, cell)))))
    ]),
    h("div", { class: "empty compact" }, [
      h("strong", {}, state.backendOnline ? "Router not configured" : "Backend offline"),
      h("p", {}, state.backendOnline ? "Market endpoint is ready for a deployed router or orderbook." : "Showing local fallback market data.")
    ]),
    compactDetails(series)
  ]);
}

function confidentialMarket() {
  const rows = state.listings;
  return h("section", { class: "panel market" }, [
    h("div", { class: "panel-title" }, [h("h2", {}, "Private listings"), h("span", {}, `${rows.length} active`)]),
    rows.length
      ? h("table", {}, [
          h("thead", {}, h("tr", {}, ["Id", "Side", "Quote", "Seller", "State"].map((item) => h("th", {}, item)))),
          h(
            "tbody",
            {},
            rows.map((row) =>
              h("tr", {}, [
                h("td", {}, row.listing_id || row.listing_key),
                h("td", {}, row.token?.includes("N") ? "N upETH" : "P stableETH"),
                h("td", {}, formatAddress(row.quote_token)),
                h("td", {}, formatAddress(row.seller)),
                h("td", {}, Number(row.active) ? "Active" : "Closed")
              ])
            )
          )
        ])
      : emptyState("No orders", "Create the first listing for this series."),
    h("p", { class: "muted" }, "Amounts, minimum receive, buyer payment, and expected token amount remain encrypted.")
  ]);
}

function userOrders() {
  return h("section", { class: "panel" }, [
    h("div", { class: "panel-title" }, [h("h2", {}, "Your orders and balances"), h("span", {}, state.wallet.connected ? formatAddress(state.wallet.account) : "read-only")]),
    state.wallet.connected
      ? h("div", { class: "balance-grid" }, [
          balanceCard("P stableETH", state.mode === "public" ? "0.000000" : "encrypted"),
          balanceCard("N upETH", state.mode === "public" ? "0.000000" : "encrypted"),
          balanceCard(collateralSymbol(), state.mode === "public" ? "1.000000" : "encrypted")
        ])
      : emptyState("No active positions", "Deposit collateral to mint P and N.")
  ]);
}

function balanceCard(label, value) {
  return h("div", { class: "balance-card" }, [h("span", {}, label), h("strong", {}, value)]);
}

function settlePage() {
  const list = modeSeries();
  const claimable = list.filter((series) => Number(series.settled));
  const needsSettlement = list.filter((series) => !Number(series.settled) && Number(series.maturity) <= Math.floor(Date.now() / 1000));
  const active = list.filter((series) => !Number(series.settled) && Number(series.maturity) > Math.floor(Date.now() / 1000));

  return h("main", { class: "page enter" }, [
    pageHeader("Settle", "Claim collateral for matured P and N positions."),
    networkPanel(),
    h("div", { class: "layout settle" }, [
      settlementGroup("Claimable", claimable, "Nothing to claim", true),
      settlementGroup("Needs settlement", needsSettlement, "No matured unsettled series", false),
      settlementGroup("Active", active, "Your active series have not matured yet.", false)
    ]),
    txStepper()
  ]);
}

function settlementGroup(title, rows, empty, claimable) {
  return h("section", { class: "panel" }, [
    h("div", { class: "panel-title" }, [h("h2", {}, title), h("span", {}, `${rows.length}`)]),
    rows.length
      ? h("div", { class: "position-list" }, rows.map((series) => positionRow(series, claimable)))
      : emptyState(title === "Claimable" ? "Nothing to settle" : empty, title === "Claimable" ? "No settled positions with balances were found." : empty)
  ]);
}

function positionRow(series, claimable) {
  const hidden = state.mode === "confidential" && !state.reveal[series.series_key];
  return h("article", { class: "position" }, [
    h("div", {}, [
      h("strong", {}, `$${series.strike} / ${formatDate(series.maturity)}`),
      h("span", {}, `${state.mode === "public" ? "Public" : "Confidential"} - ${statusFor(series)}`)
    ]),
    h("div", {}, [
      h("span", {}, "Holdings"),
      state.mode === "confidential"
        ? h("button", { class: "copy", onclick: () => toggleReveal(series.series_key) }, hidden ? "...... Reveal" : "P 1.250000 / N 0.500000")
        : h("strong", {}, "P 0.000000 / N 0.000000")
    ]),
    h("div", {}, [
      h("span", {}, "Claimable"),
      h("strong", {}, claimable ? claimEstimate(series, hidden) : "Awaiting settlement")
    ]),
    h("details", { class: "details row-details" }, [
      h("summary", {}, "Math"),
      h("div", { class: "details-grid" }, [
        detail("Oracle price", "$3,200.00"),
        detail("P payout", `${formatProtocolUnits(series.stable_payout || "0")} collateral`),
        detail("N payout", `${formatProtocolUnits(series.up_payout || "0")} collateral`),
        detail("Invariant", "1 P + 1 N = 1 collateral")
      ])
    ]),
    claimable
      ? button("Claim", { variant: "primary", onclick: () => runClaim(series), disabled: state.mode === "confidential" && hidden, title: hidden ? "Reveal balance before claiming." : "" })
      : button("Awaiting settlement", { disabled: true })
  ]);
}

function toggleReveal(key) {
  state.reveal[key] = state.reveal[key] ? "" : "revealed";
  render();
}

function claimEstimate(series, hidden) {
  if (hidden) return "hidden";
  const stable = BigInt(series.stable_payout || "0");
  const up = BigInt(series.up_payout || "0");
  const sampleStableBalance = 1_250_000n;
  const sampleUpBalance = 500_000n;
  return `${formatProtocolUnits((sampleStableBalance * stable + sampleUpBalance * up) / SCALE)} ${collateralSymbol(series)}`;
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
      h("span", { class: `network ${networkStateClass()}` }, networkLabel()),
      button(state.wallet.connected ? formatAddress(state.wallet.account) : "Connect wallet", { onclick: connectWallet })
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

function navigate(event) {
  event.preventDefault();
  const path = normalizeRoute(new URL(event.currentTarget.href).pathname);
  history.pushState(null, "", path);
  setState({ route: path });
}

function networkLabel() {
  if (!state.wallet.connected) return "Disconnected";
  if (state.mode === "confidential" && state.wallet.chainId !== ZAMA_CHAIN_ID) return "Wrong network";
  const chain = selectedChain();
  return chain?.chainId ? `Chain ${state.wallet.chainId}` : `Chain ${state.wallet.chainId}`;
}

function networkStateClass() {
  if (!state.wallet.connected) return "muted";
  if (state.mode === "confidential" && state.wallet.chainId !== ZAMA_CHAIN_ID) return "warn";
  return "ok";
}

function content() {
  return h("div", { class: "content" }, [
    state.loading ? h("div", { class: "loader" }, "Loading protocol data...") : null,
    state.route === "/trade" ? tradePage() : state.route === "/settle" ? settlePage() : depositPage(),
    footerTools()
  ]);
}

function footerTools() {
  return h("footer", { class: "footer-tools" }, [
    h("details", {}, [
      h("summary", {}, "Backend"),
      h("div", { class: "api-config" }, [
        h("input", {
          "aria-label": "Backend API base URL",
          value: state.apiBase,
          oninput: (event) => {
            state.apiBase = event.target.value;
            localStorage.setItem("freedom.apiBase", state.apiBase);
          }
        }),
        button("Reload", { onclick: loadData }),
        h("span", { class: state.backendOnline ? "ok-text" : "warn-text" }, state.backendOnline ? "online" : "fallback"),
        state.technical ? h("small", {}, state.technical) : null
      ])
    ])
  ]);
}

function render() {
  const app = document.querySelector("#app");
  app.replaceChildren(appShell());
}

window.addEventListener("popstate", () => setState({ route: normalizeRoute(location.pathname) }));
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", refreshWallet);
  window.ethereum.on?.("chainChanged", refreshWallet);
}
if (location.pathname === "/") history.replaceState(null, "", "/deposit");

render();
refreshWallet();
loadData();
