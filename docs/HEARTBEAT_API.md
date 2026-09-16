# heartbeat api

Probes send compact, independently authenticated heartbeats to the Worker.

## endpoint

`POST /api/heartbeat`

## v2 payload

```json
{
  "v": 2,
  "isp_id": "isp1",
  "boot_id": "persistent-probe-boot-id",
  "seq": 42,
  "ts": "2026-09-17T12:00:00Z",
  "f": 7,
  "l": 42,
  "m": {
    "public_ipv4": "203.0.113.10",
    "isp_name": "provider",
    "network_asn": "AS64500",
    "traceroute": ["1 192.0.2.1"]
  },
  "s": {
    "result_id": 123,
    "recorded_at": "2026-09-17T11:58:00Z",
    "download_mbps": 940.2,
    "upload_mbps": 880.1,
    "ping_ms": 5.2,
    "jitter_ms": 1.1,
    "packet_loss": 0,
    "server_name": "provider"
  }
}
```

`f` is a bit field: Internet `1`, DNS `2`, and HTTPS `4`. `l` is HTTPS latency in milliseconds. `m` and `s` are sent when changed and periodically as keepalives.

## authentication

Use the ISP-specific secret in `Authorization`:

```text
Authorization: Bearer <base64-hmac-sha256>
```

The signature input is:

```text
{ts}.{boot_id}.{seq}.{raw_json_body}
```

The raw body must be byte-identical to the signed body. The Worker rejects stale timestamps, invalid fields, oversized bodies, invalid flags, and invalid sequence values. A duplicate or older sequence is accepted as an idempotent no-op and does not extend the liveness timer.

## state rules

Each ISP is independent. Durable Object alarms calculate missed beats from Worker receive time. `NOTIFY_AFTER_MISSED_BEATS` controls the DOWN threshold. A valid newer beat changes the ISP back to UP. Failed check flags are reported as degraded health while remote presence remains separate.
