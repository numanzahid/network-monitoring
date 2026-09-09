# Notifications

Notifications are sent by the Cloudflare Worker when an ISP transitions between
up and down states. Alerts are debounced; one down alert and one recovery alert
are sent per outage.

## Enable channels

Set `NOTIFIER_CHANNELS` in `worker/wrangler.toml`:

```toml
NOTIFIER_CHANNELS = "ntfy"
```

Supported values:

- `ntfy`
- `telegram`
- `discord`

Multiple channels:

```toml
NOTIFIER_CHANNELS = "ntfy,telegram,discord"
```

Set `NOTIFY_ENABLED = "false"` to disable all notifications.

## ntfy (default)

Vars:

- `NTFY_SERVER` (default `https://ntfy.sh`)
- `NTFY_TOPIC`
- `NTFY_PRIORITY_DOWN`
- `NTFY_PRIORITY_UP`

Optional secret:

- `NTFY_AUTH_TOKEN`

Subscribe with the ntfy mobile app or browser using your topic name.

## Telegram

Secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Add `telegram` to `NOTIFIER_CHANNELS`.

## Discord

Secret:

- `DISCORD_WEBHOOK_URL`

Add `discord` to `NOTIFIER_CHANNELS`.

## Retry behavior

A cron job runs every 5 minutes to:

- detect stale probes
- retry unsent down/recovery notifications
- clean up old heartbeat nonces
