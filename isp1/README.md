# ISP1 Monitoring

ISP1 uses the first WAN connection through the local router.

- Speedtest Tracker: `<ISP1_TRACKER_IP>`
- Probe and Cloudflared stack: `<ISP1_PROBE_IP>`
- Policy route: both addresses -> WAN1 only

The tracker database is stored in `speedtest-tracker/config/` and is ignored
by Git. Copy `.env.example` to `.env` and provide deployment-specific values.
