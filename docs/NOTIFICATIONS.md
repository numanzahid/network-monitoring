# Notifications

Notifications are sent by the Cloudflare Worker when an ISP transitions between
up and down states. Each ISP has its own notification queue.

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

Tapping a notification opens `STATUS_PAGE_URL` from `wrangler.toml` (ntfy `Click`
header).

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

Each ISP Durable Object schedules an alarm after every accepted heartbeat.
The alarm detects missed beats and retries notifications that could not be
delivered. If an outage recovers before its DOWN notification is delivered, the
queue replaces the pair with one `[RECOVERED]` message. That message includes
the outage start and end, duration, current state, and delivery delay. This
avoids sending a stale DOWN message immediately followed by an UP message.

HTTP 429 responses use the server's retry interval when available, with a
bounded fallback delay, so the Worker does not retry on every heartbeat while a
notification service is rate limiting it.
