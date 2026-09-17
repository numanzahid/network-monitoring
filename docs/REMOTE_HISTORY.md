# remote history

The Worker keeps a bounded history in the SQLite-backed Durable Object for
each ISP. This provides useful public charts when the local history service is
unavailable while keeping long-term storage local.

## retention

- Heartbeat samples: `REMOTE_HISTORY_HOURS`, 48 hours by default.
- Speedtest summaries: `REMOTE_SPEEDTEST_HISTORY_DAYS`, 7 days by default.
- Remote outage events: `REMOTE_OUTAGE_HISTORY_DAYS`, 7 days by default.

Speedtest history accepts only results with numeric download and upload values.
The chart treats valid results more than three hours apart as a broken series;
the trackers are scheduled every two hours.

Heartbeat history contains the probe timestamp, Worker receive timestamp,
check flags, and HTTPS latency. Speedtest history contains only the compact
speedtest summary already sent by the probe. Network identity, traceroute, and
full long-term history remain local.

## endpoints

```text
GET /api/history/latency?isp=isp1&hours=48
GET /api/history/outages?isp=isp1&days=7
GET /api/history/speedtests?isp=isp1&days=7
```

The endpoints are read-only and use the same response shapes as the local
history service, so the existing dashboard can use either source.

Latency responses include `available_hours`; speedtest responses include
`available_days`. The dashboard uses these values across both ISPs and hides
range choices that cannot be filled by the available data.

When a Durable Object has no completed history synchronization state, the
next accepted heartbeat includes a signed sync request. The probe reads that
acknowledgement, exports bounded batches from the local database, and sends
them to the authenticated sync endpoint. The remote marks the request
complete after the local source has been fully scanned for the requested
window, even when the local database itself started less than 48 hours or 7
days ago. Backfill updates history tables only and does not affect live state
or notifications.
