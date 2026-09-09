function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) {
    return "ongoing";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remaining}s`;
  }
  return `${remaining}s`;
}

function formatMbps(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return `${value.toFixed(1)} Mbps`;
}

export function renderStatusCards(container, statusPayload) {
  container.innerHTML = "";

  for (const isp of statusPayload.isps) {
    const card = document.createElement("article");
    card.className = "status-card";

    const pillClass = isp.is_up ? "up" : "down";
    const pillText = isp.is_up ? "UP" : "DOWN";

    card.innerHTML = `
      <h2>${isp.label}</h2>
      <span class="status-pill ${pillClass}">${pillText}</span>
      <dl class="status-meta">
        <dt>Last seen</dt>
        <dd>${formatDate(isp.last_seen_at)}</dd>
        <dt>Last success</dt>
        <dd>${formatDate(isp.last_success_at)}</dd>
        <dt>Public IPv4</dt>
        <dd>${isp.public_ipv4 ?? "-"}</dd>
        <dt>HTTPS latency</dt>
        <dd>${isp.checks.https_latency_ms ?? "-"} ms</dd>
        <dt>Latest speedtest</dt>
        <dd>${
          isp.latest_speedtest
            ? `${formatMbps(isp.latest_speedtest.download_mbps)} down / ${formatMbps(isp.latest_speedtest.upload_mbps)} up`
            : "-"
        }</dd>
      </dl>
    `;

    container.appendChild(card);
  }
}

export function renderOutageTable(container, historyPayload) {
  const card = document.createElement("div");
  card.className = "table-card";
  card.innerHTML = `<h3>${historyPayload.label}</h3>`;

  if (!historyPayload.outages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No outages in this period.";
    card.appendChild(empty);
    container.appendChild(card);
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Started</th>
        <th>Ended</th>
        <th>Duration</th>
        <th>Reason</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  for (const outage of historyPayload.outages) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatDate(outage.started_at)}</td>
      <td>${outage.ongoing ? "ongoing" : formatDate(outage.ended_at)}</td>
      <td>${formatDuration(outage.duration_seconds)}</td>
      <td>${outage.reason ?? "-"}</td>
    `;
    tbody.appendChild(row);
  }

  card.appendChild(table);
  container.appendChild(card);
}

export function createChartCard(title) {
  const card = document.createElement("div");
  card.className = "chart-card";
  card.innerHTML = `<h3>${title}</h3>`;

  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  card.appendChild(wrap);

  return { card, canvas };
}

export function setGeneratedAt(element, value) {
  element.textContent = `Updated ${formatDate(value)}`;
}
