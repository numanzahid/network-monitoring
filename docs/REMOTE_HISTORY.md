# remote history

The Worker keeps a bounded history in the SQLite-backed Durable Object for
each ISP. This provides useful public charts when the local history service is
unavailable while keeping long-term storage local.

## retention

- Heartbeat samples: `REMOTE_HISTORY_HOURS`, 24 hours by default.
- Speedtest summaries: `REMOTE_SPEEDTEST_HISTORY_DAYS`, 30 days by default.
- Remote outage events: 30 days.

Heartbeat history contains the probe timestamp, Worker receive timestamp,
check flags, and HTTPS latency. Speedtest history contains only the compact
speedtest summary already sent by the probe. Network identity, traceroute, and
full long-term history remain local.

## endpoints

```text
GET /api/history/latency?isp=isp1&hours=6
GET /api/history/outages?isp=isp1&days=7
GET /api/history/speedtests?isp=isp1&days=30
```

The endpoints are read-only and use the same response shapes as the local
history service, so the existing dashboard can use either source.

Latency responses include `available_hours`; speedtest responses include
`available_days`. The dashboard uses these values across both ISPs and hides
range choices that cannot be filled by the available data.
