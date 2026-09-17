# cloudflare worker

The Worker receives compact signed heartbeats and keeps live presence state in one Durable Object per ISP. It serves the live status API, bounded recent history, and transition notifications. Detailed long-term history is stored by the local history service.

## setup

```bash
npm install
npm run dev
```

For local development, copy `.dev.vars.example` to `.dev.vars` and keep the
test values local. Production secrets belong in the Cloudflare dashboard:

- `PROBE_SECRET_ISP1`
- `PROBE_SECRET_ISP2`
- `NTFY_TOPIC`
- `NTFY_AUTH_TOKEN` (optional)

Set `STATUS_PAGE_URL` in the Cloudflare dashboard if notification links are needed.

## api

- `GET /api/status` returns live state for both ISPs.
- `POST /api/heartbeat` accepts v2 compact signed heartbeats.
- `GET /api/history/latency` returns bounded recent heartbeat samples.
- `GET /api/history/outages` returns bounded recent remote outages.
- `GET /api/history/speedtests` returns bounded recent speedtest summaries.

Remote heartbeat history is retained for `REMOTE_HISTORY_HOURS` (24 hours by
default). Remote speedtest history is retained for
`REMOTE_SPEEDTEST_HISTORY_DAYS` (30 days by default). The local history app
remains the source of truth for long-term charts and logs.

The v2 signature covers:

```text
{ts}.{boot_id}.{seq}.{raw_json_body}
```

## deploy

The Git connected deployment runs:

```bash
npm ci && npm run cf:build
npm run cf:deploy
```

`cf:deploy` only deploys the Worker and Durable Object migration. It does not run a D1 migration.
