# ISP1 Monitoring

ISP1 uses the first WAN connection through the local router.

- Speedtest Tracker: `<ISP1_TRACKER_IP>`
- Probe: `<ISP1_PROBE_IP>`
- Policy route: both addresses -> WAN1 only

## Setup

1. Copy `speedtest-tracker/.env.example` to `.env` and start the tracker.
2. Create a Speedtest Tracker API token with read access.
3. Copy `probe/.env.example` to `.env` and configure the heartbeat receiver.
4. Start the probe after the receiver endpoint and secret are ready.

The tracker database is stored in `speedtest-tracker/config/` and is ignored
by Git.
