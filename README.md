# Dual-ISP Network Monitoring
Local monitoring infrastructure for two independent internet connections.
Each ISP has its own Speedtest Tracker instance and a dedicated network probe.
The probe sends authenticated heartbeat data to an external HTTP receiver,
which may be hosted on any compatible platform.

## architecture

```text
ISP 1 -> dedicated probe -> Cloudflare Worker presence state
      -> local history app and database

ISP 2 -> dedicated probe -> Cloudflare Worker presence state
      -> local history app and database

Worker -> notifications and live status page
Local app -> history, charts, and derived outage records
```

The local services use Docker Compose and macvlan networking so each ISP
monitor has an independent LAN identity. Router policy routing must bind each
monitor identity to its intended WAN and must not silently fail over when
ISP-specific outage detection is required.

## Repository layout

```text
worker/                    # optional reference receiver implementation
docs/                      # API, notifications, and deployment notes
isp1/
  README.md
  speedtest-tracker/
  probe/
    docker-compose.yml
    .env.example
    probe.py
    requirements.txt
isp2/
  ...                     # same structure as isp1/
```

## Speedtest Tracker

The two instances use separate persistent databases. This keeps performance
history, latency, selected server, and result data isolated by ISP. Do not
share the two `config/` directories.

## Probe responsibilities

Each probe checks internet reachability, DNS, HTTPS latency, public IPv4, and
the latest result from its matching Speedtest Tracker. It signs a JSON
heartbeat and sends it to the configured receiver at the configured interval.

The receiver should validate the ISP identity, timestamp, nonce, signature,
and payload before storing it.

## Configuration

Copy the relevant `.env.example` to `.env` and provide deployment-specific
values. Keep `.env`, database files, logs, and other runtime data out of Git.
See [`docs/SECRETS.md`](docs/SECRETS.md) for the complete secret inventory and
where each value belongs.

```bash
docker compose --env-file .env config
docker compose --env-file .env up -d
```

## services

The Worker is the remote heartbeat receiver. A Durable Object is used per ISP
for liveness and notification transitions. The local history service uses
SQLite and is the source of truth for charts and detailed history.

## Security

- Use a different probe secret for each ISP.
- Require HTTPS for the receiver URL.
- Reject stale and replayed heartbeats.
- Rate-limit the heartbeat endpoint.
- Never commit API tokens, receiver secrets, or local databases.

## License

MIT License. See `LICENSE`.
