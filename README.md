# Dual-ISP Network Monitoring

Local monitoring infrastructure for tracking two independent internet
connections. Each ISP has its own Speedtest Tracker instance and a dedicated
probe/tunnel stack. A Cloudflare Worker receives signed heartbeat data,
stores history in D1, sends notifications, and publishes a public status page.

## Architecture

```text
ISP 1 -> dedicated probe -> Worker heartbeat API
      -> dedicated Speedtest Tracker
      -> optional Cloudflare Tunnel

ISP 2 -> dedicated probe -> Worker heartbeat API
      -> dedicated Speedtest Tracker
      -> optional Cloudflare Tunnel

Worker -> D1 (outages, speedtests, status)
       -> ntfy / telegram / discord notifications
       -> public status page + JSON API
```

The local services use Docker Compose and a macvlan network so each ISP
monitor can have an independent LAN identity. Router policy routing must bind
each monitor identity to its intended WAN and must not silently fail over when
ISP-specific outage detection is required.

## Repository layout

```text
worker/
  README.md
  wrangler.toml
  migrations/
  src/
  public/

docs/
  HEARTBEAT_API.md

isp1/
  README.md
  speedtest-tracker/
  tunnel/
    probe/

isp2/
  ...                       # same structure as isp1/
```

## Quick start

### 1. Deploy the Worker

**Recommended (headless):** connect GitHub to Cloudflare Workers Builds.
See `docs/DEPLOY_CLOUDFLARE_GITHUB.md` for step-by-step setup.

**Manual:** use Wrangler from a machine with auth. See `worker/README.md`.

### 2. Create the macvlan network

```bash
docker network create -d macvlan \
  --subnet=<LAN_SUBNET> \
  --gateway=<LAN_GATEWAY> \
  -o parent=<PHYSICAL_INTERFACE> \
  isp-monitor-macvlan
```

### 3. Start Speedtest Tracker (per ISP)

```bash
cd isp1/speedtest-tracker
cp .env.example .env
docker compose --env-file .env config
docker compose --env-file .env up -d
```

Repeat for `isp2/speedtest-tracker`.

Create an API token in each Speedtest Tracker UI for the probe.

### 4. Start probes (per ISP)

Use the same `PROBE_SECRET` values configured in the Worker (`PROBE_SECRET_ISP1`
/ `PROBE_SECRET_ISP2`).

```bash
cd isp1/tunnel
cp .env.example .env
docker compose --env-file .env config
docker compose --env-file .env up -d
```

Repeat for `isp2/tunnel`.

### 5. Open the status page

Visit the Worker URL (for example `https://status.example.com`).

## Notifications

Notifications fire on debounced state changes:

- ISP down after repeated failures
- ISP recovery with outage duration

Default channel is **ntfy**. Enable more channels in `worker/wrangler.toml`:

```toml
NOTIFIER_CHANNELS = "ntfy,telegram,discord"
```

Set the matching secrets in Wrangler or `.dev.vars` for local development.

## API

- `GET /api/status`
- `GET /api/history/outages?isp=isp1&days=30`
- `GET /api/history/latency?isp=isp1&days=7`
- `GET /api/history/speedtests?isp=isp1&days=14`
- `POST /api/heartbeat`

## Development principles

- Keep ISP1 and ISP2 configuration symmetrical.
- Use separate credentials for each ISP where practical.
- Reject stale, malformed, or replayed heartbeat requests.
- Debounce outages so one missed check does not create a false alert.
- Generate recovery events with the measured outage duration.
- Keep the public status page free of credentials and unnecessary private
  network information.

## License

MIT License. See `LICENSE`.
