# Dual-ISP Network Monitoring

Local monitoring infrastructure for tracking two independent internet
connections. Each ISP has its own Speedtest Tracker instance and a dedicated
probe/tunnel stack. A separate Cloudflare Worker can receive signed heartbeat
data and publish an externally reachable status page.

## Architecture

```text
ISP 1 -> dedicated probe -> heartbeat API
      -> dedicated Speedtest Tracker
      -> optional Cloudflare Tunnel

ISP 2 -> dedicated probe -> heartbeat API
      -> dedicated Speedtest Tracker
      -> optional Cloudflare Tunnel
```

The local services use Docker Compose and a macvlan network so each ISP
monitor can have an independent LAN identity. Router policy routing must bind
each monitor identity to its intended WAN and must not silently fail over when
ISP-specific outage detection is required.

## Repository layout

```text
isp1/
  README.md
  speedtest-tracker/
    docker-compose.yml
    .env.example
    config/                 # runtime data, ignored by Git
  tunnel/
    docker-compose.yml
    .env.example
    probe/
      probe.py
      requirements.txt

isp2/
  ...                       # same structure as isp1/
```

## Speedtest Tracker

The two instances use separate persistent databases. This keeps performance
history, selected servers, latency, and outage-related data isolated by ISP.
Do not share the `config/` directories between instances.

## Probe responsibilities

Each probe is intended to run at a short interval and report:

- Internet reachability
- DNS resolution
- HTTPS reachability and latency
- Current public IPv4 address
- Latest Speedtest Tracker result
- Timestamp and probe identity

The receiving Worker should validate and authenticate every heartbeat before
storing it.

## Cloudflare integration

The external Worker can provide:

- Public current status
- Last successful check
- ISP-specific outage history
- Uptime statistics
- Latest speed-test results
- Notifications through external services

Cloudflare credentials, tunnel tokens, probe secrets, API tokens, and local
runtime data must remain outside version control. Use encrypted Worker secrets
for server-side credentials.

## Development principles

- Keep ISP1 and ISP2 configuration symmetrical.
- Use separate credentials for each ISP where practical.
- Reject stale, malformed, or replayed heartbeat requests.
- Debounce outages so one missed check does not create a false alert.
- Generate recovery events with the measured outage duration.
- Keep the public status page free of credentials and unnecessary private
  network information.

## Local usage

Copy each `.env.example` to `.env`, fill in local values, and validate the
Compose configuration before starting a service:

```bash
docker compose --env-file .env config
docker compose --env-file .env up -d
```

The tunnel and probe services should not be started until their Worker API
contract and credentials are configured.

## License

Add the project license before publishing if this repository will be shared
publicly.
