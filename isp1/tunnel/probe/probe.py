#!/usr/bin/env python3
"""Probe skeleton for the Cloudflare heartbeat stage.

The network identity and environment contract are prepared now. Worker
payload and Speedtest Tracker API integration will be completed with the
Cloudflare receiving-side contract.
"""

import os
import time


def main() -> None:
    required = ("ISP_ID", "PROBE_IP", "TRACKER_IP", "WORKER_URL", "PROBE_SECRET")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit("Missing configuration: " + ", ".join(missing))
    raise SystemExit(
        "Probe scaffold is installed but not enabled; implement the Worker "
        "heartbeat contract before starting this service."
    )


if __name__ == "__main__":
    main()
