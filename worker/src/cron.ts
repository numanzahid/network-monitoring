import {
  cleanupOldHeartbeatGaps,
  cleanupOldLatencyHourly,
  cleanupOldLatencySamples,
  cleanupOldNonces,
} from "./db";
import { retryPendingNotifications } from "./notify";
import { evaluateStaleProbes } from "./outages";
import type { Env } from "./types";

async function runDailyCleanup(env: Env): Promise<void> {
  const nonceCutoff = new Date();
  nonceCutoff.setUTCDate(nonceCutoff.getUTCDate() - 2);
  await cleanupOldNonces(env.DB, nonceCutoff.toISOString());

  const latencyCutoff = new Date();
  latencyCutoff.setUTCDate(latencyCutoff.getUTCDate() - 30);
  const latencyCutoffIso = latencyCutoff.toISOString();
  await cleanupOldLatencySamples(env.DB, latencyCutoffIso);
  await cleanupOldLatencyHourly(env.DB, latencyCutoffIso);

  const gapCutoff = new Date();
  gapCutoff.setUTCDate(gapCutoff.getUTCDate() - 30);
  await cleanupOldHeartbeatGaps(env.DB, gapCutoff.toISOString());
}

export async function handleScheduled(env: Env): Promise<void> {
  await evaluateStaleProbes(env);
  await retryPendingNotifications(env);

  const now = new Date();
  if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
    await runDailyCleanup(env);
  }
}
