# ISP2 Monitoring

ISP2 uses the second WAN connection through the local router.

- Speedtest Tracker: `<ISP2_TRACKER_IP>`
- Probe and Cloudflared stack: `<ISP2_PROBE_IP>`
- Policy route: both addresses -> WAN2 only

## Setup

1. Copy `speedtest-tracker/.env.example` to `.env` and start the tracker.
2. Create a Speedtest Tracker API token in the UI.
3. Deploy the Cloudflare Worker and set `PROBE_SECRET_ISP2` to match `PROBE_SECRET`
   in `tunnel/.env`.
4. Copy `tunnel/.env.example` to `.env`, fill in values, and start the probe stack.

The tracker database is stored in `speedtest-tracker/config/` and is ignored
by Git.
