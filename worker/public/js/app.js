import {
  getLatencyHistory,
  getOutageHistory,
  getSpeedtestHistory,
  getStatus,
} from "./api.js";
import {
  clearChartContainer,
  mountLatencyCharts,
  mountSpeedtestCharts,
  resetLatencyCharts,
  resetSpeedtestCharts,
  updateLatencyCharts,
} from "./charts.js";
import {
  mountStatusCards,
  renderHeartbeatGapLog,
  renderOutageLog,
  setGeneratedAt,
  updateStatusCards,
} from "./render.js";

const statusCards = document.getElementById("status-cards");
const generatedAt = document.getElementById("generated-at");
const latencyCharts = document.getElementById("latency-charts");
const historyTables = document.getElementById("history-tables");
const speedtestCharts = document.getElementById("speedtest-charts");
const latencyDays = document.getElementById("latency-days");
const speedtestDays = document.getElementById("speedtest-days");
const tableDays = document.getElementById("table-days");

let ispIds = [];
let latencyChartsMounted = false;
let speedtestChartsMounted = false;
let tablesMounted = false;
let mountedLatencyDayCount = null;
let mountedSpeedtestDayCount = null;
let mountedTableDayCount = null;

function selectedLatencyDayCount() {
  return Number(latencyDays.value);
}

function selectedSpeedtestDayCount() {
  return Number(speedtestDays.value);
}

function selectedTableDayCount() {
  return Number(tableDays.value);
}

async function fetchLatencyHistories(dayCount) {
  return Promise.all(ispIds.map((ispId) => getLatencyHistory(ispId, dayCount)));
}

async function fetchSpeedtestHistories(dayCount) {
  return Promise.all(ispIds.map((ispId) => getSpeedtestHistory(ispId, dayCount)));
}

async function fetchTableHistories(dayCount) {
  const [outageHistories, latencyHistories] = await Promise.all([
    Promise.all(ispIds.map((ispId) => getOutageHistory(ispId, dayCount))),
    Promise.all(ispIds.map((ispId) => getLatencyHistory(ispId, dayCount))),
  ]);
  return { outageHistories, latencyHistories };
}

function renderHistoryTables(outageHistories, latencyHistories) {
  historyTables.innerHTML = "";
  renderOutageLog(historyTables, outageHistories);
  renderHeartbeatGapLog(historyTables, latencyHistories);
}

async function mountLatencyChartsSection(dayCount) {
  resetLatencyCharts();
  clearChartContainer(latencyCharts);

  const latencyHistories = await fetchLatencyHistories(dayCount);
  mountLatencyCharts(latencyCharts, latencyHistories);

  latencyChartsMounted = true;
  mountedLatencyDayCount = dayCount;
}

async function mountSpeedtestChartsSection(dayCount) {
  resetSpeedtestCharts();
  clearChartContainer(speedtestCharts);

  const speedtestHistories = await fetchSpeedtestHistories(dayCount);
  mountSpeedtestCharts(speedtestCharts, speedtestHistories);

  speedtestChartsMounted = true;
  mountedSpeedtestDayCount = dayCount;
}

async function loadLatencyCharts({ remount = false } = {}) {
  const dayCount = selectedLatencyDayCount();
  const needsRemount = remount || !latencyChartsMounted || mountedLatencyDayCount !== dayCount;

  if (needsRemount) {
    await mountLatencyChartsSection(dayCount);
    return;
  }

  const latencyHistories = await fetchLatencyHistories(dayCount);
  updateLatencyCharts(latencyHistories);
}

async function loadSpeedtestCharts({ remount = false } = {}) {
  const dayCount = selectedSpeedtestDayCount();
  const needsRemount = remount || !speedtestChartsMounted || mountedSpeedtestDayCount !== dayCount;

  if (needsRemount) {
    await mountSpeedtestChartsSection(dayCount);
  }
}

async function mountTables(dayCount) {
  const { outageHistories, latencyHistories } = await fetchTableHistories(dayCount);
  renderHistoryTables(outageHistories, latencyHistories);
  tablesMounted = true;
  mountedTableDayCount = dayCount;
}

async function loadTables({ remount = false } = {}) {
  const dayCount = selectedTableDayCount();
  const needsRemount = remount || !tablesMounted || mountedTableDayCount !== dayCount;

  if (needsRemount) {
    await mountTables(dayCount);
  }
}

async function refreshLiveData() {
  const status = await getStatus();
  ispIds = status.isps.map((isp) => isp.isp_id);

  if (statusCards.children.length === 0) {
    mountStatusCards(statusCards, status);
  } else {
    updateStatusCards(statusCards, status);
  }

  setGeneratedAt(generatedAt, status.generated_at);
  await loadLatencyCharts();
}

async function loadAll({
  remountLatencyCharts = false,
  remountSpeedtestCharts = false,
  remountTables = false,
} = {}) {
  const status = await getStatus();
  ispIds = status.isps.map((isp) => isp.isp_id);

  if (statusCards.children.length === 0) {
    mountStatusCards(statusCards, status);
  } else {
    updateStatusCards(statusCards, status);
  }

  setGeneratedAt(generatedAt, status.generated_at);
  await Promise.all([
    loadLatencyCharts({ remount: remountLatencyCharts }),
    loadSpeedtestCharts({ remount: remountSpeedtestCharts }),
    loadTables({ remount: remountTables }),
  ]);
}

latencyDays.addEventListener("change", () => {
  loadLatencyCharts({ remount: true }).catch(showError);
});

speedtestDays.addEventListener("change", () => {
  loadSpeedtestCharts({ remount: true }).catch(showError);
});

tableDays.addEventListener("change", () => {
  loadTables({ remount: true }).catch(showError);
});

function showError(error) {
  generatedAt.textContent = error instanceof Error ? error.message : "Failed to load status";
}

loadAll({
  remountLatencyCharts: true,
  remountSpeedtestCharts: true,
  remountTables: true,
}).catch(showError);
setInterval(() => {
  refreshLiveData().catch(showError);
}, 15000);
