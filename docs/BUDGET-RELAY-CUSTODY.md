# Budget spending by the relay: the spender key in Vercel KMS

Audit round 4 (S7-claude-03, -06) asked for the pooled Budget's off-chain pieces before a Budget is offered to anyone.
This file says what they are, how to set them up and what to do in an incident. Code: `lib/budget/`,
`lib/jobs/budget-call.ts`, `app/api/budget/v1/`, `app/api/cron/budget-watch/`.

## What the relay holds

A pooled Budget names a spender that may reserve slices for providers, waive, and close. When the Reddi Agent Protocol
(RAP) relay spends for a payer, the spender is a P-256 key in Vercel KMS (owner decision, 24 November 2026), and the
relay holds no key material at all:

- The payer opens the Budget with flag `0x08` (P-256 spender). Its spender field is the SHA-256 of the KMS key's
  33-byte compressed public key. Every Budget the relay spends from names that same key.
- For each call the relay builds the 175-byte approval itself (program README, "P-256 spender (flag 0x08)"): the
  Budget, its `created_slot`, the action (`reserve`, `waive` or `close`), the provider, payout account and amount
  for a reserve, the cluster, and an expiry 150 slots (about a minute) ahead. Vercel KMS signs it (ES256) through the
  deployment's OIDC token, so only deployments the issuer's project grant names can ask, and the private key never
  leaves KMS. The relay hands back the secp256r1 approval instruction and the call that goes right after it.
- Every signature KMS returns is checked against the public key the Budget was opened with before it is used, so an
  approval from a rotated key is refused instead of sent.
- Records live in `budget_spenders` (Supabase, service role only, RLS on with no policies): payer, Budget, the public
  key, contacts and what the watcher saw. Nothing secret.
- Every approval is logged to `budget_spender_uses` before KMS is asked, by one database function
  (`budget_spender_use`) that in the same step checks the pause switch, the record's status and the overuse limit, so
  concurrent requests cannot slip past them. If the log write fails, nothing is signed.
- A reserve, or a waive, is approved only for a provider the payer named, when the payer named any.
- More than `BUDGET_SPENDER_MAX_USES_PER_10_MIN` approvals (default 30) for one Budget in ten minutes freezes it and
  tells the operator.
- `BUDGET_SPENDING_PAUSED` (any value but empty, `false`, `0`, `no` or `off`), or the switch in `budget_controls`,
  stops every reserve and waive. A close is still approved, so the incident step works while paused. A pause does not
  revoke an approval already given; it expires within about a minute. Removing the KMS project grant stops all
  signing at once.
- There is no nonce: replay is stopped by the Budget's state (a reserve must raise the slice, a waive or close happens
  once) and the short expiry.

No record is made unless the payer gave a contact (email or an https webhook) that this server can actually reach, and an
operator channel is set. A payer webhook gets a secret at key creation; every webhook alert carries
`x-rap-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` (operator webhooks use
`BUDGET_OPS_WEBHOOK_SECRET`). Receivers should check it and refuse a `t` older than five minutes.

## What the payer is told

`/api/cron/budget-watch` runs every five minutes (`.github/workflows/budget-watch.yml`). For each Budget it compares the
slices on chain with what it saw last time and tells the payer about every new or raised slice, every post or re-post
(with the amount, the dispute deadline and a Solana Pay link that builds the dispute for their wallet), every dispute and
every payout or settled slice. A slice for a provider the payer did not name also alerts the operator, because the relay
never approves one: treat that as a compromised relay or KMS access and run the incident step.

- A slice's alert counts as sent only when a payer channel took it; otherwise it is sent again every pass, and after
  three passes the operator is told.
- Budgets are watched several at once, least recently watched first, each alert channel with a 5 second timeout, so one
  payer's slow webhook cannot hold up the rest. There is no row cap.
- The route answers 503 when any Budget could not be watched or the pass ran out of time, so the workflow run fails.
  The workflow also fails when its secret is missing, and logs only counts.
- A Budget's record is marked closed only on proof the Budget is over: reopened under a new `created_slot`, or its account
  missing at the finalized commitment on two passes at least four minutes apart. An unreadable account only alerts.
- A frozen record the relay never saw open is looked up by its spender and payer (skipping Budgets another record
  holds), so a Budget the payer opened anyway is watched and can be closed.
- A live record whose public key is not `BUDGET_SPENDER_P256_PUBLIC_KEY` (the KMS key was rotated, or the setting is
  missing) alerts the operator on every pass: the relay cannot approve anything for it, the close included.
- Dispute links use `BUDGET_LINK_ORIGIN` (default `https://app.agent-protocol.reddi.tech`), never the request's host.

GitHub's schedule is best effort. Point an uptime monitor at `/api/cron/budget-watch/health`: it answers 200 only when
a complete, error-free pass finished in the last 15 minutes, and says nothing else. The watcher also tells the operator
when it resumes after a stall.

## Setup (owner)

Values go in 1Password first, then Vercel (project `reddi-agent-protocol`) or GitHub. Never in the repository.

