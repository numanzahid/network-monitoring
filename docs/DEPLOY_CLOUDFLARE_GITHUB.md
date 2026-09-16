# deploy with cloudflare builds

Cloudflare Workers Builds can deploy the Worker from the Git repository. Configure the Worker root directory as `worker`.

Use these build settings:

| setting | value |
| --- | --- |
| root directory | `worker` |
| build command | `npm ci && npm run cf:build` |
| deploy command | `npm run cf:deploy` |

The deploy command creates the Durable Object class declared in `wrangler.toml`. No D1 database, migration, or database identifier is required.

Store these as Cloudflare secrets:

- `PROBE_SECRET_ISP1`
- `PROBE_SECRET_ISP2`
- `NTFY_TOPIC`
- `NTFY_AUTH_TOKEN` (optional)

Set deployment-specific notification values in the Cloudflare dashboard. Do not commit receiver URLs, probe secrets, notification topics, IP addresses, tokens, or local hostnames.

After deployment, verify:

```bash
curl -sS https://<worker-host>/api/status
curl -i -X POST https://<worker-host>/api/status
```

The first request should return two live-state entries. The second should return `405`.
