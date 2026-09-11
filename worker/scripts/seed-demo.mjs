#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const now = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const STALE_SECONDS = 120;
const UP_HEARTBEAT_AGE_MS = 30 * 1000;
// ISP2 starts UP; crosses the 120s stale threshold about 60s after seed.
const ISP2_HEARTBEAT_AGE_MS = 60 * 1000;

function iso(ms) {
  return new Date(ms).toISOString();
}

function sqlString(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return value === null || value === undefined ? "NULL" : String(value);
}

const statements = [];

function add(sql) {
  statements.push(sql);
}

function inRanges(ms, ranges) {
  return ranges.some(([start, end]) => ms >= start && ms < end);
}

const isp1Gaps = [
  [now - 6 * DAY_MS - 2 * HOUR_MS, now - 6 * DAY_MS - 75 * MINUTE_MS],
  [now - 5 * DAY_MS - 4 * HOUR_MS, now - 5 * DAY_MS - 3 * HOUR_MS - 15 * MINUTE_MS],
  [now - 2 * DAY_MS - 30 * MINUTE_MS, now - 2 * DAY_MS - 18 * MINUTE_MS],
  [now - 8 * HOUR_MS - 20 * MINUTE_MS, now - 8 * HOUR_MS - 6 * MINUTE_MS],
];

const isp2Gaps = [
  [now - 4 * DAY_MS - 6 * HOUR_MS, now - 4 * DAY_MS - 4 * HOUR_MS],
  [now - 3 * DAY_MS - 90 * MINUTE_MS, now - 3 * DAY_MS - 55 * MINUTE_MS],
  [now - 26 * HOUR_MS - 15 * MINUTE_MS, now - 26 * HOUR_MS - 3 * MINUTE_MS],
  [now - 3 * HOUR_MS - 10 * MINUTE_MS, now - 3 * HOUR_MS - 2 * MINUTE_MS],
];

const outages = [
  {
    isp_id: "isp1",
    started_at: iso(now - 5 * DAY_MS - 4 * HOUR_MS),
    ended_at: iso(now - 5 * DAY_MS - 3 * HOUR_MS - 15 * MINUTE_MS),
    duration_seconds: 45 * 60,
    reason: "heartbeat_missing",
  },
  {
    isp_id: "isp1",
    started_at: iso(now - 1 * DAY_MS - 2 * HOUR_MS),
    ended_at: iso(now - 1 * DAY_MS - 105 * MINUTE_MS),
    duration_seconds: 15 * 60,
    reason: "dns,https",
  },
  {
    isp_id: "isp2",
    started_at: iso(now - 4 * DAY_MS - 6 * HOUR_MS),
    ended_at: iso(now - 4 * DAY_MS - 4 * HOUR_MS),
    duration_seconds: 2 * 60 * 60,
    reason: "heartbeat_missing",
  },
  {
    isp_id: "isp2",
    started_at: iso(now - 12 * HOUR_MS - 25 * MINUTE_MS),
    ended_at: iso(now - 12 * HOUR_MS - 5 * MINUTE_MS),
    duration_seconds: 20 * 60,
    reason: "internet",
  },
];

function gapRows(ispId, ranges) {
  return ranges.map(([start, end]) => ({
    isp_id: ispId,
    started_at: iso(start),
    ended_at: iso(end),
    duration_seconds: Math.floor((end - start) / 1000),
    reason: "heartbeat_missing",
    created_at: iso(start),
  }));
}

const heartbeatGaps = [
  ...gapRows("isp1", isp1Gaps),
  ...gapRows("isp2", isp2Gaps),
];

function latencyForIsp(ispId, gaps) {
  const rows = [];
  const start = now - 7 * DAY_MS;

  for (let ms = start; ms <= now; ms += 5 * MINUTE_MS) {
    if (inRanges(ms, gaps)) {
      continue;
    }
    const base = ispId === "isp1" ? 28 : 34;
    const jitter = Math.floor(Math.random() * 18);
    rows.push({
      isp_id: ispId,
      recorded_at: iso(ms),
      https_latency_ms: base + jitter,
      created_at: iso(ms),
    });
  }

  return rows;
}

function speedtestsForIsp(ispId, gaps) {
  const rows = [];
  const start = now - 7 * DAY_MS;
  let sourceId = ispId === "isp1" ? 1000 : 2000;

  for (let ms = start; ms <= now; ms += 4 * HOUR_MS) {
    if (inRanges(ms, gaps)) {
      continue;
    }
    rows.push({
      isp_id: ispId,
      source_result_id: sourceId++,
      recorded_at: iso(ms),
      download_mbps: ispId === "isp1" ? 780 + Math.random() * 120 : 520 + Math.random() * 90,
      upload_mbps: ispId === "isp1" ? 720 + Math.random() * 100 : 480 + Math.random() * 70,
      ping_ms: ispId === "isp1" ? 4 + Math.random() * 3 : 6 + Math.random() * 4,
      jitter_ms: 1 + Math.random(),
      packet_loss: 0,
      server_name: ispId === "isp1" ? "Demo ISP1" : "Demo ISP2",
      created_at: iso(ms),
    });
  }

  return rows;
}

