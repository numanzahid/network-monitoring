const chartRegistry = new Map();
let resizeListenerBound = false;

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  parsing: false,
  animation: false,
  events: ["mousemove", "mouseout", "click", "touchstart", "touchmove", "touchend"],
};

function scheduleChartResize(chart) {
  requestAnimationFrame(() => {
    chart.resize();
  });
}

function bindResizeListener() {
  if (resizeListenerBound) {
    return;
  }
  resizeListenerBound = true;
  window.addEventListener("resize", () => {
    for (const chart of chartRegistry.values()) {
      chart.resize();
    }
  });
}

function destroyAllCharts() {
  for (const chart of chartRegistry.values()) {
    chart.destroy();
  }
  chartRegistry.clear();
}

function destroyChartsByType(type) {
  for (const [key, chart] of chartRegistry.entries()) {
    if (key.startsWith(`${type}-`)) {
      chart.destroy();
      chartRegistry.delete(key);
    }
  }
}

function toTimestamp(isoTime) {
  const ms = Date.parse(isoTime);
  return Number.isFinite(ms) ? ms : null;
}

function formatAxisTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTooltipTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function linePointStyle(color, visibleRadius = 2) {
  return {
    pointRadius: (context) => (context.parsed.y === null ? 0 : visibleRadius),
    pointHoverRadius: (context) => (context.parsed.y === null ? 0 : 5),
    pointHitRadius: 14,
    pointBackgroundColor: color,
    pointBorderColor: color,
    pointBorderWidth: 0,
  };
}

function setChartTooltipActive(chart, elements, position) {
  chart.setActiveElements(elements);
  chart.tooltip?.setActiveElements(elements, position);
  chart.update("none");
}

function buildChartOptions(yAxisLabel, valueUnit) {
  return {
    ...chartOptions,
    interaction: {
      mode: "nearest",
      axis: "x",
      intersect: false,
    },
    onClick(event, elements, chart) {
      if (!elements.length) {
        setChartTooltipActive(chart, [], { x: 0, y: 0 });
        return;
      }
      setChartTooltipActive(chart, elements, { x: event.x, y: event.y });
    },
    scales: {
      x: timeScaleOptions(),
      y: {
        beginAtZero: true,
        title: { display: true, text: yAxisLabel, color: "#9ca3af" },
        ticks: { color: "#9ca3af" },
        grid: { color: "#1f2937" },
      },
    },
    plugins: {
      legend: { labels: { color: "#e5e7eb" } },
      tooltip: {
        enabled: true,
        backgroundColor: "rgba(17, 24, 39, 0.96)",
        titleColor: "#e5e7eb",
        bodyColor: "#d1d5db",
        borderColor: "#374151",
        borderWidth: 1,
        padding: 10,
        displayColors: true,
        callbacks: {
          title(items) {
            if (!items.length) {
              return "";
            }
            const x = items[0].parsed.x;
            return Number.isFinite(x) ? formatTooltipTime(x) : "";
          },
          label(context) {
            const value = context.parsed.y;
            if (value === null || value === undefined) {
              return null;
            }
            const label = context.dataset.label ?? "";
            const formatted =
              typeof value === "number" && !Number.isInteger(value)
                ? value.toFixed(1)
                : `${value}`;
            return `${label}: ${formatted} ${valueUnit}`;
          },
          filter(item) {
            return item.parsed.y !== null && item.parsed.y !== undefined;
          },
        },
      },
    },
  };
}

function pointInGap(isoTime, gaps) {
  const ms = toTimestamp(isoTime);
  if (ms === null) {
    return false;
  }

  for (const gap of gaps ?? []) {
    const start = toTimestamp(gap.started_at);
    const end = gap.ended_at ? toTimestamp(gap.ended_at) : Date.now();
    if (start !== null && end !== null && ms > start && ms < end) {
      return true;
    }
  }

  return false;
}

function filterPointsOutsideGaps(points, gaps) {
  if (!gaps?.length) {
    return points;
  }
  return points.filter((point) => !pointInGap(point.recorded_at, gaps));
}

function buildSeries(points, gaps, valueKey) {
  const rows = [];

  for (const point of points) {
    const x = toTimestamp(point.recorded_at);
    if (x === null) {
      continue;
    }
    rows.push({ x, y: point[valueKey] });
  }

  for (const gap of gaps ?? []) {
    const start = toTimestamp(gap.started_at);
    const end = gap.ended_at ? toTimestamp(gap.ended_at) : Date.now();
    if (start !== null) {
      rows.push({ x: start, y: null });
    }
    if (end !== null) {
      rows.push({ x: end, y: null });
    }
  }

  return rows.sort((left, right) => left.x - right.x);
}

function timeScaleOptions() {
  return {
    type: "linear",
    ticks: {
      color: "#9ca3af",
      maxRotation: 0,
      autoSkip: true,
      callback: (value) => formatAxisTime(value),
    },
    grid: { color: "#1f2937" },
  };
}

function latencyTitle(history) {
  const gapCount = history.gaps?.length ?? 0;
  const gapNote = gapCount ? ` - ${gapCount} silent period${gapCount === 1 ? "" : "s"}` : "";
  return `${history.label} HTTPS latency${gapNote}`;
}

