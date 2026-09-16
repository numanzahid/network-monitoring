# secrets and private configuration

This file lists secret names and where they belong. It intentionally contains
no secret values. All `.env` and `.dev.vars` files are ignored by Git.

There are **11 unique secret variable names** in the system. Some names have
one value per ISP or are copied into more than one service.

## cloudflare worker secrets

Store these in the Cloudflare Worker production settings under **Variables and
Secrets > Secrets**.

| Name | Required | Scope | Purpose |
| --- | --- | --- | --- |
| `PROBE_SECRET_ISP1` | Yes | One value for ISP1 | HMAC authentication for ISP1 heartbeats |
| `PROBE_SECRET_ISP2` | Yes | One value for ISP2 | HMAC authentication for ISP2 heartbeats |
| `NTFY_TOPIC` | Yes when ntfy is enabled | One notification topic | Destination topic on the configured ntfy server |
| `NTFY_AUTH_TOKEN` | Optional | ntfy | Authentication for a protected ntfy topic |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram | Bot credential when Telegram is enabled |
| `TELEGRAM_CHAT_ID` | Optional | Telegram | Destination chat when Telegram is enabled |
| `DISCORD_WEBHOOK_URL` | Optional | Discord | Webhook destination when Discord is enabled |

The current committed configuration enables `ntfy` through
`NOTIFIER_CHANNELS = "ntfy"`. Telegram and Discord are available only when
their secrets are added and their channel names are enabled.

The non-secret notification settings are in
[`worker/wrangler.toml`](../worker/wrangler.toml), including `NTFY_SERVER`,
`NOTIFY_ENABLED`, priorities, and channel selection.

## local history service

Store this in `local/.env` on the local machine running the history service.

| Name | Required | Location | Purpose |
| --- | --- | --- | --- |
| `LOCAL_INGEST_TOKEN` | Yes | `local/.env` | Authorizes probes to post history data to `/api/ingest` |

Generate one private value and use the same value in both probe environment
files. It must not be committed.

## probe services

Each probe has its own ignored environment file:

- `isp1/probe/.env`
- `isp2/probe/.env`

| Name | Required | Location | Purpose |
| --- | --- | --- | --- |
| `PROBE_SECRET` | Yes | Both probe files | Copy the matching `PROBE_SECRET_ISP1` or `PROBE_SECRET_ISP2` value |
| `SPEEDTEST_API_TOKEN` | Yes for tracker history | One value per probe | Read access to that ISP's Speedtest Tracker API |
| `LOCAL_INGEST_TOKEN` | Required when local history is enabled | Both probe files | Copy the value from `local/.env` |

The probe secret must match the ISP-specific Cloudflare secret. The
`SPEEDTEST_API_TOKEN` values are separate for ISP1 and ISP2 because each probe
reads its own tracker.

## speedtest tracker services

Each tracker has its own ignored environment file:

- `isp1/speedtest-tracker/.env`
- `isp2/speedtest-tracker/.env`

| Name | Required | Location | Purpose |
| --- | --- | --- | --- |
| `APP_KEY` | Yes | One value per tracker | Application encryption key for that tracker |

Do not share tracker configuration directories or application keys between the
two ISP instances.

## local Worker development

For local Wrangler development only, use `worker/.dev.vars`:

| Name | Required | Purpose |
| --- | --- | --- |
| `PROBE_SECRET_ISP1` | Yes for local heartbeat tests | Test HMAC secret for ISP1 |
| `PROBE_SECRET_ISP2` | Yes for local heartbeat tests | Test HMAC secret for ISP2 |

Use test values in `.dev.vars`. Production values belong in Cloudflare and the
probe environment files.

## private values that are not secrets

These values can still identify or expose the private network and should stay
in ignored environment files or deployment settings:

- `WORKER_URL`
- `WORKER_STATUS_URL`
- `LOCAL_URL`
- `PROBE_IP`
- `PROBE_MAC`
- `TRACKER_IP`
- `TRACKER_MAC`
- `APP_URL`
- `STATUS_PAGE_URL`

Never commit actual values for these settings, even though they are not
credentials.
