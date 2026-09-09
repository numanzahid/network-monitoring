# Heartbeat API

Probes send signed JSON heartbeats to the Worker.

## Endpoint

`POST /api/heartbeat`

## Headers

- `Content-Type: application/json`
- `Authorization: Bearer <base64-hmac-sha256>`

Signature input:

```text
{ts}.{nonce}.{raw_json_body}
```

The raw JSON body must be byte-identical to what was signed. Probes should
serialize with stable key ordering.

## Payload

```json
{
  "isp_id": "isp1",
  "ts": "2026-09-09T12:00:00Z",
  "nonce": "uuid",
  "checks": {
    "internet": true,
    "dns": true,
    "https": { "ok": true, "latency_ms": 42 },
    "public_ipv4": "203.0.113.10"
  },
  "speedtest": {
    "result_id": 123,
    "recorded_at": "2026-09-09T11:58:00Z",
    "download_mbps": 940.2,
    "upload_mbps": 880.1,
    "ping_ms": 5.2,
    "jitter_ms": 1.1,
    "packet_loss": 0,
    "server_name": "Example ISP"
  }
}
```

`speedtest` may be `null` when no result is available.

## Validation rules

- `isp_id` must be `isp1` or `isp2`
- `ts` must be within `HEARTBEAT_MAX_AGE_SECONDS`
- `nonce` must be unique (replay protection)
- HMAC must match the ISP-specific probe secret

## State transitions

- `FAILURE_THRESHOLD` consecutive unhealthy heartbeats or stale probes mark ISP down
- `SUCCESS_THRESHOLD` consecutive healthy heartbeats mark ISP up
- Down/up transitions create outage records and trigger notifications