function buildLatencyChartData(history) {
  const rawPoints = history.points ?? [];
  const gaps = history.gaps ?? [];
  const points = filterPointsOutsideGaps(rawPoints, gaps);

  if (!points.length) {
    return null;
  }

  if (history.granularity === "hour") {
    return {
      datasets: [
        {
          label: "Low",
          data: buildSeries(points, gaps, "min_latency_ms"),
          borderColor: "#22c55e",
          backgroundColor: "rgba(34, 197, 94, 0.08)",
          tension: 0,
          spanGaps: false,
          ...linePointStyle("#22c55e"),
        },
        {
          label: "High",
          data: buildSeries(points, gaps, "max_latency_ms"),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.12)",
          tension: 0,
          spanGaps: false,
          ...linePointStyle("#ef4444"),
        },
      ],
    };
  }

  return {
    datasets: [
      {
        label: "Latency",
        data: buildSeries(points, gaps, "latency_ms"),
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56, 189, 248, 0.15)",
        fill: false,
        tension: 0,
        spanGaps: false,
        ...linePointStyle("#38bdf8"),
      },
    ],
  };
}

function buildSpeedtestChartData(history) {
  const results = history.results ?? [];
  if (!results.length) {
    return null;
  }

  return {
    datasets: [
      {
        label: "Download",
        data: results
          .map((result) => ({
            x: toTimestamp(result.recorded_at),
            y: result.download_mbps,
          }))
          .filter((point) => point.x !== null),
        borderColor: "#38bdf8",
        tension: 0,
        spanGaps: false,
        ...linePointStyle("#38bdf8", 3),
      },
      {
        label: "Upload",
        data: results
          .map((result) => ({
            x: toTimestamp(result.recorded_at),
            y: result.upload_mbps,
          }))
          .filter((point) => point.x !== null),
        borderColor: "#a855f7",
        tension: 0,
        spanGaps: false,
        ...linePointStyle("#a855f7", 3),
      },
    ],
  };
}

function createChartCard(title, chartKey) {
  const card = document.createElement("div");
  card.className = "chart-card";
  card.dataset.chartKey = chartKey;

  const heading = document.createElement("h3");
  heading.textContent = title;
  card.appendChild(heading);

  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  card.appendChild(wrap);

  return { card, canvas, heading };
}

function showEmptyChart(card, message) {
  const existingWrap = card.querySelector(".chart-wrap");
  if (existingWrap) {
    existingWrap.replaceWith(createEmptyState(message));
    return;
  }
  const empty = card.querySelector(".empty-state");
  if (empty) {
    empty.textContent = message;
  }
}

function createEmptyState(message) {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function ensureChart(card, canvas, chartKey, data, yAxisLabel, valueUnit) {
  const existing = chartRegistry.get(chartKey);
  if (!data) {
    if (existing) {
      existing.destroy();
      chartRegistry.delete(chartKey);
    }
    showEmptyChart(
      card,
      "No data for this period. Run npm run db:seed in worker/ for local demo data.",
    );
    return;
  }

  const empty = card.querySelector(".empty-state");
  if (empty) {
    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    const newCanvas = document.createElement("canvas");
    wrap.appendChild(newCanvas);
    empty.replaceWith(wrap);
    canvas = newCanvas;
  }

  const options = buildChartOptions(yAxisLabel, valueUnit);

  if (existing) {
    existing.data = data;
    existing.options = options;
    existing.update("none");
    scheduleChartResize(existing);
    return;
  }

  const chart = new Chart(canvas, {
    type: "line",
    data,
    options,
  });
  chartRegistry.set(chartKey, chart);
  bindResizeListener();
  scheduleChartResize(chart);
}

function mountChartSection(
  container,
  histories,
  type,
  titleBuilder,
  dataBuilder,
  yAxisLabel,
  valueUnit,
) {
  container.innerHTML = "";

  for (const history of histories) {
    const chartKey = `${type}-${history.isp_id}`;
    const { card, canvas, heading } = createChartCard(titleBuilder(history), chartKey);
    container.appendChild(card);

    const data = dataBuilder(history);
    if (!data) {
      showEmptyChart(card, "No data for this period. Run npm run db:seed in worker/ for local demo data.");
      continue;
    }

    heading.textContent = titleBuilder(history);
    ensureChart(card, canvas, chartKey, data, yAxisLabel, valueUnit);
  }
}

function updateChartSection(
  histories,
  type,
  titleBuilder,
  dataBuilder,
  yAxisLabel,
  valueUnit,
) {
  for (const history of histories) {
    const chartKey = `${type}-${history.isp_id}`;
    const card = document.querySelector(`[data-chart-key="${chartKey}"]`);
    if (!card) {
      continue;
    }

    const heading = card.querySelector("h3");
    if (heading) {
      heading.textContent = titleBuilder(history);
    }

    const canvas = card.querySelector("canvas");
    const data = dataBuilder(history);
    ensureChart(card, canvas, chartKey, data, yAxisLabel, valueUnit);
  }
}

export function mountLatencyCharts(container, histories) {
  mountChartSection(
    container,
    histories,
    "latency",
    latencyTitle,
    buildLatencyChartData,
    "Milliseconds",
    "ms",
  );
}

export function updateLatencyCharts(histories) {
  updateChartSection(
    histories,
    "latency",
    latencyTitle,
    buildLatencyChartData,
    "Milliseconds",
    "ms",
  );
}

export function mountSpeedtestCharts(container, histories) {
  mountChartSection(
    container,
    histories,
    "speedtest",
    (history) => `${history.label} speedtests`,
    buildSpeedtestChartData,
    "Mbps",
    "Mbps",
  );
}

export function updateSpeedtestCharts(histories) {
  updateChartSection(
    histories,
    "speedtest",
    (history) => `${history.label} speedtests`,
    buildSpeedtestChartData,
    "Mbps",
    "Mbps",
  );
}

export function resetAllCharts() {
  destroyAllCharts();
}

export function resetLatencyCharts() {
  destroyChartsByType("latency");
}

export function resetSpeedtestCharts() {
  destroyChartsByType("speedtest");
}

export function clearChartContainer(container) {
  container.innerHTML = "";
}
