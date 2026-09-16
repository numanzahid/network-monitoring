# Network monitoring review and D1 removal plan

Reviewed after the pull that moved the repository to `726809e` on 2026-09-16.

## Current system

The system has two probes, one per ISP. Each probe runs checks for Internet reachability, DNS, HTTPS latency, public IP, and traceroute, then sends a signed heartbeat to the Cloudflare Worker. The Worker authenticates the heartbeat, stores measurements, updates current ISP state, opens or closes outages and heartbeat gaps, and sends ntfy notifications. A one-minute cron evaluates stale probes and retries pending notifications. The public Worker assets read current status and historical data through the Worker API.

The system is operationally healthy based on the previous live observation: both probes and both speed-test containers were running without restarts or OOM kills, both ISPs were currently UP, and a 40-second status sample showed heartbeat ages advancing. The probe logs showed intermittent network delivery failures, especially for ISP2, which matched recorded outages rather than an application crash.

## Changes in the new pull

The recent commits improve the dashboard and historical latency reads:

- `726809e` adds a selectable latency Y-axis peak and demo spikes so clipping can be tested locally.
- `8ca4ea2` adds time-based chart axes, explicit silent-period breaks, and cleaner chart presentation.
- `b9a4eae` adds `latency_hourly` aggregates and uses them for multi-day charts, reducing large raw-sample reads.
- `74b2b7e` adds latency range handling.
- `2a635c5` improves down-state and heartbeat-gap presentation.

The chart and seed changes pass syntax checks. The Worker still passes TypeScript checking after the pull. The hourly aggregation is logically consistent with the existing heartbeat flow, but it adds a second database write for every latency sample. The raw sample insert and hourly upsert are separate operations, so a failure between them can leave the chart aggregate different from the raw data. They should be committed atomically or rebuilt periodically from raw samples.

The new cleanup scheduling is also fragile. Cleanup now runs only when the per-minute cron happens to execute at exactly `03:00 UTC` (`worker/src/cron.ts`). A missed invocation delays cleanup for another day. Use a dedicated daily cron, or make cleanup idempotently catch up after a missed run.

The hourly query floors the requested start time to the beginning of its hour (`worker/src/db.ts:414`). That is appropriate for a chart, but it intentionally includes samples from before the requested boundary in the first bucket. The API should document that behavior or clip the first bucket if exact windows matter.

The generated demo SQL is a very large tracked artifact and contains randomized values. Every seed generation can create noisy diffs. Keeping the generator as the source of truth and generating the SQL only when needed would make reviews and pulls cleaner.

## Revisited improvement list

### High priority

1. **Reject unsupported HTTP methods.** `POST /api/status` and the history endpoints currently return successful read responses. Add explicit `GET` guards to all read routes in `worker/src/index.ts` and `worker/src/api/history.ts`.

2. **Validate heartbeat data at runtime.** Authentication currently verifies the signature, ISP, timestamp, and nonce shape, then treats the decoded JSON as a typed payload. A signed body with missing `checks.https` reached a 500 TypeError during testing. Validate the complete schema before accessing nested fields, including numeric bounds, ISO timestamps, string lengths, and optional speed-test fields. Return 400 for invalid payloads.

3. **Make heartbeat ingestion one atomic operation.** The current path checks a nonce, inserts it, then mutates status, outages, gaps, speed tests, raw latency, and hourly latency in separate calls (`worker/src/api/heartbeat.ts:48`, `worker/src/outages.ts`). Concurrent or partially failed requests can produce duplicate or incomplete state. Use a transaction-capable store operation with a unique nonce constraint and an idempotency result.

4. **Fix time-window overlap queries.** Outages and heartbeat gaps are filtered with `started_at >= since` (`worker/src/db.ts:180` and `worker/src/db.ts:533`). An event that began before the selected window but continued into it is omitted from the event list and missed-minute total. Query intervals that overlap the window, then clip their start and end to the requested bounds.

5. **Add request limits and rate protection.** The heartbeat endpoint has no explicit body-size limit or request rate limit. Add a small body limit before parsing, reject oversized arrays and strings, and rate-limit by ISP/source. Keep the signed nonce protection as a separate replay defense.

### Medium priority

6. **Fix the probe DNS timeout.** `check_dns(timeout)` accepts a timeout but the socket call does not apply it. A resolver failure can therefore block the probe longer than intended.

7. **Use HTTPS and validate identity lookups.** Public-IP and related external lookups should use HTTPS, bounded timeouts, and strict IP parsing. A failed identity lookup should be represented explicitly rather than silently becoming an arbitrary string.

8. **Build pinned probe images.** The probe compose files install apt and pip packages during every container start. Build a version-pinned image, add container health checks, and make the runtime image independent of package-repository availability.

9. **Correct disabled-notification accounting.** When notifications are disabled, `sendNotification` returns success (`worker/src/notify/index.ts:126`). The caller can then mark an outage as delivered even though no notification was sent. Treat disabled as a deliberate skipped state, or do not mark the outage delivered.

10. **Protect local credentials.** The probe `.env` files contain sensitive configuration and should be mode `0600`; the speed-test environment files were observed with less restrictive permissions. Rotate any credentials that have been exposed through shared files or logs.

11. **Separate production and development dependencies.** Production dependencies were clean in the earlier audit, while the full development tree reported three high advisories through the Wrangler/Miniflare/sharp/libheif path. Upgrade Wrangler and its dependency tree in a controlled branch and rerun the audit.

