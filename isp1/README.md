# ISP1 Monitoring

ISP1 uses the first WAN connection through the local router.

- Speedtest Tracker: `<ISP1_TRACKER_IP>`
- Probe and Cloudflared stack: `<ISP1_PROBE_IP>`
- Policy route: both addresses -> WAN1 only

## Setup

1. Copy `speedtest-tracker/.env.example` to `.env` and start the tracker.
2. Create a Speedtest Tracker API token in the UI.
3. Deploy the Cloudflare Worker and set `PROBE_SECRET_ISP1` to match `PROBE_SECRET`
   in `tunnel/.env`.
4. Copy `tunnel/.env.example` to `.env`, fill in values, and start the probe stack.

The tracker database is stored in `speedtest-tracker/config/` and is ignored
by Git.
