# local development

The Worker is the live remote service. The local history app stores detailed beats and serves the dashboard with local charts.

## worker

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

The local Worker provides `GET /api/status`, bounded remote history endpoints,
and accepts signed heartbeat v2 payloads. It does not provide long-range
history; that remains in the local history app.

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

Probe target selection is controlled by `CHECK_PROVIDER=google` or
`CHECK_PROVIDER=cloudflare`. Google resolves `www.google.com` and uses Google's
HTTPS generate-204 endpoint; Cloudflare resolves `www.cloudflare.com` and uses
Cloudflare's hostname-based HTTPS trace endpoint. Both profiles trace to
`8.8.4.4`, because this setup has special router routes for `8.8.8.8` and
`1.1.1.1`. The four target variables remain available as optional overrides.
`DNS_HOST` must be a hostname; numeric addresses report a failed DNS check.
This checks the container's configured resolver, not a dedicated ISP DNS server.
