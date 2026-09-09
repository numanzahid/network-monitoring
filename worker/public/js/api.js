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

export async function getLatencyHistory(ispId, days) {
  return fetchJson(`/api/history/latency?isp=${encodeURIComponent(ispId)}&days=${days}`);
}

export async function getSpeedtestHistory(ispId, days) {
  return fetchJson(`/api/history/speedtests?isp=${encodeURIComponent(ispId)}&days=${days}`);
}
