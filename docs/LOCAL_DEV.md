# local development

The Worker is the live remote service. The local history app stores detailed beats and serves the dashboard with local charts.

## worker

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

The local Worker provides `GET /api/status` and accepts signed heartbeat v2 payloads. It does not provide long-range history.

## history app

Copy `local/.env.example` to `local/.env`, set a private `LOCAL_INGEST_TOKEN`, set `WORKER_STATUS_URL`, and start:

```bash
docker network create monitoring-local
python3 local/server.py
```

For Docker Compose, start the history service from `local/` and the probes from their respective directories. The history service stays on the Docker bridge and publishes port `8788`; the probes use the shared `monitoring-local` bridge for history ingestion and their ISP macvlan for measurements. Open `http://<tailscale-ip>:8788` for the dashboard. Its database is `local/data/history.sqlite3` by default and is ignored by Git.

The probes send compact beat data to the local app when `LOCAL_URL` is configured. If the local app is unavailable, each probe writes an ordered JSON spool under its state directory and retries later. Remote liveness continues independently.

## v2 behavior

Each ISP has its own persistent sequence. Flags and latency are sent every interval. Network identity, traceroute, and speed-test blocks are sent when they change or after the metadata keepalive interval. The Worker stores only live state in its per-ISP Durable Object.
