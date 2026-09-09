# ISP2 Monitoring

ISP2 uses the second WAN connection through the local router.

- Speedtest Tracker: `<ISP2_TRACKER_IP>`
- Probe: `<ISP2_PROBE_IP>`
- Policy route: both addresses -> WAN2 only

## Setup

1. Copy `speedtest-tracker/.env.example` to `.env` and start the tracker.
2. Create a Speedtest Tracker API token with read access.
3. Copy `probe/.env.example` to `.env` and configure the heartbeat receiver.
4. Start the probe after the receiver endpoint and secret are ready.

The tracker database is stored in `speedtest-tracker/config/` and is ignored
by Git.
