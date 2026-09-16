# cloudflare worker

The Worker receives compact signed heartbeats and keeps live presence state in one Durable Object per ISP. It serves the live status API and sends transition notifications. Detailed history is stored by the local history service.

## setup

```bash
npm install
npm run dev
```

For local secrets, create `.dev.vars` with test values. Production secrets belong in the Cloudflare dashboard:

- `PROBE_SECRET_ISP1`
- `PROBE_SECRET_ISP2`
- `NTFY_TOPIC`
- `NTFY_AUTH_TOKEN` (optional)

Set `STATUS_PAGE_URL` in the Cloudflare dashboard if notification links are needed.

## api

- `GET /api/status` returns live state for both ISPs.
- `POST /api/heartbeat` accepts v2 compact signed heartbeats.
- `/api/history/*` returns `410`; history is served by the local history app.

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
