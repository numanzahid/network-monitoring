# Local development

Run the status page and APIs locally without probes or deploys.

## Quick start

```bash
cd worker
npm install
npm run dev:setup
npm run dev
```

Open http://localhost:8787

`dev:setup` applies local D1 migrations and loads 7 days of demo data.

## What you get locally

- Local Worker on port 8787
- Local D1 SQLite database (not production)
- Demo outages, heartbeat gaps, latency samples, and speedtests
- No probe secrets required for UI work

## Useful commands

```bash
npm run db:migrate:local   # apply migrations to local D1
npm run db:seed            # reload demo data
npm run dev:setup          # migrate + seed
npm run dev                # start local server
npm run typecheck          # TypeScript check
```

## Test cron locally

Scheduled jobs do not run automatically in `wrangler dev`:

```bash
curl "http://localhost:8787/cdn-cgi/local/scheduled"
```

## Optional `.dev.vars`

Only needed if you want to test heartbeat auth or notifications locally:

```env
NOTIFY_ENABLED=false
PROBE_SECRET_ISP1=optional-for-manual-heartbeat-tests
PROBE_SECRET_ISP2=optional-for-manual-heartbeat-tests
NTFY_TOPIC=optional
```

For UI-only work, skip `.dev.vars`.

## Reload demo data

```bash
npm run db:seed
```

Then refresh the browser.

## Demo status states

After seeding, both ISPs start **UP**. ISP2 has an older heartbeat (about 60 seconds) so it crosses the **120s stale threshold** roughly one minute later.

Timing (default config):

- **120s** without heartbeat: **STALE**
- **180s** without heartbeat: **DOWN**
- **Probe silent (24h)**: total minutes the probe was silent in the last 24 hours (updates on each refresh)

Step through **UP -> STALE -> DOWN**:

1. `npm run db:seed` and open http://localhost:8787
2. Both cards show **UP**
3. Wait about 60 seconds: ISP2 shows **STALE**
4. Wait another ~60 seconds: ISP2 shows **DOWN**

If ISP2 loads **DOWN** immediately, run `npm run db:seed` again to reset leftover local state.
