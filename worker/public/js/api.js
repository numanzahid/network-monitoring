async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

export async function getStatus() {
  return fetchJson("/api/status");
}

export async function getOutageHistory(ispId, days) {
  return fetchJson(`/api/history/outages?isp=${encodeURIComponent(ispId)}&days=${days}`);
}

export async function getLatencyHistory(ispId, range) {
  const params = new URLSearchParams({ isp: ispId });
  if (String(range).startsWith("h:")) {
    params.set("hours", String(range).slice(2));
  } else {
    params.set("days", String(range).startsWith("d:") ? String(range).slice(2) : String(range));
  }
  return fetchJson(`/api/history/latency?${params.toString()}`);
}

export async function getSpeedtestHistory(ispId, days) {
  return fetchJson(`/api/history/speedtests?isp=${encodeURIComponent(ispId)}&days=${days}`);
}