12. **Remove duplicated probe code.** `isp1/probe/probe.py` and `isp2/probe/probe.py` are identical. Share one implementation and keep ISP-specific configuration in environment variables.

13. **Harden frontend third-party loading.** Chart.js and its date adapter load from jsDelivr. Pinning is already present, but a local asset or a documented CSP/SRI policy would reduce dashboard dependence on a third-party CDN.

## Validation performed

- Repository state after the pull: clean, at `726809e`, tracking `origin/master`.
- `git diff --check` over the recent pull history: passed.
- In a disposable Node 22 container: `npm ci --ignore-scripts`, `npm run typecheck`, and syntax checks for the seed script, chart module, and app module: passed.
- Earlier local end-to-end checks: all five D1 migrations applied, demo seed succeeded, Python probe compilation passed, valid signed heartbeats returned 200, replay returned 409, bad signatures returned 401, stale timestamps returned 401, and cron down/recovery transitions worked.
- Earlier production checks: read APIs were reachable, both ISPs were UP at the observation point, and a short live sample showed heartbeats continuing. Method handling and malformed heartbeat validation remain open defects.

## Plan to remove D1 while preserving behavior

Removing D1 means replacing the Worker’s durable relational storage. The probes, public API paths, dashboard JSON shape, cron behavior, and notification behavior can remain unchanged if the storage interface stays behind the Worker. Cloudflare KV alone is not a suitable replacement because it is eventually consistent and does not provide the relational time-window queries or transactions this application needs. R2 is useful for archive files but is a poor primary database. Durable Objects can provide serialized state, but rebuilding history indexes and range queries there would be a larger redesign.

The recommended target is a small HTTPS storage service backed by PostgreSQL or libSQL/Turso. It should expose purpose-built operations rather than arbitrary SQL, authenticate the Worker with a secret or HMAC, and execute heartbeat ingestion transactionally. The Worker remains the public API and the storage service is an internal dependency.

### Phase 1: freeze the contract and inventory data

Document the existing API responses and notification transitions. Export a verified D1 backup. Record row counts, the oldest retained timestamp, open outages, open heartbeat gaps, current ISP status, pending notifications, and the nonce retention window.

The replacement must cover these logical tables:

| Current D1 data | Replacement responsibility |
| --- | --- |
| `isp_status` | Current state, counters, last heartbeat, checks, IP, traceroute, latest speed test |
| `outage_events` | Open/closed outage lifecycle and notification markers |
| `heartbeat_gaps` | Silent-period lifecycle and durations |
| `latency_samples` | Recent raw latency points |
| `latency_hourly` | Hourly min/max/count chart aggregates |
| `speedtest_results` | Historical speed-test results |
| `probe_nonces` | Replay protection with a unique nonce and expiry |
| `notification_log` | Delivery attempts and errors |

### Phase 2: introduce a storage interface

Add a repository interface in the Worker so `outages.ts`, `notify/index.ts`, the cron handler, and the API handlers depend on operations such as `acceptHeartbeat`, `getStatus`, `listHistory`, `listPendingNotifications`, and `runCleanup`. Keep a D1 adapter temporarily. This separates the application contract from D1 and makes the replacement testable without the live service.

The most important replacement operation is `acceptHeartbeat`. It should, in one transaction:

1. reject an already-used nonce;
2. record the nonce;
3. update ISP status and counters;
4. close or open outage and heartbeat-gap records as needed;
5. store speed-test and latency data;
6. update the hourly latency aggregate; and
7. return the same status transition data used by the current Worker.

### Phase 3: build and verify the new store

Create the relational schema with UTC timestamps, indexes on `(isp_id, recorded_at)`, `(isp_id, started_at)`, pending notification state, and nonce uniqueness. Give the storage service a health endpoint, bounded request timeouts, structured errors, and backups. Import the D1 export, then compare counts and representative API responses between D1 and the new store.

Run the existing local heartbeat matrix against both adapters: valid heartbeat, replay, bad signature, stale timestamp, malformed payload, failed checks, outage opening, recovery, concurrent duplicate delivery, open gap closure, notification retry, and history windows that begin during an existing outage.

### Phase 4: dual-write and cut over

For a low-risk migration, keep D1 as the read source initially and write each accepted heartbeat to both stores. Compare status and history responses for several retention periods. Then switch reads to the new store while retaining D1 dual-writes as a rollback path. After the new path is stable, remove the D1 write and keep a final backup.

The Worker should fail closed for ambiguous heartbeat writes: if the storage service cannot confirm the transaction result, return a retryable error and do not claim that the heartbeat was fully processed. The nonce transaction must make retries safe.

### Phase 5: remove D1

After the cutover window, remove the `DB: D1Database` binding from `worker/src/types.ts`, remove `[[d1_databases]]` from `worker/wrangler.toml`, replace the D1 migration and seed commands in `worker/package.json`, update local development documentation, and delete the D1 adapter. Keep the SQL migrations and export in an archive until the retention and rollback period ends. Only then delete the Cloudflare D1 database.

## Acceptance criteria

The D1 removal is complete when both probes can send heartbeats for at least one full retention cycle; current status, stale/down transitions, outage recovery, notification retry, latency charts, speed-test charts, and all history endpoints return the same contract; replayed heartbeats remain rejected; concurrent delivery cannot duplicate state; cleanup runs after a missed schedule; and a tested backup/restore procedure exists for the replacement store.

The implementation should start with the repository interface and the heartbeat transaction. Those two changes address the largest correctness risks and make the eventual D1 removal a storage migration rather than a simultaneous rewrite of the monitoring behavior.
