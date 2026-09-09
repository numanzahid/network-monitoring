import { getOutageHistory, getSpeedtestHistory, getStatus } from "./api.js";
import { clearChartContainer, renderOutageCharts, renderSpeedtestCharts } from "./charts.js";
import {
  renderOutageTable,
  renderStatusCards,
  setGeneratedAt,
} from "./render.js";

const statusCards = document.getElementById("status-cards");
const generatedAt = document.getElementById("generated-at");
const outageCharts = document.getElementById("outage-charts");
const outageTables = document.getElementById("outage-tables");
const speedtestCharts = document.getElementById("speedtest-charts");
const outageDays = document.getElementById("outage-days");
const speedtestDays = document.getElementById("speedtest-days");
const refreshButton = document.getElementById("refresh-button");

let ispIds = [];

async function loadHistory() {
  const outageDayCount = Number(outageDays.value);
  const speedtestDayCount = Number(speedtestDays.value);

  clearChartContainer(outageCharts);
  outageTables.innerHTML = "";
  clearChartContainer(speedtestCharts);

  const outageHistories = await Promise.all(
    ispIds.map((ispId) => getOutageHistory(ispId, outageDayCount)),
  );
  const speedtestHistories = await Promise.all(
    ispIds.map((ispId) => getSpeedtestHistory(ispId, speedtestDayCount)),
  );

  renderOutageCharts(outageCharts, outageHistories);
  for (const history of outageHistories) {
    renderOutageTable(outageTables, history);
  }
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

outageDays.addEventListener("change", () => {
  loadHistory().catch(showError);
});

speedtestDays.addEventListener("change", () => {
  loadHistory().catch(showError);
});

function showError(error) {
  generatedAt.textContent = error instanceof Error ? error.message : "Failed to load status";
}

loadAll().catch(showError);
setInterval(() => {
  loadAll().catch(showError);
}, 60000);
