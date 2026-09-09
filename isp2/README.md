# ISP2 Monitoring

ISP2 uses the second WAN connection through the local router.

- Speedtest Tracker: `<ISP2_TRACKER_IP>`
- Probe and Cloudflared stack: `<ISP2_PROBE_IP>`
- Policy route: both addresses -> WAN2 only

The tracker database is stored in `speedtest-tracker/config/` and is ignored
by Git. Copy `.env.example` to `.env` and provide deployment-specific values.
