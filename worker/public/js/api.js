async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

async function fetchHistory(path, fallback) {
  try {
    return await fetchJson(path);
  } catch (error) {
    if (error instanceof Error && error.message.includes("(410)")) {
      return fallback;
    }
    throw error;
  }
}

export async function getStatus() {
  return fetchJson("/api/status");
}

export async function getOutageHistory(ispId, days) {
  return fetchHistory(
    `/api/history/outages?isp=${encodeURIComponent(ispId)}&days=${days}`,
    { isp_id: ispId, label: ispId.toUpperCase(), days, uptime_percent: null, outages: [], history_available: false },
  );
}

export async function getLatencyHistory(ispId, range) {
  const params = new URLSearchParams({ isp: ispId });
  if (String(range).startsWith("h:")) {
    params.set("hours", String(range).slice(2));
  } else {
    params.set("days", String(range).startsWith("d:") ? String(range).slice(2) : String(range));
  }
  return fetchHistory(
    `/api/history/latency?${params.toString()}`,
    { isp_id: ispId, label: ispId.toUpperCase(), granularity: "sample", points: [], gaps: [], history_available: false },
  );
}

export async function getSpeedtestHistory(ispId, days) {
  return fetchHistory(
    `/api/history/speedtests?isp=${encodeURIComponent(ispId)}&days=${days}`,
    { isp_id: ispId, label: ispId.toUpperCase(), days, results: [], history_available: false },
  );
}
