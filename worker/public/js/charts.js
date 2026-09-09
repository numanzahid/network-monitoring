const chartInstances = [];

function destroyCharts() {
  for (const chart of chartInstances) {
    chart.destroy();
  }
  chartInstances.length = 0;
}

function formatTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function outageSegments(outages, days) {
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const segments = [];

  for (const outage of outages) {
    const segmentStart = Math.max(Date.parse(outage.started_at), start);
    const segmentEnd = outage.ended_at
      ? Math.min(Date.parse(outage.ended_at), end)
      : end;
    if (segmentEnd > segmentStart) {
      segments.push({
        label: new Date(segmentStart).toLocaleString(),
        minutes: Math.round((segmentEnd - segmentStart) / 60000),
      });
    }
  }

  return segments;
}

function createChartCard(title) {
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

function showEmptyState(container, message) {
  const empty = document.createElement("p");
  empty.className = "empty-state section-empty";
  empty.textContent = message;
  container.appendChild(empty);
}

function showEmptyChart(card, message) {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  card.querySelector(".chart-wrap").replaceWith(empty);
}

export function renderOutageCharts(container, histories) {
  const hasOutages = histories.some((history) => history.outages.length > 0);
  if (!hasOutages) {
    showEmptyState(container, "No outages recorded in this period.");
    return;
  }

  for (const history of histories) {
    const segments = outageSegments(history.outages, history.days);
    if (!segments.length) {
      continue;
    }

    const { card, canvas } = createChartCard(`${history.label} outage duration`);
    container.appendChild(card);

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: segments.map((segment) => segment.label),
        datasets: [
          {
            label: "Outage minutes",
            data: segments.map((segment) => segment.minutes),
            backgroundColor: "#dc2626",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true },
            grid: { color: "#1f2937" },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Minutes", color: "#9ca3af" },
            ticks: { color: "#9ca3af" },
            grid: { color: "#1f2937" },
          },
        },
        plugins: {
          legend: { labels: { color: "#e5e7eb" } },
          title: {
            display: true,
            text: `${history.uptime_percent}% uptime`,
            color: "#e5e7eb",
          },
        },
      },
    });

    chartInstances.push(chart);
  }
}

export function renderLatencyCharts(container, histories) {
  for (const history of histories) {
    const { card, canvas } = createChartCard(`${history.label} probe HTTPS latency`);
    container.appendChild(card);

    const points = history.points ?? [];
    if (!points.length) {
      showEmptyChart(
        card,
        "No probe latency history yet. Points appear as heartbeats are stored.",
      );
      continue;
    }

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: points.map((point) => formatTimeLabel(point.recorded_at)),
        datasets: [
          {
            label: "HTTPS latency (ms)",
            data: points.map((point) => point.latency_ms),
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.15)",
            fill: true,
            tension: 0.2,
            pointRadius: history.granularity === "sample" ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true },
            grid: { color: "#1f2937" },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Milliseconds", color: "#9ca3af" },
            ticks: { color: "#9ca3af" },
            grid: { color: "#1f2937" },
          },
        },
        plugins: {
          legend: { labels: { color: "#e5e7eb" } },
        },
      },
    });

    chartInstances.push(chart);
  }
}

export function renderSpeedtestCharts(container, histories) {
  for (const history of histories) {
    const { card, canvas } = createChartCard(`${history.label} speedtests`);
    container.appendChild(card);

    const results = history.results ?? [];
    if (!results.length) {
      showEmptyChart(card, "No speedtest results in this period.");
      continue;
    }

    const labels = results.map((result) => result.recorded_at);
    const download = results.map((result) => result.download_mbps);
    const upload = results.map((result) => result.upload_mbps);

    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Download Mbps",
            data: download,
            borderColor: "#38bdf8",
            tension: 0.2,
          },
          {
            label: "Upload Mbps",
            data: upload,
            borderColor: "#a855f7",
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: "#9ca3af", maxRotation: 0, autoSkip: true },
            grid: { color: "#1f2937" },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#9ca3af" },
            grid: { color: "#1f2937" },
          },
        },
        plugins: {
          legend: { labels: { color: "#e5e7eb" } },
        },
      },
    });

    chartInstances.push(chart);
  }
}

export function clearChartContainer(container) {
  destroyCharts();
  container.innerHTML = "";
}