// ISP1 gets occasional bad spikes so Y-axis peak capping can be tested locally.
const isp1LatencySpikes = [
  { ageMs: 30 * MINUTE_MS, latency: 4100 },
  { ageMs: 75 * MINUTE_MS, latency: 180 },
  { ageMs: 2 * HOUR_MS, latency: 3900 },
  { ageMs: 3 * HOUR_MS + 15 * MINUTE_MS, latency: 1200 },
  { ageMs: 5 * HOUR_MS, latency: 4500 },
  { ageMs: 1 * DAY_MS, latency: 5200 },
  { ageMs: 3 * DAY_MS, latency: 3600 },
];

function applyIsp1LatencySpikes(samples) {
  const isp1Samples = samples.filter((sample) => sample.isp_id === "isp1");

  for (const spike of isp1LatencySpikes) {
    const target = now - spike.ageMs;
    let nearest = null;
    let nearestDiff = Infinity;

    for (const sample of isp1Samples) {
      const diff = Math.abs(Date.parse(sample.recorded_at) - target);
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearest = sample;
      }
    }

    if (nearest) {
      nearest.https_latency_ms = spike.latency;
    }
  }
}

const latencySamples = [
  ...latencyForIsp("isp1", isp1Gaps),
  ...latencyForIsp("isp2", isp2Gaps),
];
applyIsp1LatencySpikes(latencySamples);

const speedtests = [
  ...speedtestsForIsp("isp1", isp1Gaps),
  ...speedtestsForIsp("isp2", isp2Gaps),
];

const isp1LastSeen = iso(now - UP_HEARTBEAT_AGE_MS);
const isp2LastSeen = iso(now - ISP2_HEARTBEAT_AGE_MS);
const tracerouteIsp1 = [
  " 1  172.16.1.1  0.891 ms",
  " 2  192.168.0.1  1.911 ms",
  " 3  203.128.7.71  3.424 ms",
  " 4  1.1.1.1  22.018 ms",
].join("\n");
const tracerouteIsp2 = [
  " 1  172.16.1.1  1.134 ms",
  " 2  192.168.100.1  1.838 ms",
  " 3  10.15.234.230  3.580 ms",
  " 4  1.1.1.1  3.011 ms",
].join("\n");

add("DELETE FROM latency_hourly;");
add("DELETE FROM latency_samples;");
add("DELETE FROM heartbeat_gaps;");
add("DELETE FROM outage_events;");
add("DELETE FROM speedtest_results;");
add("DELETE FROM notification_log;");
add("DELETE FROM probe_nonces;");

for (const outage of outages) {
  add(
    `INSERT INTO outage_events (isp_id, started_at, ended_at, duration_seconds, reason, created_at) VALUES (${sqlString(outage.isp_id)}, ${sqlString(outage.started_at)}, ${sqlString(outage.ended_at)}, ${sqlNumber(outage.duration_seconds)}, ${sqlString(outage.reason)}, ${sqlString(outage.started_at)});`,
  );
}

for (const gap of heartbeatGaps) {
  add(
    `INSERT INTO heartbeat_gaps (isp_id, started_at, ended_at, duration_seconds, reason, created_at) VALUES (${sqlString(gap.isp_id)}, ${sqlString(gap.started_at)}, ${sqlString(gap.ended_at)}, ${sqlNumber(gap.duration_seconds)}, ${sqlString(gap.reason)}, ${sqlString(gap.created_at)});`,
  );
}

for (const sample of latencySamples) {
  add(
    `INSERT INTO latency_samples (isp_id, recorded_at, https_latency_ms, created_at) VALUES (${sqlString(sample.isp_id)}, ${sqlString(sample.recorded_at)}, ${sqlNumber(sample.https_latency_ms)}, ${sqlString(sample.created_at)});`,
  );
}

const latencyHourly = new Map();
for (const sample of latencySamples) {
  const bucketAt = `${sample.recorded_at.slice(0, 13)}:00:00.000Z`;
  const key = `${sample.isp_id}|${bucketAt}`;
  const existing = latencyHourly.get(key);
  if (!existing) {
    latencyHourly.set(key, {
      isp_id: sample.isp_id,
      bucket_at: bucketAt,
      min_latency_ms: sample.https_latency_ms,
      max_latency_ms: sample.https_latency_ms,
      sample_count: 1,
    });
  } else {
    existing.min_latency_ms = Math.min(existing.min_latency_ms, sample.https_latency_ms);
    existing.max_latency_ms = Math.max(existing.max_latency_ms, sample.https_latency_ms);
    existing.sample_count += 1;
  }
}

