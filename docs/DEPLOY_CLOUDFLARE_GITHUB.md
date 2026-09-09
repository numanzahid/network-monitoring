# Deploy Worker via Cloudflare + GitHub

Use **Cloudflare Workers Builds** (native GitHub integration). Cloudflare pulls
your repo and deploys automatically. You do **not** need `wrangler login` on a
headless machine.

Repo: `numanzahid/network-monitoring`  
Worker code lives in: `worker/`

## Overview

```text
GitHub push -> Cloudflare Workers Builds -> D1 migrate + wrangler deploy
```

Secrets are stored in the **Cloudflare dashboard**, not in GitHub.

---

## Step 1: Create the D1 database (browser)

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **Storage & databases** -> **D1 SQL Database**
3. Click **Create database**
4. Name: `network-monitoring`
5. Create, then copy the **Database ID**

## Step 2: Put the database ID in git

Edit `worker/wrangler.toml`:

```toml
database_id = "paste-your-database-id-here"
```

Commit and push to GitHub:

```bash
git add worker/wrangler.toml
git commit -m "Set D1 database id for Cloudflare deploy"
git push origin master
```

## Step 3: Connect GitHub to Cloudflare

1. Dashboard -> **Workers & Pages**
2. **Create application** -> **Workers** -> **Connect to Git**
3. Install/authorize the **Cloudflare Workers & Pages** GitHub app if asked
4. Select repository: `numanzahid/network-monitoring`
5. Branch: `master`

### Build settings

| Setting | Value |
|---------|-------|
| Root directory | `worker` |
| Build command | `npm ci && npm run cf:build` |
| Deploy command | `npm run cf:deploy` |

6. Save / deploy

Cloudflare will run the first build from your latest `master` commit.

### Optional: build watch paths

In **Settings** -> **Build** -> **Build watch paths**:

- Include: `worker/*`
- Exclude: (leave empty)

This avoids redeploying the Worker when only `isp1/` or `isp2/` files change.

---

## Step 4: Add Worker secrets (Cloudflare dashboard)

Open your Worker -> **Settings** -> **Variables and Secrets**.

Add **Secrets** (encrypted):

| Name | Purpose |
|------|---------|
| `PROBE_SECRET_ISP1` | Must match `PROBE_SECRET` in `isp1/tunnel/.env` |
| `PROBE_SECRET_ISP2` | Must match `PROBE_SECRET` in `isp2/tunnel/.env` |
| `NTFY_AUTH_TOKEN` | Optional, if your ntfy topic is protected |

Non-secret values are already in `worker/wrangler.toml` under `[vars]`:

- `NTFY_TOPIC`
- `STATUS_PAGE_URL`
- `ISP1_LABEL`, `ISP2_LABEL`
- `NOTIFIER_CHANNELS`

Update those in `wrangler.toml`, commit, and push to redeploy.

---

## Step 5: Verify deploy

After a successful build:

1. Open the Worker URL (`*.workers.dev` or your custom domain)
2. Status page should load at `/`
3. API check: `GET /api/status` should return JSON for `isp1` and `isp2`

---

## Step 6: Point probes at the Worker

In each `isp*/tunnel/.env`:

```env
WORKER_URL=https://<your-worker-host>/api/heartbeat
PROBE_SECRET=<same value as PROBE_SECRET_ISP1 or ISP2 in Cloudflare>
```

---

## Day-to-day workflow

1. Change Worker code or `wrangler.toml`
2. Commit and push to `master`
3. Cloudflare builds and deploys automatically

---

## Troubleshooting

**Build fails on D1 migrate**

- Confirm `database_id` in `wrangler.toml` is correct
- Confirm the D1 database exists in the same Cloudflare account

**Heartbeat returns 401**

- `PROBE_SECRET` in probe `.env` must match `PROBE_SECRET_ISP1` / `ISP2` in Cloudflare secrets

**Notifications not sent**

- Check `NOTIFY_ENABLED=true` in `wrangler.toml`
- Check `NTFY_TOPIC` and subscribe to it in the ntfy app
- Add `NTFY_AUTH_TOKEN` secret if the topic requires auth

**Wrangler login not needed**

- Workers Builds uses Cloudflare's own deploy auth
- Ignore `wrangler login` on headless servers when using this flow
