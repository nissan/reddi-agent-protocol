# The Budget watcher and payer alerts

The watcher tells each payer about every reserve, post, dispute and payout on a Budget
the relay spends from, in time to dispute a post (24 hours). This page says where it
runs, what it promises, who is told when it falls behind, and how to set it up. The
watcher's own logic is described at the top of `lib/budget/watch.ts`.

## Where it runs

| Network | Deployment | Pass route | Health route |
| --- | --- | --- | --- |
| Devnet today | Inside the app project | `/api/cron/budget-watch` | `/api/cron/budget-watch/health` |
| Devnet, own project (not deployed yet) | `apps/budget-watch` | `/api/cron/watch` | `/api/v1/health` |
| Mainnet (not deployed yet) | `apps/budget-watch` | `/api/cron/watch` | `/api/v1/health` |

On mainnet the watcher and the alert sender are their own Vercel project (#1208, audit
1079ce8 task 8), so a fault, a bad deploy or a paused project on the relay's side does not
also stop payers hearing about posts. One deployment watches one network and keeps its own
"last complete pass" time (`budget_watch_passes`), so one network's passes cannot hide the
other's stall. The project holds no signing key: it reads the chain, reads and updates the
custody records, and sends email with its own Resend key.

## The promise

**A payer's alert is sent within 10 minutes of the chain event.** The timer calls a pass
every 5 minutes and a pass stops itself after 4, so a healthy watcher keeps this with
room. The health route answers 503 once no complete, error-free pass finished in the last
10 minutes (15 for the route inside the app).

What the promise does not cover: delivery after Resend accepted the email, and an alert
whose send failed (it is sent again every pass, and the operator is told after three).

## Who is told when it falls behind

The owner on call for Budget alerts is Nissan, reached by email plus phone push (his
choice of 26 November 2026).

The timer and the alarm are one Cloudflare Worker (`ops/budget-watch-worker`), outside
every Vercel project. Every 5 minutes it calls each pass, then reads each health route. A
watcher that is behind its promise pages the owner by phone push (a private ntfy topic)
and by email, once when it falls behind and then once an hour; a health route that cannot
be read pages every half hour. A page that no channel took fails the Worker's run, which
Cloudflare can also email on (Notifications > Workers). The GitHub workflow
`budget-watch.yml` stays as a second, slower timer for the route inside the app.

## Settings of a watcher project

All on the watcher project only. Names, never values, appear in health and logs.

| Setting | What |
| --- | --- |
| `BUDGET_WATCH_NETWORK` | `solana-devnet` (default) or `solana-mainnet-beta` |
| `BUDGET_WATCH_PROGRAM_ID` | Required on mainnet; devnet defaults to the repository's devnet profile |
| `BUDGET_WATCH_RPC_URL` | Required on mainnet (https); devnet defaults to the public RPC |
| `BUDGET_WATCH_CRON_SECRET` | Sensitive. The Worker sends it as a bearer token |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | The custody records (sensitive key) |
| `RESEND_API_KEY`, `BUDGET_ALERT_FROM` | Sensitive send-only key of the watcher's own, and the sender |
| `BUDGET_OPS_EMAIL` | Where operator alerts go; optional `BUDGET_OPS_WEBHOOK` with `BUDGET_OPS_WEBHOOK_SECRET` |
| `BUDGET_LINK_ORIGIN` | The app's origin for the dispute link in alerts |
| `BUDGET_SPENDER_P256_PUBLIC_KEY` | The spender's public key, for the rotated-key alert |
| `BUDGET_SIGNER_URL`, `BUDGET_RELEASE_TOKEN` | The signer's origin and the sensitive release token: with both set, each post on a Budget without a judge is released and paid at once (docs/BUDGET-RELAY-CUSTODY.md, "Release on completion"). Without them those posts wait for the dispute window and the operator is told of each |

A pass refuses to run (503 `not_configured`, naming the setting) while any of the network,
program, RPC, store, Resend key, sender or operator email is missing, and (503
`wrong_cluster`) when its RPC serves another network.

## Settings of the Worker

`CRON_SECRET` (the app's), `WATCH_ORIGIN` with `WATCH_CRON_SECRET` (devnet watcher
project), `WATCH_MAINNET_ORIGIN` with `WATCH_MAINNET_CRON_SECRET` (mainnet watcher
project), `NTFY_TOPIC` (the owner's private topic: at least 16 characters, treated as a
secret), `RESEND_API_KEY`, `MONITOR_EMAIL_TO`, `MONITOR_EMAIL_FROM`. A watcher project is
called only when both its origin and its secret are set.

## Known limits

- The alert lag is held by the pass schedule, not measured per alert: the health route
  reports the age of the last complete pass, not the slowest alert.
- The Worker keeps no state, so "once an hour" is by how late the watcher is, and two
  pages can arrive close together around the hour.
- The custody store's service key can write more than the watcher needs. A database role
  limited to the watcher's own columns is not built yet.
