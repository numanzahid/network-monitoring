import { cleanupOldNonces } from "./db";
import { retryPendingNotifications } from "./notify";
import { evaluateStaleProbes } from "./outages";
import type { Env } from "./types";

export async function handleScheduled(env: Env): Promise<void> {
  await evaluateStaleProbes(env);
  await retryPendingNotifications(env);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  await cleanupOldNonces(env.DB, cutoff.toISOString());
}
