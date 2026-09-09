const chartInstances = [];

function destroyCharts() {
  for (const chart of chartInstances) {
    chart.destroy();
  }
  chartInstances.length = 0;
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

export function renderOutageCharts(container, histories) {
  destroyCharts();

  for (const history of histories) {
    const { card, canvas } = createOutageChartCard(history);
    container.appendChild(card);

    const segments = outageSegments(history.outages, history.days);
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

function createOutageChartCard(history) {
  const card = document.createElement("div");
  card.className = "chart-card";
  card.innerHTML = `<h3>${history.label} outages</h3>`;
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  card.appendChild(wrap);
  return { card, canvas };
}

export function renderSpeedtestCharts(container, histories) {
  for (const history of histories) {
    const { card, canvas } = createSpeedtestChartCard(history);
    container.appendChild(card);

    const labels = history.results.map((result) => result.recorded_at);
    const download = history.results.map((result) => result.download_mbps);
    const upload = history.results.map((result) => result.upload_mbps);

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

function createSpeedtestChartCard(history) {
  const card = document.createElement("div");
  card.className = "chart-card";
  card.innerHTML = `<h3>${history.label} speedtests</h3>`;
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  card.appendChild(wrap);
  return { card, canvas };
}

export function clearChartContainer(container) {
  destroyCharts();
  container.innerHTML = "";
}
