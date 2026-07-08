function listingsUrl(apiUrl, path, params = {}) {
  const url = new URL(`${apiUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== "" && value != null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchMarketListings({ apiUrl, chainId, mode = "confidential", active = "", side = "" }) {
  if (!apiUrl) return [];
  const url = listingsUrl(apiUrl, "/markets/listings", { chainId, mode, active, side });
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Market listings read failed (${response.status}).`);
  return normalizeListingsPayload(body);
}

async function fetchUserListings({ apiUrl, chainId, user, mode = "confidential" }) {
  if (!apiUrl || !user) return [];
  const url = listingsUrl(apiUrl, `/markets/user/${user}/listings`, { chainId, mode });
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `User listings read failed (${response.status}).`);
  return normalizeListingsPayload(body);
}

function normalizeListingsPayload(body) {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.listings)
      ? body.listings
      : Array.isArray(body?.rows)
        ? body.rows
        : Array.isArray(body?.data)
          ? body.data
          : [];
  return rows.map(normalizeListingRow).filter((row) => row.id !== "");
}

function normalizeListingRow(row) {
  const tokenAddress = row.tokenAddress || row.token_address || row.token || "";
  const quoteToken = row.quoteToken || row.quote_token || row.quoteTokenAddress || row.quote_token_address || "";
  const maturity = row.maturityTimestamp ?? row.maturity_timestamp ?? row.maturity ?? "";
  const active = typeof row.active === "boolean" ? row.active : !["inactive", "cancelled", "filled", "closed"].includes(String(row.status || "active").toLowerCase());
  const fillAttemptCount = Number(row.fillAttemptCount ?? row.fill_attempt_count ?? row.fillCount ?? row.fill_count ?? row.fills ?? 0);
  const tokenSide = normalizeSide(row.tokenSide ?? row.token_side ?? row.side ?? row.isStable ?? row.is_stable);
  const createdTx = row.createdTx || row.created_tx || row.txHash || row.tx_hash || row.createTx || row.create_tx || "";
  return {
    ...row,
    id: String(row.id ?? row.listingId ?? row.listing_id ?? ""),
    listingId: String(row.listingId ?? row.listing_id ?? row.id ?? ""),
    chainId: Number(row.chainId ?? row.chain_id ?? row.chain ?? 0),
    engineAddress: row.engineAddress || row.engine_address || "",
    mode: String(row.mode || "confidential").toLowerCase(),
    seriesId: row.seriesId || row.series_id || "",
    factoryAddress: row.factoryAddress || row.factory_address || "",
    seller: row.seller || row.sellerAddress || row.seller_address || "",
    token: tokenAddress,
    tokenAddress,
    tokenSide,
    quoteToken,
    quoteSymbol: row.quoteSymbol || row.quote_symbol || "",
    strikePrice: String(row.strikePrice ?? row.strike_price ?? row.strike ?? ""),
    maturityTimestamp: Number(maturity || 0),
    side: tokenSide,
    active,
    status: String(row.status || (active ? "active" : "inactive")),
    fillAttemptCount,
    fillCount: fillAttemptCount,
    lastBuyer: row.lastBuyer || row.last_buyer || "",
    marketStatus: row.marketStatus || row.market_status || "",
    settlementPending: row.settlementPending ?? row.settlement_pending ?? null,
    settled: row.settled ?? null,
    createdBlock: String(row.createdBlock ?? row.created_block ?? ""),
    createdTx,
    txHash: createdTx
  };
}

function normalizeSide(value) {
  if (typeof value === "boolean") return value ? "P" : "N";
  const text = String(value || "").toUpperCase();
  if (["P", "STABLE", "STABLEETH", "STABLE_TOKEN"].includes(text)) return "P";
  if (["N", "UP", "UPETH", "UP_TOKEN"].includes(text)) return "N";
  return "";
}

export { fetchMarketListings, fetchUserListings };