for (const bucket of latencyHourly.values()) {
  add(
    `INSERT INTO latency_hourly (isp_id, bucket_at, min_latency_ms, max_latency_ms, sample_count) VALUES (${sqlString(bucket.isp_id)}, ${sqlString(bucket.bucket_at)}, ${sqlNumber(bucket.min_latency_ms)}, ${sqlNumber(bucket.max_latency_ms)}, ${sqlNumber(bucket.sample_count)});`,
  );
}

for (const result of speedtests) {
  add(
    `INSERT INTO speedtest_results (isp_id, source_result_id, recorded_at, download_mbps, upload_mbps, ping_ms, jitter_ms, packet_loss, server_name, created_at) VALUES (${sqlString(result.isp_id)}, ${sqlNumber(result.source_result_id)}, ${sqlString(result.recorded_at)}, ${sqlNumber(Math.round(result.download_mbps * 10) / 10)}, ${sqlNumber(Math.round(result.upload_mbps * 10) / 10)}, ${sqlNumber(Math.round(result.ping_ms * 10) / 10)}, ${sqlNumber(Math.round(result.jitter_ms * 10) / 10)}, ${sqlNumber(result.packet_loss)}, ${sqlString(result.server_name)}, ${sqlString(result.created_at)});`,
  );
}

add(`UPDATE isp_status SET
  is_up = 1,
  last_seen_at = ${sqlString(isp1LastSeen)},
  last_success_at = ${sqlString(isp1LastSeen)},
  public_ipv4 = '203.128.9.179',
  isp_name = 'Pakistan Telecommunication Company Limited',
  network_asn = 'AS17557 PTML',
  traceroute = ${sqlString(tracerouteIsp1)},
  dns_ok = 1,
  https_ok = 1,
  https_latency_ms = 31,
  consecutive_failures = 0,
  consecutive_successes = 4,
  presence_failures = 0,
  latest_speedtest_id = (SELECT id FROM speedtest_results WHERE isp_id = 'isp1' ORDER BY recorded_at DESC LIMIT 1),
  updated_at = ${sqlString(isp1LastSeen)}
WHERE isp_id = 'isp1';`);

add(`UPDATE isp_status SET
  is_up = 1,
  last_seen_at = ${sqlString(isp2LastSeen)},
  last_success_at = ${sqlString(isp2LastSeen)},
  public_ipv4 = '153.117.8.70',
  isp_name = 'StormFiber Ltd',
  network_asn = 'AS138419 StormFiber',
  traceroute = ${sqlString(tracerouteIsp2)},
  dns_ok = 1,
  https_ok = 1,
  https_latency_ms = 37,
  consecutive_failures = 0,
  consecutive_successes = 3,
  presence_failures = 0,
  latest_speedtest_id = (SELECT id FROM speedtest_results WHERE isp_id = 'isp2' ORDER BY recorded_at DESC LIMIT 1),
  updated_at = ${sqlString(isp2LastSeen)}
WHERE isp_id = 'isp2';`);

const outputPath = join(__dirname, "seed-demo.sql");
writeFileSync(outputPath, `${statements.join("\n")}\n`);
console.log(`Wrote ${statements.length} SQL statements to ${outputPath}`);
console.log(`Latency samples: ${latencySamples.length}`);
console.log(`Heartbeat gaps: ${heartbeatGaps.length}`);
console.log(`Outages: ${outages.length}`);
console.log(`Speedtests: ${speedtests.length}`);
console.log(`ISP1 latency spikes: ${isp1LatencySpikes.length} (up to 5200 ms)`);
console.log("");
console.log("Demo status cards after seed:");
console.log("  ISP1: UP (heartbeat ~30s ago)");
console.log(`  ISP2: UP (heartbeat ~${ISP2_HEARTBEAT_AGE_MS / 1000}s ago, goes STALE after ~${STALE_SECONDS - ISP2_HEARTBEAT_AGE_MS / 1000}s)`);
console.log("");
console.log("Step through UP -> STALE -> DOWN:");
console.log("  1. npm run db:seed && npm run dev");
console.log("  2. Open page: both ISPs show UP");
console.log(`  3. Wait ~${STALE_SECONDS - ISP2_HEARTBEAT_AGE_MS / 1000}s: ISP2 shows STALE (page refresh is read-only)`);
console.log("  4. Trigger cron locally: curl http://localhost:8787/cdn-cgi/local/scheduled");
console.log("  5. Refresh page: ISP2 shows DOWN");
console.log("");
console.log("Test Y-axis peak cap:");
console.log("  ISP1 has spikes up to 5200 ms; ISP2 stays ~30-50 ms.");
console.log("  Set Y-axis peak to 300 or 500 ms with peak scale locked on.");