1. Create a KMS issuer with algorithm `ES256` (Vercel dashboard, or the Vercel connector), and grant it to this
   project for Production only: `vercel kms add-grant <issuer> --project reddi-agent-protocol --environment production`.
   Vercel marks KMS as beta.
2. Set `BUDGET_SPENDER_P256_PUBLIC_KEY` to the active signing key's `publicKeyPem` as the issuer shows it (or the
   point in hex or base64: 33-byte compressed or 65-byte uncompressed).

| Name | Where | What |
| --- | --- | --- |
| `BUDGET_SPENDER_KMS_ISSUER_ID` | Vercel, Production only | The KMS issuer whose ES256 key approves. |
| `BUDGET_SPENDER_P256_PUBLIC_KEY` | Vercel, Production only | Its public key (above). New Budgets name it; every KMS signature is checked against the Budget's own key. |
| `RESEND_API_KEY`, `BUDGET_ALERT_FROM` | Vercel | Alert email sender (for example `RAP Budgets <alerts@reddi.tech>`). |
| `BUDGET_OPS_EMAIL`, `BUDGET_OPS_WEBHOOK` | Vercel | Where operator alerts go. Set at least one. |
| `CRON_SECRET` | Vercel | Bearer secret of `/api/cron/budget-watch`. The route refuses every call while it is unset. |
| `BUDGET_WATCH_CRON_SECRET` | GitHub repository secret | The same value as `CRON_SECRET`. The workflow skips while it is missing. |
| `BUDGET_INCIDENT_SECRET` | Vercel | Bearer secret of `/api/budget/v1/incident`. |
| `BUDGET_OPS_FEE_PAYER` | Vercel, Production only | JSON array of the 64 secret-key bytes of a fee key that holds only SOL for fees, never Budget money. |
| `BUDGET_SPENDER_MAX_USES_PER_10_MIN` | Vercel, optional | Overuse limit per Budget, default 30. |
| `BUDGET_OPS_WEBHOOK_SECRET` | Vercel, optional | Signs operator webhook alerts. |
| `BUDGET_LINK_ORIGIN` | Vercel, optional | Origin of dispute links, default the production app. |

Grant the issuer to Production only, never Preview: any deployment it is granted to can approve for every relay
Budget. `BUDGET_SPENDER_KEKS` is no longer read; delete it from Vercel and 1Password once this is deployed.

Apply `supabase/migrations/20261125090000_budget_custody.sql`, `20261125100000_budget_custody_hardening.sql` and
`20261125110000_budget_custody_kms.sql` before the first Budget record is made. The last one drops the sealed-key
columns; it fails if any record exists, so a record from the earlier design is never silently kept without a key.

### Rotating the KMS key

A Budget names one key for its whole life (at most its open period plus the dispute window). Rotate only when no
relay Budget is open, or accept that those Budgets can no longer be approved by the relay, the close included: their
payers can close them, and the watcher alerts the operator about each (`key_rotated`). To rotate: create the new
signing key with manual activation, activate it, set `BUDGET_SPENDER_P256_PUBLIC_KEY` to its public key and redeploy.

## Incident: the relay or its KMS access may be compromised

1. Pause and close everything:

   ```bash
   curl -X POST https://app.agent-protocol.reddi.tech/api/budget/v1/incident \
     -H "Authorization: Bearer $BUDGET_INCIDENT_SECRET" -H 'Content-Type: application/json' \
     -d '{"action":"close-all","reason":"<what happened>"}'
   ```

   This pauses every approval, freezes records not yet opened (their payers are told not to open), finds any Budget
   opened from a frozen record, and closes every open Budget on chain with a KMS approval, several at once, paid by
   `BUDGET_OPS_FEE_PAYER`. A close stops new slices and returns what was never reserved to the payer. Slices already
   posted keep their dispute window, so payers can still dispute them; each payer is emailed. Budgets already closed are
   skipped. The answer (HTTP 207 when anything is left) and the operator summary list every Budget as closed, already
   closed, failed, or not reached; run the step again until nothing is left. On a Budget that lets the spender waive
   (allowlist plus flag `0x01`), whoever can still get KMS to sign can waive posted slices until they settle; those
   payers are told to dispute anything they do not recognise at once.
2. If `BUDGET_OPS_FEE_PAYER` is unset, the call only pauses and lists the Budgets still open. `{"action":"pause"}` does
   the same on purpose. If the pause switch itself cannot be written, set `BUDGET_SPENDING_PAUSED=true` and redeploy.
3. If the relay itself may be compromised, remove the KMS issuer's project grant (or revoke its key) once the closes
   are done: from then on nothing, the relay included, can approve for any relay Budget, and open ones end with their
   payers.
4. Read the operator summary. Close any Budget listed as `FAILED` by hand.

## Recording paid work

`verifyAndRecordBudgetCall` (`lib/jobs/budget-call.ts`) records a job only for a landed `payout_budget` or
`resolve_budget` (or the token forms) for that Budget's opening, this provider's reservation and this payer, using the
amounts of the program's own `BudgetPaid` event, and only with the provider's signed receipt v2 whose `budget` block names
the same Budget, opening and reservation and states at least what was charged. A payout that paid nothing records nothing.
