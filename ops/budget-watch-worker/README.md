# Budget watcher timer and outside monitor (Cloudflare Worker)

The Budget watcher (`/api/cron/budget-watch`) and the sandbox providers' slice sweep
(`/api/cron/sandbox-budgets`) need to run every 5 minutes. GitHub's schedule for
`.github/workflows/budget-watch.yml` is best effort and ran hours apart in practice, and
the app's Vercel plan runs crons daily only. This Worker is the timer: a cron trigger
that calls both routes with the app's `CRON_SECRET`. It sits outside the app's Vercel
project, so a fault in that project does not also stop the timer.

- `worker.js`: the Worker. It logs status codes and counts only.
- `wrangler.toml`: name `rap-budget-watch`, cron `*/5 * * * *`, no public URL.
- `setup.sh`: owner-run. Makes a fresh cron secret, stores it in 1Password
  (item "RAP Budget watcher cron secret"), sets it on the app, in GitHub Actions and on
  the Worker, deploys the Worker, redeploys the app and checks the result.

```bash
bash ops/budget-watch-worker/setup.sh
```

Run it again to rotate the secret. The GitHub workflow stays as a second, slower timer
and for runs by hand. The hourly uptime check reads `/api/cron/budget-watch/health` and
opens an issue when no complete pass happened in 15 minutes.

A Worker run that fails throws, so it shows as an error in the Worker's metrics;
Cloudflare can email on errors (Notifications > Workers).

## Outside monitor (#1208)

After the passes, the Worker reads each watcher's public health route and pages the owner
when a watcher is behind its alert promise: by phone push through a private ntfy topic
(`NTFY_TOPIC`) and by email through its own Resend key (`RESEND_API_KEY`,
`MONITOR_EMAIL_TO`, `MONITOR_EMAIL_FROM`). It also calls the watcher's own projects
(`apps/budget-watch`) once `WATCH_ORIGIN` / `WATCH_CRON_SECRET` (devnet) or
`WATCH_MAINNET_ORIGIN` / `WATCH_MAINNET_CRON_SECRET` (mainnet) are set. The settings, the
promise and the paging rule are in `docs/BUDGET-WATCHER.md`. `setup.sh` does not set these
yet: set them with `npx wrangler secret put <NAME>` in this folder.
