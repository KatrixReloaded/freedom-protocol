function activeSeriesEndpoints(apiUrl) {
  return [`${apiUrl}/series/active`, `${apiUrl}/series?status=active`];
}

async function fetchActiveSeries({ apiUrl }) {
  if (!apiUrl) return [];
  let lastError = null;
  for (const endpoint of activeSeriesEndpoints(apiUrl)) {
    try {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        lastError = new Error(body?.error || `Active series read failed (${response.status}).`);
        continue;
      }
      return normalizeActiveSeriesPayload(body);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Active series read failed.");
}

function normalizeActiveSeriesPayload(body) {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.series)
      ? body.series
      : Array.isArray(body?.rows)
        ? body.rows
        : Array.isArray(body?.data)
          ? body.data
          : [];
  return rows.map(normalizeActiveSeriesRow).filter((row) => row.strikePrice && row.maturityTimestamp);
}

function normalizeActiveSeriesRow(row) {
  const maturity = row.maturityTimestamp ?? row.maturity_timestamp ?? row.maturity ?? row.expiry ?? row.expiration ?? "";
  return {
    ...row,
    chainId: Number(row.chainId ?? row.chain_id ?? row.chain ?? 0),
    mode: String(row.mode || row.factoryMode || row.factory_mode || "").toLowerCase(),
    factoryAddress: row.factoryAddress || row.factory_address || row.factory || "",
    strikePrice: String(row.strikePrice ?? row.strike_price ?? row.strike ?? ""),
    maturityTimestamp: Number(maturity || 0),
    status: String(row.status || "active")
  };
}

export { fetchActiveSeries };
