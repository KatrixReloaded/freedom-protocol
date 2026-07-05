import { parseChainId } from "./format.js";

function createWalletActions({ state, setState, render, scheduleBalanceRefresh, scheduleSeriesRefresh, setToast, isWrongNetwork, targetChainConfig }) {
  async function connectWallet() {
    if (!window.ethereum) {
      setToast("No injected wallet found.");
      return;
    }
    try {
      localStorage.removeItem("freedom.walletDisconnected");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const chainHex = await window.ethereum.request({ method: "eth_chainId" });
      setState({
        wallet: {
          account: accounts[0] || "",
          chainId: parseChainId(chainHex),
          connected: Boolean(accounts[0])
        }
      });
      scheduleBalanceRefresh();
      scheduleSeriesRefresh();
    } catch (error) {
      setToast(error.code === 4001 ? "Transaction rejected in wallet." : "Could not connect wallet.");
    }
  }

  async function disconnectWallet() {
    localStorage.setItem("freedom.walletDisconnected", "1");
    if (window.ethereum?.request) {
      await window.ethereum
        .request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }]
        })
        .catch(() => undefined);
    }
    setState({
      wallet: { account: "", chainId: 0, connected: false },
      balances: {
        ...state.balances,
        publicCollateral: { status: "idle", symbol: "", value: "", max: "", error: "", nextRetryAt: 0 }
      }
    });
    setToast("Wallet disconnected locally.");
  }

  async function refreshWallet() {
    if (!window.ethereum) return;
    if (localStorage.getItem("freedom.walletDisconnected") === "1") {
      state.wallet = { account: "", chainId: 0, connected: false };
      render();
      return;
    }
    const accounts = await window.ethereum.request({ method: "eth_accounts" }).catch(() => []);
    const chainHex = await window.ethereum.request({ method: "eth_chainId" }).catch(() => "0x0");
    setState({
      wallet: {
        account: accounts[0] || "",
        chainId: parseChainId(chainHex),
        connected: Boolean(accounts[0])
      }
    });
    scheduleBalanceRefresh();
    scheduleSeriesRefresh();
  }

  async function switchToModeChain() {
    if (!window.ethereum) return setToast("No injected wallet found.");
    const target = targetChainConfig();
    if (!target?.chainId) return setToast("No configured chain for this mode.");
    const chainId = `0x${Number(target.chainId).toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }]
      });
      await refreshWallet();
    } catch (error) {
      if (error?.code !== 4902 || !target.rpcUrl) {
        setToast(`Switch wallet to ${target.label || `chain ${target.chainId}`}.`);
        return;
      }
      await addConfiguredChain(target, chainId);
      await refreshWallet();
    }
  }

  async function switchToAnvil() {
    return switchToModeChain();
  }

  async function addConfiguredChain(target, chainId) {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: target.label || `Chain ${target.chainId}`,
          nativeCurrency: target.nativeCurrency || { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [target.rpcUrl],
          blockExplorerUrls: target.blockExplorerUrls || []
        }
      ]
    });
  }

  function handleNetworkAction() {
    if (!state.wallet.connected) return;
    if (isWrongNetwork()) return switchToModeChain();
    return refreshWallet();
  }

  function networkLabel() {
    if (!state.wallet.connected) return "Disconnected";
    if (isWrongNetwork()) {
      const target = targetChainConfig();
      return `Chain ${state.wallet.chainId} / Switch ${target?.chainId || ""}`.trim();
    }
    return `Chain ${state.wallet.chainId}`;
  }

  function networkActionTitle() {
    if (!state.wallet.connected) return "Wallet not connected";
    if (isWrongNetwork()) {
      const target = targetChainConfig();
      return `Switch wallet to ${target?.label || `chain ${target?.chainId || ""}`}`;
    }
    return "Refresh wallet network";
  }

  function networkStateClass() {
    if (!state.wallet.connected) return "muted";
    return isWrongNetwork() ? "warn" : "ok";
  }

  return {
    connectWallet,
    disconnectWallet,
    handleNetworkAction,
    networkActionTitle,
    networkLabel,
    networkStateClass,
    refreshWallet,
    switchToAnvil,
    switchToModeChain,
    switchToZama: switchToModeChain
  };
}

export { createWalletActions };
