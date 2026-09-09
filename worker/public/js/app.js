import {
  getLatencyHistory,
  getOutageHistory,
  getSpeedtestHistory,
  getStatus,
} from "./api.js";
import {
  clearChartContainer,
  renderLatencyCharts,
  renderOutageCharts,
  renderSpeedtestCharts,
} from "./charts.js";
import {
  renderOutageLog,
  renderStatusCards,
  setGeneratedAt,
} from "./render.js";

const statusCards = document.getElementById("status-cards");
const generatedAt = document.getElementById("generated-at");
const outageCharts = document.getElementById("outage-charts");
const latencyCharts = document.getElementById("latency-charts");
const outageTables = document.getElementById("outage-tables");
const speedtestCharts = document.getElementById("speedtest-charts");
const historyDays = document.getElementById("history-days");
const refreshButton = document.getElementById("refresh-button");

let ispIds = [];

function selectedDayCount() {
  return Number(historyDays.value);
}

async function loadHistory() {
  const dayCount = selectedDayCount();

  clearChartContainer(outageCharts);
  clearChartContainer(latencyCharts);
  outageTables.innerHTML = "";
  clearChartContainer(speedtestCharts);

  const outageHistories = await Promise.all(
    ispIds.map((ispId) => getOutageHistory(ispId, dayCount)),
  );
  const latencyHistories = await Promise.all(
    ispIds.map((ispId) => getLatencyHistory(ispId, dayCount)),
  );
  const speedtestHistories = await Promise.all(
    ispIds.map((ispId) => getSpeedtestHistory(ispId, dayCount)),
  );

  renderOutageCharts(outageCharts, outageHistories);
  renderLatencyCharts(latencyCharts, latencyHistories);
  renderOutageLog(outageTables, outageHistories);
  renderSpeedtestCharts(speedtestCharts, speedtestHistories);
}

async function loadAll() {
  const status = await getStatus();
  ispIds = status.isps.map((isp) => isp.isp_id);
  renderStatusCards(statusCards, status);
  setGeneratedAt(generatedAt, status.generated_at);
  await loadHistory();
}

refreshButton.addEventListener("click", () => {
  loadAll().catch(showError);
});

historyDays.addEventListener("change", () => {
  loadHistory().catch(showError);
});

function showError(error) {
  generatedAt.textContent = error instanceof Error ? error.message : "Failed to load status";
}

loadAll().catch(showError);
setInterval(() => {
  loadAll().catch(showError);
}, 60000);
