# Budget spender keys held by the relay

Audit round 4 (S7-claude-03, -06) asked for the pooled Budget's off-chain pieces before a Budget is offered to anyone.
This file says what they are, how to set them up and what to do in an incident. Code: `lib/budget/`,
`lib/jobs/budget-call.ts`, `app/api/budget/v1/`, `app/api/cron/budget-watch/`.

## What the relay holds

A pooled Budget names a spender key that may reserve slices for providers, waive, and close. When the Reddi Agent
Protocol (RAP) relay spends for a payer, it holds that key:

- One random ed25519 key per Budget, never reused.
- Sealed with AES-256-GCM under a key-encryption key (KEK) from `BUDGET_SPENDER_KEKS`. The sealed blob is bound to its
  record id and spender address, so it cannot be moved to another row.
- Stored in `budget_spenders` (Supabase, service role only, RLS on with no policies). The sealed key is erased when the
  Budget is found closed and settled; the table refuses a closed row that still holds one.
- Every signature is logged to `budget_spender_uses` before it is made, by one database function
  (`budget_spender_use`) that in the same step checks the pause switch, the key's status and the overuse limit, so
  concurrent requests cannot slip past them. If the log write fails, nothing is signed.
- The key signs only the compiled message it inspected: `reserve`, `waive` or `close` of its own Budget and opening,
  as the only escrow-program instruction, with only ComputeBudget instructions beside it (and, for a token close, the
  idempotent creation of the payer's token account). No durable nonce, and the fee payer must be set and must not be
  the spender, so a signature expires with its blockhash (about a minute). A reserve, or a waive, is signed only for a
  provider the payer named, when the payer named any.
- More than `BUDGET_SPENDER_MAX_USES_PER_10_MIN` uses (default 30) in ten minutes freezes the key and tells the operator.
- `BUDGET_SPENDING_PAUSED` (any value but empty, `false`, `0`, `no` or `off`), or the switch in `budget_controls`,
  stops every reserve and waive. A close is still signed, so the incident step works while paused. A pause does not
  revoke a signature already given; it expires within about a minute. Only a close stops a stolen copy of a key.
- The key is opened to its seed in a buffer the relay owns, used once and wiped.

No key is made unless the payer gave a contact (email or an https webhook) that this server can actually reach, and an
operator channel is set. A payer webhook gets a secret at key creation; every webhook alert carries
`x-rap-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` (operator webhooks use
`BUDGET_OPS_WEBHOOK_SECRET`). Receivers should check it and refuse a `t` older than five minutes.

## What the payer is told

`/api/cron/budget-watch` runs every five minutes (`.github/workflows/budget-watch.yml`). For each Budget it compares the
slices on chain with what it saw last time and tells the payer about every new or raised slice, every post or re-post
(with the amount, the dispute deadline and a Solana Pay link that builds the dispute for their wallet), every dispute and
every payout or settled slice. A slice for a provider the payer did not name also alerts the operator, because the relay
never signs one: treat that as a stolen key and run the incident step.

- A slice's alert counts as sent only when a payer channel took it; otherwise it is sent again every pass, and after
  three passes the operator is told.
- Budgets are watched several at once, least recently watched first, each alert channel with a 5 second timeout, so one
  payer's slow webhook cannot hold up the rest. There is no row cap.
- The route answers 503 when any Budget could not be watched or the pass ran out of time, so the workflow run fails.
  The workflow also fails when its secret is missing, and logs only counts.
- A Budget's key is erased only on proof the Budget is over: reopened under a new `created_slot`, or its account
  missing at the finalized commitment on two passes at least four minutes apart. An unreadable account only alerts.
- A frozen key the relay never saw open is looked up by its spender address, so a Budget the payer opened anyway is
  watched and can be closed.
- Dispute links use `BUDGET_LINK_ORIGIN` (default `https://app.agent-protocol.reddi.tech`), never the request's host.

GitHub's schedule is best effort. Point an uptime monitor at `/api/cron/budget-watch/health`: it answers 200 only when
a complete, error-free pass finished in the last 15 minutes, and says nothing else. The watcher also tells the operator
when it resumes after a stall.

## Setup (owner)

Values go in 1Password first, then Vercel (project `reddi-agent-protocol`) or GitHub. Never in the repository.

| Name | Where | What |
| --- | --- | --- |
| `BUDGET_SPENDER_KEKS` | Vercel, Production only | `kid:base64key[,kid:base64key…]`, each key 32 random bytes. The first one seals; the rest only open. Make one with `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"`. |
| `RESEND_API_KEY`, `BUDGET_ALERT_FROM` | Vercel | Alert email sender (for example `RAP Budgets <alerts@reddi.tech>`). |
| `BUDGET_OPS_EMAIL`, `BUDGET_OPS_WEBHOOK` | Vercel | Where operator alerts go. Set at least one. |
| `CRON_SECRET` | Vercel | Bearer secret of `/api/cron/budget-watch`. The route refuses every call while it is unset. |
| `BUDGET_WATCH_CRON_SECRET` | GitHub repository secret | The same value as `CRON_SECRET`. The workflow skips while it is missing. |
| `BUDGET_INCIDENT_SECRET` | Vercel | Bearer secret of `/api/budget/v1/incident`. |
| `BUDGET_OPS_FEE_PAYER` | Vercel, Production only | JSON array of the 64 secret-key bytes of a fee key that holds only SOL for fees, never Budget money. |
| `BUDGET_SPENDER_MAX_USES_PER_10_MIN` | Vercel, optional | Overuse limit, default 30. |
| `BUDGET_OPS_WEBHOOK_SECRET` | Vercel, optional | Signs operator webhook alerts. |
| `BUDGET_LINK_ORIGIN` | Vercel, optional | Origin of dispute links, default the production app. |

Scope `BUDGET_SPENDER_KEKS`, `BUDGET_OPS_FEE_PAYER` and `SUPABASE_SERVICE_ROLE_KEY` to Production only, never Preview:
anyone who can run code in a deployment that has both the KEKs and the service-role key holds every spender key.
Supabase backups keep sealed keys after they are erased here, so a KEK stays sensitive for as long as backups do.
Before mainnet Budgets the plan is to move unsealing out of the web runtime (a KMS or a separate signer service); that
choice is the owner's.

Apply `supabase/migrations/20261125090000_budget_custody.sql` and `20261125100000_budget_custody_hardening.sql` before
the first spender key is made.

### Rotating a KEK

Add the new key first in the list (`k2:…,k1:…`) and redeploy. New keys are sealed under `k2`; old ones still open with
`k1`. Count and reseal through the incident route: `{"action":"reseal","reason":"rotation"}` counts live keys per KEK,
and adding `"apply":true` reseals them under `k2`. Remove `k1` only when the count shows none under it; the watcher
alerts the operator about any live key whose KEK is missing. Resealing does not help when a KEK may be exposed: the
spender keys it opened are the same keys, so run the incident close instead.

## Incident: a spender key, a KEK or the relay may be compromised

1. Pause and close everything:

   ```bash
   curl -X POST https://app.agent-protocol.reddi.tech/api/budget/v1/incident \
     -H "Authorization: Bearer $BUDGET_INCIDENT_SECRET" -H 'Content-Type: application/json' \
     -d '{"action":"close-all","reason":"<what happened>"}'
   ```

   This pauses every spender, freezes keys not yet opened (their payers are told not to open), finds any Budget opened
   with a frozen key, and closes every open Budget on chain with its own key, several at once, paid by
   `BUDGET_OPS_FEE_PAYER`. A close stops new slices and returns what was never reserved to the payer. Slices already
   posted keep their dispute window, so payers can still dispute them; each payer is emailed. Budgets already closed are
   skipped. The answer (HTTP 207 when anything is left) and the operator summary list every Budget as closed, already
   closed, failed, or not reached; run the step again until nothing is left. On a Budget that lets the spender waive
   (allowlist plus flag `0x01`), a stolen copy of the key can still waive posted slices until they settle; those payers
   are told to dispute anything they do not recognise at once.
2. If `BUDGET_OPS_FEE_PAYER` is unset, the call only pauses and lists the Budgets still open. `{"action":"pause"}` does
   the same on purpose. If the pause switch itself cannot be written, set `BUDGET_SPENDING_PAUSED=true` and redeploy.
3. Read the operator summary. Close any Budget listed as `FAILED` by hand, then rotate the KEKs if they may be known.

## Recording paid work

`verifyAndRecordBudgetCall` (`lib/jobs/budget-call.ts`) records a job only for a landed `payout_budget` or
`resolve_budget` (or the token forms) for that Budget's opening, this provider's reservation and this payer, using the
amounts of the program's own `BudgetPaid` event, and only with the provider's signed receipt v2 whose `budget` block names
the same Budget, opening and reservation and states at least what was charged. A payout that paid nothing records nothing.
