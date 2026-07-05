function configuredMarketApiUrl(deployments) {
  return String(deployments?.marketApiUrl || "").replace(/\/$/, "");
}

async function fetchBridgeRequests({ apiUrl, chainId, bridge, user, status = "" }) {
  if (!apiUrl) return [];
  const url = new URL(`${apiUrl}/bridges/requests`);
  if (chainId) url.searchParams.set("chainId", String(chainId));
  if (bridge) url.searchParams.set("bridge", bridge);
  if (user) url.searchParams.set("user", user);
  if (status) url.searchParams.set("status", status);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || "Bridge status read failed.");
  return Array.isArray(body) ? body.map(normalizeBridgeRequest) : [];
}

function normalizeBridgeRequest(row) {
  return {
    ...row,
    id: String(row.id || ""),
    chainId: Number(row.chainId || row.chain_id || 0),
    bridgeAddress: row.bridgeAddress || row.bridge_address || "",
    requestId: String(row.requestId || row.request_id || ""),
    userAddress: row.userAddress || row.user_address || "",
    strikePrice: String(row.strikePrice || row.strike_price || ""),
      maturityTimestamp: Number(row.maturityTimestamp || row.maturity_timestamp || 0),
    requestedAmount: String(row.requestedAmount || row.requested_amount || "0"),
    finalizedAmount: row.finalizedAmount ?? row.finalized_amount ?? null,
    requestBlock: row.requestBlock || row.request_block || "",
    requestTx: row.requestTx || row.request_tx || "",
    requestLogIndex: Number(row.requestLogIndex ?? row.request_log_index ?? 0),
    finalizeTx: row.finalizeTx || row.finalize_tx || "",
    finalizeBlock: row.finalizeBlock || row.finalize_block || "",
    finalizeLogIndex: Number(row.finalizeLogIndex ?? row.finalize_log_index ?? 0),
    finalizeTxHash: row.finalizeTxHash || row.finalize_tx_hash || "",
    error: row.error || "",
    status: row.status || "requested"
  };
}

export { configuredMarketApiUrl, fetchBridgeRequests };
