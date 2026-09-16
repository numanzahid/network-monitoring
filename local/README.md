# local history service

This service is the source of truth for detailed monitoring history after D1 is removed. It stores compact beats, metadata changes, speed tests, heartbeat gaps, and derived check outages in SQLite. It also serves the existing dashboard and proxies `/api/status` to the Worker so the dashboard keeps live status and local history together.

Create `local/.env` from `.env.example`, set a private `LOCAL_INGEST_TOKEN`, and set `WORKER_STATUS_URL` to the Worker base URL. Create the shared Docker network once, then start it with:

```bash
docker network create monitoring-local
python3 local/server.py
```

When using `local/docker-compose.yml`, the history container joins the shared `monitoring-local` bridge network and publishes port `8788` on the host. The probe compose files join that bridge plus their ISP macvlan and use `http://history:8788` for ingestion. Open `http://<tailscale-ip>:8788` for the dashboard.

The probes use the same token through `LOCAL_URL` and `LOCAL_INGEST_TOKEN`.

The database is runtime data under `local/data/` and is ignored by Git. Keep the local service behind the LAN or a private overlay network.

To import a legacy D1 SQL export before deleting the old database:

```bash
python3 local/import_d1.py /path/to/d1-export.sql
```

The importer preserves latency samples, heartbeat gaps, outages, and speed-test history. Legacy rows are marked as imported beats because the old database did not retain every full probe beat.
