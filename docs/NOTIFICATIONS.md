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

Vars in `wrangler.toml`:

- `NTFY_SERVER` (default `https://ntfy.sh`)
- `NTFY_PRIORITY_DOWN`
- `NTFY_PRIORITY_UP`

Secrets (not in git):

- `NTFY_TOPIC` -- use a random unguessable name, e.g. `nm-$(openssl rand -hex 16)`
- `NTFY_AUTH_TOKEN` -- optional extra lock on the topic

Subscribe in the ntfy app to `https://ntfy.sh/<NTFY_TOPIC>`. Do not commit the
topic name to the repository; anyone who knows it can subscribe or post to it
on the public ntfy.sh server.

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
