# local development

The Worker is the live remote service. The local history app stores detailed beats and serves the dashboard with local charts.

## worker

```bash
cd worker
npm install
printf '%s\n' 'PROBE_SECRET_ISP1=test-secret-isp1' 'PROBE_SECRET_ISP2=test-secret-isp2' > .dev.vars
npm run dev
```

The local Worker provides `GET /api/status` and accepts signed heartbeat v2 payloads. It does not provide long-range history.

## history app

Copy `local/.env.example` to `local/.env`, set a private `LOCAL_INGEST_TOKEN`, set `WORKER_STATUS_URL`, and start:

```bash
python3 local/server.py
```

Open the local service URL for the dashboard. Its database is `local/data/history.sqlite3` by default and is ignored by Git.

The probes send compact beat data to the local app when `LOCAL_URL` is configured. If the local app is unavailable, each probe writes an ordered JSON spool under its state directory and retries later. Remote liveness continues independently.

## v2 behavior

Each ISP has its own persistent sequence. Flags and latency are sent every interval. Network identity, traceroute, and speed-test blocks are sent when they change or after the metadata keepalive interval. The Worker stores only live state in its per-ISP Durable Object.
