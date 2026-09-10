import {
  cleanupOldHeartbeatGaps,
  cleanupOldLatencySamples,
  cleanupOldNonces,
} from "./db";
import { retryPendingNotifications } from "./notify";
import { evaluateStaleProbes } from "./outages";
import type { Env } from "./types";

export async function handleScheduled(env: Env): Promise<void> {
  await evaluateStaleProbes(env);
  await retryPendingNotifications(env);

  const nonceCutoff = new Date();
  nonceCutoff.setUTCDate(nonceCutoff.getUTCDate() - 2);
  await cleanupOldNonces(env.DB, nonceCutoff.toISOString());

  const latencyCutoff = new Date();
  latencyCutoff.setUTCDate(latencyCutoff.getUTCDate() - 30);
  await cleanupOldLatencySamples(env.DB, latencyCutoff.toISOString());

  const gapCutoff = new Date();
  gapCutoff.setUTCDate(gapCutoff.getUTCDate() - 30);
  await cleanupOldHeartbeatGaps(env.DB, gapCutoff.toISOString());
}
