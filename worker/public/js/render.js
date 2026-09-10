function formatDate(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDateShort(value) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTimeCell(value) {
  if (!value) {
    return '<span class="datetime-cell"><span class="datetime-time">-</span></span>';
  }
  return `<span class="datetime-cell"><span class="datetime-time">${escapeHtml(formatTime(value))}</span><span class="datetime-date">${escapeHtml(formatDateShort(value))}</span></span>`;
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

function formatProvider(isp) {
  if (isp.isp_name && isp.network_asn) {
    return `${isp.isp_name} (${isp.network_asn})`;
  }
  if (isp.isp_name) {
    return isp.isp_name;
  }
  if (isp.network_asn) {
    return isp.network_asn;
  }
  return "-";
}

function renderTracerouteIp(publicIpv4, lines) {
  const hasTraceroute = lines && lines.length > 0;
  const hasIpv4 = publicIpv4 && publicIpv4.length > 0;

  if (!hasTraceroute && !hasIpv4) {
    return "";
  }

  const tracerouteBlock = hasTraceroute
    ? `<pre class="traceroute-output">${escapeHtml(lines.join("\n"))}</pre>`
    : "";

  return `
    <details class="traceroute-block">
      <summary>Traceroute / IP</summary>
      <dl class="traceroute-meta">
        <dt>Public IPv4</dt>
        <dd>${escapeHtml(publicIpv4 ?? "-")}</dd>
      </dl>
      ${tracerouteBlock}
    </details>
  `;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatMbpsCompact(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (value >= 100) {
    return `${Math.round(value)}`;
  }
  return value.toFixed(1);
}

function speedDirectionIcon(direction) {
  const isDown = direction === "down";
  const path = isDown ? "M2.5 4.5h7L6 9.5z" : "M2.5 7.5h7L6 2.5z";
  const label = isDown ? "Download" : "Upload";
  const className = isDown ? "speed-icon-down" : "speed-icon-up";

  return `<svg class="speed-icon ${className}" viewBox="0 0 12 12" aria-hidden="true"><title>${label}</title><path d="${path}" fill="currentColor"/></svg>`;
}

function formatSpeedtestCompact(speedtest) {
  if (!speedtest) {
    return "-";
  }

  const down = formatMbpsCompact(speedtest.download_mbps);
  const up = formatMbpsCompact(speedtest.upload_mbps);

  return `<span class="speedtest-compact"><span class="speedtest-item" title="Download">${speedDirectionIcon("down")}${down}</span><span class="speedtest-item" title="Upload">${speedDirectionIcon("up")}${up}</span><span class="speedtest-unit">Mbps</span></span>`;
}

function formatHeartbeatAge(seconds, stale) {
  if (seconds === null || seconds === undefined) {
    return "-";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const text = remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
  return stale ? `${text} (stale)` : text;
}

function pillTextForState(displayState) {
  if (displayState === "stale") {
    return "STALE";
  }
  if (displayState === "down") {
    return "DOWN";
  }
  return "UP";
}

function createStatusCard(isp) {
  const card = document.createElement("article");
  card.className = "status-card";
  card.dataset.ispId = isp.isp_id;

  card.innerHTML = `
    <h2 data-field="label"></h2>
    <span class="status-pill" data-field="pill"></span>
    <dl class="status-meta">
      <div class="status-meta-row">
        <div>
          <dt>Last heartbeat</dt>
          <dd data-field="heartbeat"></dd>
        </div>
        <div>
          <dt>Probe silent (24h)</dt>
          <dd data-field="missed"></dd>
        </div>
      </div>
      <dt>Network provider</dt>
      <dd data-field="provider"></dd>
      <div class="status-meta-row">
        <div>
          <dt>Latency</dt>
          <dd data-field="https-latency"></dd>
        </div>
        <div>
          <dt>Speedtest</dt>
          <dd data-field="speedtest"></dd>
        </div>
      </div>
    </dl>
    <div data-field="traceroute"></div>
  `;

  applyStatusCard(card, isp);
  return card;
}

function applyStatusCard(card, isp) {
  const displayState = isp.display_state ?? (isp.is_up ? "up" : "down");
  const pill = card.querySelector('[data-field="pill"]');

  card.querySelector('[data-field="label"]').textContent = isp.label;
  pill.textContent = pillTextForState(displayState);
  pill.className = `status-pill ${displayState}`;

  const heartbeat = card.querySelector('[data-field="heartbeat"]');
  heartbeat.textContent = formatHeartbeatAge(isp.heartbeat_age_seconds, isp.heartbeat_stale);
  heartbeat.className = isp.heartbeat_stale ? "text-stale" : "";

  card.querySelector('[data-field="missed"]').textContent = `${isp.missed_heartbeat_minutes_24h ?? 0} min`;
  card.querySelector('[data-field="provider"]').textContent = formatProvider(isp);
  card.querySelector('[data-field="https-latency"]').textContent = `${isp.checks.https_latency_ms ?? "-"} ms`;
  card.querySelector('[data-field="speedtest"]').innerHTML = formatSpeedtestCompact(
    isp.latest_speedtest,
  );

  const tracerouteHost = card.querySelector('[data-field="traceroute"]');
  tracerouteHost.innerHTML = renderTracerouteIp(isp.public_ipv4, isp.traceroute);
}

export function mountStatusCards(container, statusPayload) {
  container.innerHTML = "";
  for (const isp of statusPayload.isps) {
    container.appendChild(createStatusCard(isp));
  }
}

export function updateStatusCards(container, statusPayload) {
  for (const isp of statusPayload.isps) {
    const card = container.querySelector(`[data-isp-id="${isp.isp_id}"]`);
    if (!card) {
      mountStatusCards(container, statusPayload);
      return;
    }
    applyStatusCard(card, isp);
  }
}

function renderIspEventTableCard(label, rows, emptyMessage, includeReason = false) {
  const card = document.createElement("div");
  card.className = "table-card";
  card.innerHTML = `<h4 class="table-card-title">${label}</h4>`;

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    card.appendChild(empty);
    return card;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Started</th>
        <th>Ended</th>
        <th>Duration</th>
        ${includeReason ? "<th>Reason</th>" : ""}
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTimeCell(row.started_at)}</td>
      <td>${row.ongoing ? '<span class="ongoing-label">ongoing</span>' : formatDateTimeCell(row.ended_at)}</td>
      <td class="duration-cell">${formatDuration(row.duration_seconds)}</td>
      ${includeReason ? `<td>${row.reason ?? "-"}</td>` : ""}
    `;
    tbody.appendChild(tr);
  }

  card.appendChild(table);
  return card;
}

function renderIspTableSection(
  container,
  title,
  histories,
  getRows,
  emptyMessage,
  includeReason = false,
) {
  const hasAnyRows = histories.some((history) => getRows(history).length > 0);
  if (!hasAnyRows) {
    return;
  }

  const section = document.createElement("div");
  section.className = "table-section";
  section.innerHTML = `<h3 class="subsection-title">${title}</h3>`;

  const columns = document.createElement("div");
  columns.className = "table-columns";

  for (const history of histories) {
    columns.appendChild(
      renderIspEventTableCard(history.label, getRows(history), emptyMessage, includeReason),
    );
  }

  section.appendChild(columns);
  container.appendChild(section);
}

export function renderHeartbeatGapLog(container, histories) {
  renderIspTableSection(
    container,
    "Heartbeat gaps",
    histories,
    (history) => history.gaps ?? [],
    "No heartbeat gaps in this period.",
    false,
  );
}

export function renderOutageLog(container, histories) {
  renderIspTableSection(
    container,
    "Outage log",
    histories,
    (history) => history.outages ?? [],
    "No outages in this period.",
    false,
  );
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
