import { ORACLE_ADAPTER_SELECTORS, SELECTORS, SHIELD_BRIDGE_EVENTS, SHIELD_BRIDGE_SELECTORS, WETH_SELECTORS } from "./config.js";
import { addressCallData, decodeAddress, decodeBool, decodeUint, encodeCall, ethCall, isAddress, requireAddress, words } from "./abi.js";
import { authorizeCWeth, cwethAuthLabel } from "./cweth-authorization.js";
import { encryptAmount } from "./encryption.js";
import { formatTokenUnits, parseUnits } from "./format.js";

function createProtocolActions(ctx) {
  const {
    activeFactoryConfig,
    isWrongNetwork,
    maturityTimestamp,
    maturityValidation,
    parseCollateralUnits,
    publicCollateralConfig,
    publicSeriesChainMismatch,
    refreshWalletNetwork,
    render,
    selectedSeries,
    sendTx,
    setToast,
    setTx,
    state,
    strikeValidation,
    updateTx
  } = ctx;

  async function loadData() {
    state.loading = true;
    render();
    await refreshSelectedSeries();
    state.loading = false;
    render();
  }

  function decodeSeriesResult(result) {
    const out = words(result);
    return {
      stableToken: decodeAddress(out[0] || ""),
      upToken: decodeAddress(out[1] || ""),
      strikePrice: decodeUint(out[2] || "0").toString(),
      maturityTimestamp: decodeUint(out[3] || "0").toString(),
      exists: decodeBool(out[4] || "0"),
      settled: decodeBool(out[5] || "0"),
      stablePayout: decodeUint(out[6] || "0").toString(),
      upPayout: decodeUint(out[7] || "0").toString()
    };
  }

  function decodeTwoAddresses(result) {
    const out = words(result);
    return [decodeAddress(out[0] || ""), decodeAddress(out[1] || "")];
  }

  async function readOptionalAddress(contract, selector) {
    try {
      return decodeAddress(words(await ethCall(contract, selector))[0] || "");
    } catch (_error) {
      return "";
    }
  }

  async function refreshSelectedSeries() {
    if (!window.ethereum) {
      state.seriesRead = { ...state.seriesRead, status: "error", exists: false, error: "No wallet provider found for contract reads." };
      render();
      return;
    }
    const validation = strikeValidation() || maturityValidation();
    if (validation) {
      state.seriesRead = { ...state.seriesRead, status: "error", exists: false, error: validation };
      render();
      return;
    }
    const factory = activeFactoryConfig();
    if (!isAddress(factory.factory)) {
      state.seriesRead = {
        status: "idle",
        exists: false,
        settled: false,
        stableToken: "",
        upToken: "",
        stablePayout: "0",
        upPayout: "0",
        maturityTimestamp: state.form.maturity,
        oracle: "",
        error: ""
      };
      state.oracleRead = { status: "idle", adapter: "", price: "", updatedAt: "", error: "" };
      render();
      return;
    }
    state.seriesRead = { ...state.seriesRead, status: "loading", error: "" };
    render();
    try {
      const strike = BigInt(state.form.strike || "0");
      const maturity = BigInt(maturityTimestamp());
      const getSeriesData = encodeCall(SELECTORS.getSeries, [
        { type: "uint", value: strike },
        { type: "uint", value: maturity }
      ]);
      const [seriesResult, oracle] = await Promise.all([ethCall(factory.factory, getSeriesData), readOptionalAddress(factory.factory, SELECTORS.oracle)]);
      const series = decodeSeriesResult(seriesResult);
      const oracleAdapter = oracleAdapterAddress(factory, oracle);
      if (series.exists) {
        state.seriesRead = { status: "ready", ...series, oracle, error: "" };
      } else {
        const prediction = decodeTwoAddresses(
          await ethCall(
            factory.factory,
            encodeCall(SELECTORS.predictTokenAddresses, [
              { type: "uint", value: strike },
              { type: "uint", value: maturity }
            ])
          )
        );
        state.seriesRead = {
          status: "ready",
          exists: false,
          settled: false,
          stableToken: prediction[0],
          upToken: prediction[1],
          stablePayout: "0",
          upPayout: "0",
          maturityTimestamp: state.form.maturity,
          oracle,
          error: ""
        };
      }
      await Promise.all([refreshPublicCollateralBalance(), refreshOptionBalances(), refreshOraclePrice(oracleAdapter)]);
      render();
    } catch (error) {
      state.seriesRead = { ...state.seriesRead, status: "error", exists: false, error: normalizeRpcError(error) };
      state.oracleRead = { ...state.oracleRead, status: "error", error: normalizeRpcError(error) };
      render();
    }
  }

  function oracleAdapterAddress(factory = activeFactoryConfig(), factoryOracle = state.seriesRead.oracle) {
    const configured = factory?.oracleAdapter || factory?.chain?.oracleAdapter || "";
    return isAddress(configured) ? configured : factoryOracle || "";
  }

  async function refreshOraclePrice(adapter = oracleAdapterAddress()) {
    if (!isAddress(adapter)) {
      state.oracleRead = { status: "idle", adapter: "", price: "", updatedAt: "", error: "" };
      return;
    }
    state.oracleRead = { ...state.oracleRead, status: "loading", adapter, error: "" };
    try {
      const result = await ethCall(adapter, ORACLE_ADAPTER_SELECTORS.latestEthUsdPrice);
      const out = words(result);
      if (out.length < 2) throw new Error("Oracle adapter unavailable.");
      const price = decodeUint(out[0] || "0");
      const updatedAt = decodeUint(out[1] || "0");
      if (price <= 0n || updatedAt <= 0n) throw new Error("Oracle adapter unavailable.");
      state.oracleRead = {
        status: "ready",
        adapter,
        price: price.toString(),
        updatedAt: updatedAt.toString(),
        error: ""
      };
    } catch (error) {
      state.oracleRead = {
        status: "error",
        adapter,
        price: "",
        updatedAt: "",
        error: normalizeOracleError(error)
      };
    }
  }

  async function refreshPublicCollateralBalance(force = false) {
    if (state.mode !== "public") return;
    const collateral = publicCollateralConfig();
    if (!state.wallet.connected || !window.ethereum) {
      state.balances.publicCollateral = { status: "idle", symbol: collateral.symbol, value: "", max: "", error: "", nextRetryAt: 0 };
      render();
      return;
    }

    const nextRetryAt = state.balances.publicCollateral.nextRetryAt || 0;
    if (!force && nextRetryAt > Date.now()) {
      render();
      return;
    }

    if (!collateral.native && !collateral.token) {
      state.balances.publicCollateral = {
        status: "error",
        symbol: collateral.symbol,
        value: "",
        max: "",
        error: `${collateral.symbol} token is not configured on this chain.`,
        nextRetryAt: 0
      };
      render();
      return;
    }

    const key = balanceKey();
    if (refreshPublicCollateralBalance.inFlightKey === key) return;
    refreshPublicCollateralBalance.inFlightKey = key;
    state.balances.publicCollateral = { status: "loading", symbol: collateral.symbol, value: "", max: "", error: "", key, nextRetryAt: 0 };
    render();

    try {
      const rawHex = collateral.native
        ? await window.ethereum.request({ method: "eth_getBalance", params: [state.wallet.account, "latest"] })
        : await window.ethereum.request({
            method: "eth_call",
            params: [
              {
                to: collateral.token,
                data: `0x70a08231${addressCallData(state.wallet.account)}`
              },
              "latest"
            ]
          });
      if (state.balances.publicCollateral.key !== key) return;
      const raw = BigInt(rawHex || "0x0");
      const value = formatTokenUnits(raw, collateral.decimals, 6);
      state.balances.publicCollateral = { status: "ready", symbol: collateral.symbol, value, max: value, raw, error: "", key, nextRetryAt: 0 };
      render();
    } catch (error) {
      const normalized = normalizeBalanceError(error);
      const nextRetryAt = normalized.retry ? Date.now() + 30_000 : 0;
      state.balances.publicCollateral = {
        status: "error",
        symbol: collateral.symbol,
        value: "",
        max: "",
        error: normalized.message,
        key,
        nextRetryAt
      };
      render();
    } finally {
      refreshPublicCollateralBalance.inFlightKey = "";
    }
  }

  function balanceKey() {
    const collateral = publicCollateralConfig();
    return `${state.wallet.account}:${state.wallet.chainId}:${collateral.symbol}:${collateral.token || "native"}`;
  }

  function normalizeBalanceError(error) {
    const message = String(error?.message || "Balance read failed.");
    if (/too many errors|rate|retrying|limit/i.test(message)) {
      return { retry: true, message: "RPC rate limited. Balance read paused for 30s." };
    }
    if (/user rejected/i.test(message)) return { retry: false, message: "Balance read rejected in wallet." };
    return { retry: false, message: "Balance read failed. Try a different RPC endpoint." };
  }

  function normalizeRpcError(error) {
    const message = String(error?.message || error || "RPC call failed.");
    if (/execution reverted/i.test(message)) return "Contract read reverted. Check deployment config and network.";
    if (/rate|too many|retry/i.test(message)) return "RPC endpoint is rate limited or unhealthy.";
    return message.length > 140 ? "RPC call failed. Check network and deployment config." : message;
  }

  async function readErc20Balance(token, owner, decimals = 6) {
    if (!isAddress(token) || !isAddress(owner)) return { status: "idle", value: "", raw: 0n, error: "" };
    const result = await ethCall(token, encodeCall(SELECTORS.balanceOf, [{ type: "address", value: owner }]));
    const raw = decodeUint(words(result)[0] || "0");
    return { status: "ready", value: formatTokenUnits(raw, decimals, 6), raw, error: "" };
  }

  async function refreshOptionBalances() {
    if (!state.wallet.connected || state.mode !== "public" || !state.seriesRead.exists) {
      state.balances.stable = { status: "idle", value: "", raw: 0n, error: "" };
      state.balances.up = { status: "idle", value: "", raw: 0n, error: "" };
      return;
    }
    try {
      const [stable, up] = await Promise.all([
        readErc20Balance(state.seriesRead.stableToken, state.wallet.account, 6),
        readErc20Balance(state.seriesRead.upToken, state.wallet.account, 6)
      ]);
      state.balances.stable = stable;
      state.balances.up = up;
    } catch (error) {
      const message = normalizeRpcError(error);
      state.balances.stable = { status: "error", value: "", raw: 0n, error: message };
      state.balances.up = { status: "error", value: "", raw: 0n, error: message };
    }
  }

  function actionBlocked(requiredAmountKey = "amount") {
    const amount = parseCollateralUnits(state.form[requiredAmountKey]);
    if (!state.wallet.connected) return "Connect wallet";
    if (isWrongNetwork()) return "Switch network";
    const validation = strikeValidation() || maturityValidation({ requireFuture: true });
    if (validation) return validation;
    if (!amount || amount <= 0n) return "Enter amount";
    const factory = activeFactoryConfig();
    if (!isAddress(factory.factory)) return "Factory address missing from env.";
    if (state.mode === "confidential" && !isAddress(factory.cWETH)) return "cWETH address missing from env.";
    if (state.seriesRead.status === "loading") return "Reading series";
    if (state.seriesRead.status === "error") return "Fix series";
    if (publicSeriesChainMismatch()) return `Switch to chain ${selectedSeries().chain_id}`;
    if (Number(state.form.maturity) <= Math.floor(Date.now() / 1000)) return "This series has already matured.";
    return "";
  }

  function activeBridgeAddress() {
    return activeFactoryConfig().chain?.bridge || "";
  }

  async function runDeposit() {
    const amount = parseCollateralUnits(state.form.amount);
    const blocked = actionBlocked("amount");
    if (blocked) return blocked === "Switch network" ? refreshWalletNetwork() : setToast(blocked);

    try {
      const factory = activeFactoryConfig();
      const strike = BigInt(state.form.strike);
      const maturityValue = BigInt(state.form.maturity);
      if (state.mode === "public") {
        const collateral = publicCollateralConfig();
        const needsApproval = !collateral.native;
        setTx([...(needsApproval ? [`Approve ${collateral.symbol}`] : []), state.seriesRead.exists ? "Deposit" : "Create series and deposit"]);
        let txIndex = 0;
        if (needsApproval) {
          const vault = decodeAddress(words(await ethCall(factory.factory, SELECTORS.vault))[0] || "");
          const approval = {
            to: collateral.token,
            data: encodeCall(SELECTORS.approve, [
              { type: "address", value: vault },
              { type: "uint", value: amount }
            ]),
            value: 0n
          };
          updateTx(txIndex, { status: "submitted" });
          const hash = await sendTx(approval.to, approval.data, approval.value);
          updateTx(txIndex++, { status: "confirmed", hash });
        }
        const data = state.seriesRead.exists
          ? encodeCall(SELECTORS.publicSplit, [
              { type: "uint", value: strike },
              { type: "uint", value: maturityValue },
              { type: "uint", value: amount }
            ])
          : encodeCall(SELECTORS.publicCreateSeriesAndSplit, [
              { type: "uint", value: strike },
              { type: "uint", value: maturityValue },
              { type: "uint", value: amount }
            ]);
        updateTx(txIndex, { status: "submitted" });
        const hash = await sendTx(factory.factory, data, collateral.native ? amount : 0n);
        updateTx(txIndex, { status: "confirmed", hash });
        setToast(`Minted ${state.form.amount} P and N.`);
        await refreshSelectedSeries();
      } else {
        const cWETH = requireAddress(factory.cWETH, "cWETH");
        const vault = decodeAddress(words(await ethCall(factory.factory, SELECTORS.vault))[0] || "");
        setTx(["Initialize FHE", cwethAuthLabel(factory), "Encrypt deposit amount", state.seriesRead.exists ? "Deposit cWETH" : "Create series and deposit cWETH"]);
        state.fhe = { status: "loading", error: "" };
        render();
        updateTx(0, { status: "submitted" });
        updateTx(0, { status: "confirmed" });
        updateTx(1, { status: "submitted" });
        const auth = await authorizeCWeth({
          factory,
          cWETH,
          vault,
          userAddress: state.wallet.account,
          amount,
          sendTx,
          fhe: factory.fhe
        });
        updateTx(1, { status: "confirmed", hash: auth.hash || "" });
        updateTx(2, { status: "submitted" });
        const depositEncrypted = await encryptAmount({
          contractAddress: factory.factory,
          userAddress: state.wallet.account,
          value: amount,
          fhe: factory.fhe
        });
        updateTx(2, { status: "confirmed" });
        const data = state.seriesRead.exists
          ? encodeCall(SELECTORS.confidentialSplit, [
              { type: "uint", value: strike },
              { type: "uint", value: maturityValue },
              { type: "bytes32", value: depositEncrypted.handle },
              { type: "bytes", value: depositEncrypted.proof }
            ])
          : encodeCall(SELECTORS.confidentialCreateSeriesAndSplit, [
              { type: "uint", value: strike },
              { type: "uint", value: maturityValue },
              { type: "bytes32", value: depositEncrypted.handle },
              { type: "bytes", value: depositEncrypted.proof }
            ]);
        updateTx(3, { status: "submitted" });
        const hash = await sendTx(factory.factory, data, 0n);
        updateTx(3, { status: "confirmed", hash });
        state.fhe = { status: "ready", error: "" };
        setToast("Encrypted deposit submitted.");
        await refreshSelectedSeries();
      }
    } catch (error) {
      if (state.mode === "confidential") state.fhe = { status: "error", error: String(error?.message || error || "FHE SDK unavailable.") };
      markTxFailed(error.message);
    }
  }

  async function runWrapWeth() {
    if (!state.wallet.connected) return setToast("Connect wallet");
    if (isWrongNetwork()) return refreshWalletNetwork();
    const collateral = publicCollateralConfig();
    if (collateral.native || !isAddress(collateral.token)) return setToast("WETH token is not configured.");
    const amount = parseUnits(state.form.wrapAmount || "", 18);
    if (!amount || amount <= 0n) return setToast("Enter WETH wrap amount.");
    try {
      setTx(["Wrap Sepolia ETH to WETH"]);
      updateTx(0, { status: "submitted" });
      const hash = await sendTx(collateral.token, WETH_SELECTORS.deposit, amount);
      updateTx(0, { status: "confirmed", hash });
      state.form.wrapAmount = "";
      setToast("WETH wrapped.");
      await refreshPublicCollateralBalance(true);
    } catch (error) {
      markTxFailed(error.message);
    }
  }

  async function runShieldBridge() {
    if (!state.wallet.connected) return setToast("Connect wallet");
    if (isWrongNetwork()) return refreshWalletNetwork();
    const bridge = activeBridgeAddress();
    if (!isAddress(bridge)) return setToast("ShieldBridge address missing from env.");
    const validation = strikeValidation() || maturityValidation();
    if (validation) return setToast(validation);
    const amount = parseUnits(state.form.shieldAmount || "", 6);
    if (!amount || amount <= 0n) return setToast("Enter shield amount.");
    if (amount > 2n ** 64n - 1n) return setToast("Bridge amount exceeds uint64 range.");

    const isStable = state.form.side === "P";
    const selector = state.mode === "public" ? SHIELD_BRIDGE_SELECTORS.shield : SHIELD_BRIDGE_SELECTORS.unshield;
    const label = state.mode === "public" ? "Shield public tokens" : "Request unshield";
    try {
      setTx([label]);
      const data = encodeCall(selector, [
        { type: "uint", value: BigInt(state.form.strike) },
        { type: "uint", value: BigInt(maturityTimestamp()) },
        { type: "bool", value: isStable },
        { type: "uint", value: amount }
      ]);
      updateTx(0, { status: "submitted" });
      const hash = await sendTx(bridge, data, 0n);
      updateTx(0, { status: "confirmed", hash });
      if (state.mode === "confidential") {
        state.bridgeRequests = {
          ...state.bridgeRequests,
          active: localBridgeRequest({ bridge, hash, isStable, amount, requestId: "" }),
          error: ""
        };
        render();
        extractUnshieldRequestId(hash, bridge)
          .then((requestId) => {
            if (!requestId || state.bridgeRequests.active?.txHash !== hash) return;
            state.bridgeRequests.active = { ...state.bridgeRequests.active, requestId, id: bridgeRequestId(state.wallet.chainId, bridge, requestId) };
            render();
          })
          .catch(() => undefined);
      }
      setToast(state.mode === "public" ? "Shield submitted." : "Unshield requested. Waiting for keeper finalization.");
      await refreshSelectedSeries();
    } catch (error) {
      markTxFailed(error.message);
    }
  }

  function localBridgeRequest({ bridge, hash, isStable, amount, requestId }) {
    return {
      id: requestId ? bridgeRequestId(state.wallet.chainId, bridge, requestId) : "",
      chainId: state.wallet.chainId,
      bridgeAddress: bridge,
      requestId,
      userAddress: state.wallet.account,
      strikePrice: state.form.strike,
      maturityTimestamp: maturityTimestamp(),
      isStable,
      requestedAmount: amount.toString(),
      status: "submitted",
      requestTx: hash,
      txHash: hash,
      error: ""
    };
  }

  function bridgeRequestId(chainId, bridge, requestId) {
    return `${Number(chainId)}:${String(bridge).toLowerCase()}:${requestId}`;
  }

  async function extractUnshieldRequestId(hash, bridge) {
    const receipt = await waitForTransactionReceipt(hash);
    const requestLog = (receipt?.logs || []).find(
      (log) => String(log.address || "").toLowerCase() === String(bridge).toLowerCase() && String(log.topics?.[0] || "").toLowerCase() === SHIELD_BRIDGE_EVENTS.unshieldRequested.toLowerCase()
    );
    if (!requestLog?.topics?.[1]) return "";
    return decodeUint(String(requestLog.topics[1]).replace(/^0x/, "")).toString();
  }

  async function waitForTransactionReceipt(hash) {
    for (let i = 0; i < 20; i++) {
      const receipt = await window.ethereum
        .request({ method: "eth_getTransactionReceipt", params: [hash] })
        .catch(() => null);
      if (receipt) return receipt;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    return null;
  }

  async function runClaim(series = selectedSeries()) {
    if (!state.wallet.connected) return setToast("Connect wallet");
    if (isWrongNetwork()) return refreshWalletNetwork();
    if (!series) return setToast("Select series");
    if (!state.seriesRead.settled) return setToast("This series has not been settled yet.");

    try {
      setTx([state.mode === "public" ? "Claim collateral" : "Claim cWETH"]);
      const factory = activeFactoryConfig();
      const data = encodeCall(SELECTORS.redeem, [
        { type: "uint", value: BigInt(state.form.strike) },
        { type: "uint", value: BigInt(maturityTimestamp()) }
      ]);
      updateTx(0, { status: "submitted" });
      const hash = await sendTx(factory.factory, data, 0n);
      updateTx(0, { status: "confirmed", hash });
      setToast("Claim submitted.");
      await refreshSelectedSeries();
    } catch (error) {
      markTxFailed(error.message);
    }
  }

  async function runSettleSeries() {
    if (!state.wallet.connected) return setToast("Connect wallet");
    if (isWrongNetwork()) return refreshWalletNetwork();
    const validation = strikeValidation() || maturityValidation();
    if (validation) return setToast(validation);
    if (!state.seriesRead.exists) return setToast("Series not found.");
    if (state.seriesRead.settled) return setToast("Series already settled.");
    if (Number(state.form.maturity) > Math.floor(Date.now() / 1000)) return setToast("Series is not matured yet.");
    const factory = activeFactoryConfig();
    const adapter = oracleAdapterAddress(factory);
    if (!isAddress(adapter)) return setToast("Oracle adapter address missing from env.");
    if (!isAddress(factory.factory)) return setToast("Factory address missing from env.");
    try {
      setTx(["Read Chainlink ETH price", "Settle series"]);
      updateTx(0, { status: "submitted" });
      await refreshOraclePrice(adapter);
      if (!oracleAdapterReady()) throw new Error(state.oracleRead.error || "Oracle adapter unavailable.");
      updateTx(0, { status: "confirmed" });
      const selector = state.mode === "public" ? ORACLE_ADAPTER_SELECTORS.settlePublic : ORACLE_ADAPTER_SELECTORS.settleConfidential;
      const data = encodeCall(selector, [
        { type: "address", value: factory.factory },
        { type: "uint", value: BigInt(state.form.strike) },
        { type: "uint", value: BigInt(maturityTimestamp()) }
      ]);
      updateTx(1, { status: "submitted" });
      const hash = await sendTx(adapter, data, 0n);
      updateTx(1, { status: "confirmed", hash });
      setToast("Series settled.");
      await refreshSelectedSeries();
    } catch (error) {
      markTxFailed(normalizeOracleError(error));
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

  function normalizeOracleError(error) {
    const message = String(error?.message || error || "");
    if (/adapter unavailable|unsupported|empty data|returned no data/i.test(message)) return "Oracle adapter unavailable.";
    if (/stale|round|updated|heartbeat/i.test(message)) return "Chainlink oracle price is stale.";
    if (/not.?matured|maturity|not matured/i.test(message)) return "Series is not matured yet.";
    if (/already.?settled|settled/i.test(message)) return "Series already settled.";
    if (/series.*not.*found|not.*created|exists/i.test(message)) return "Series not found.";
    if (/oracle|price/i.test(message) && /unavailable|revert|failed/i.test(message)) return "Oracle price unavailable.";
    return message.length > 140 ? "Settlement failed. Check oracle adapter and series state." : message || "Settlement failed.";
  }

  function oracleAdapterReady() {
    return state.oracleRead.status === "ready" && BigInt(state.oracleRead.price || 0) > 0n && BigInt(state.oracleRead.updatedAt || 0) > 0n;
  }

  return {
    loadData,
    refreshPublicCollateralBalance,
    refreshSelectedSeries,
    runClaim,
    runDeposit,
    runSettleSeries,
    runShieldBridge,
    runWrapWeth
  };
}

export { createProtocolActions };
