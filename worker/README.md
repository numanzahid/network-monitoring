# Cloudflare Worker

Receives probe heartbeats, stores history in D1, sends notifications, and serves
the public status page.

## Features

- Signed heartbeat ingestion for `isp1` and `isp2`
- Debounced outage detection and recovery events
- D1 storage for outages and speedtest history
- Modular notifications: `ntfy`, `telegram`, `discord`
- JSON API for a replaceable frontend
- Simple bundled status page in `public/`

## Setup

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
```

Create the D1 database:

```bash
npx wrangler d1 create network-monitoring
```

Copy the returned `database_id` into `wrangler.toml`, then apply migrations:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

Set secrets:

```bash
npx wrangler secret put PROBE_SECRET_ISP1
npx wrangler secret put PROBE_SECRET_ISP2
npx wrangler secret put NTFY_AUTH_TOKEN
```

Optional notification secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put DISCORD_WEBHOOK_URL
```

Update `[vars]` in `wrangler.toml`:

- `STATUS_PAGE_URL`
- `NTFY_SERVER` and `NTFY_TOPIC`
- `ISP1_LABEL` and `ISP2_LABEL`
- `NOTIFIER_CHANNELS` (example: `ntfy` or `ntfy,telegram,discord`)

## Development

```bash
npm run db:migrate:local
npm run dev
```

Open the local dev URL shown by Wrangler.

## Deploy

### Recommended: Cloudflare + GitHub (headless-friendly)

No `wrangler login` required. See `../docs/DEPLOY_CLOUDFLARE_GITHUB.md`.

Summary:

- Root directory in Cloudflare Builds: `worker`
- Build command: `npm ci && npm run cf:build`
- Deploy command: `npm run cf:deploy`
- Store secrets in the Cloudflare Worker dashboard

### Manual deploy (requires Wrangler auth)

```bash
npm run typecheck
npm run cf:deploy
```

## API

- `GET /api/status`
- `GET /api/history/outages?isp=isp1&days=30`
- `GET /api/history/speedtests?isp=isp1&days=14`
- `POST /api/heartbeat`

See `../docs/HEARTBEAT_API.md` for the heartbeat contract.

## Frontend

The default UI lives in `public/`:

- `js/api.js` fetches JSON from the Worker API
- `js/render.js` renders cards and tables
- `js/charts.js` renders Chart.js graphs
- `js/app.js` wires refresh and filters

Replace or extend `public/` later without changing the API.

## Notifications

Enabled channels are listed in `NOTIFIER_CHANNELS`. Each channel is implemented
in `src/notify/` behind a shared `Notifier` interface.

Default configuration uses ntfy:

- `NTFY_SERVER=https://ntfy.sh`
- `NTFY_TOPIC=network-monitoring-alerts`

Subscribe on your phone with the ntfy app or visit the topic URL in a browser.
