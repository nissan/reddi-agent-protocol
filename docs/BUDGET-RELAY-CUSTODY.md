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
- Every signature is logged to `budget_spender_uses` before it is made. If the log write fails, nothing is signed.
- The key signs only `reserve`, `waive` or `close` of its own Budget and opening, as the only escrow-program
  instruction, never as fee payer. A reserve is signed only for a provider the payer named, when the payer named any.
- More than `BUDGET_SPENDER_MAX_USES_PER_10_MIN` uses (default 30) in ten minutes freezes the key and tells the operator.
- `BUDGET_SPENDING_PAUSED=true`, or the switch in `budget_controls`, stops every reserve and waive. A close is still
  signed, so the incident step works while paused.

The payer must give a contact (email or an https webhook) before a spender key is made for them.

## What the payer is told

`/api/cron/budget-watch` runs every five minutes (`.github/workflows/budget-watch.yml`). For each Budget it compares the
slices on chain with what it saw last time and tells the payer about every new or raised slice, every post or re-post
(with the amount, the dispute deadline and a Solana Pay link that builds the dispute for their wallet), every dispute and
every payout. A slice for a provider the payer did not name also alerts the operator, because the relay never signs one:
treat that as a stolen key and run the incident step.

## Setup (owner)

Values go in 1Password first, then Vercel (project `reddi-agent-protocol`) or GitHub. Never in the repository.

| Name | Where | What |
| --- | --- | --- |
| `BUDGET_SPENDER_KEKS` | Vercel | `kid:base64key[,kid:base64key…]`, each key 32 random bytes. The first one seals; the rest only open. Make one with `node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"`. |
| `RESEND_API_KEY`, `BUDGET_ALERT_FROM` | Vercel | Alert email sender (for example `RAP Budgets <alerts@reddi.tech>`). |
| `BUDGET_OPS_EMAIL`, `BUDGET_OPS_WEBHOOK` | Vercel | Where operator alerts go. Set at least one. |
| `CRON_SECRET` | Vercel | Bearer secret of `/api/cron/budget-watch`. The route refuses every call while it is unset. |
| `BUDGET_WATCH_CRON_SECRET` | GitHub repository secret | The same value as `CRON_SECRET`. The workflow skips while it is missing. |
| `BUDGET_INCIDENT_SECRET` | Vercel | Bearer secret of `/api/budget/v1/incident`. |
| `BUDGET_OPS_FEE_PAYER` | Vercel | JSON array of the 64 secret-key bytes of a fee key that holds only SOL for fees, never Budget money. |
| `BUDGET_SPENDER_MAX_USES_PER_10_MIN` | Vercel, optional | Overuse limit, default 30. |

Apply `supabase/migrations/20261125090000_budget_custody.sql` before the first spender key is made.

### Rotating a KEK

Add the new key first in the list (`k2:…,k1:…`) and redeploy. New keys are sealed under `k2`; old ones still open with
`k1` and can be resealed with `resealSpenderKey`. Remove `k1` only when no row has `key_id = 'k1'`.

## Incident: a spender key, a KEK or the relay may be compromised

1. Pause and close everything:

   ```bash
   curl -X POST https://app.agent-protocol.reddi.tech/api/budget/v1/incident \
     -H "Authorization: Bearer $BUDGET_INCIDENT_SECRET" -H 'Content-Type: application/json' \
     -d '{"action":"close-all","reason":"<what happened>"}'
   ```

   This pauses every spender, freezes Budgets not yet opened, and closes every open Budget on chain with its own key,
   paid by `BUDGET_OPS_FEE_PAYER`. A close stops new slices and returns what was never reserved to the payer. Slices
   already posted keep their dispute window, so payers can still dispute them; each payer is emailed.
2. If `BUDGET_OPS_FEE_PAYER` is unset, the call only pauses and lists the Budgets still open. `{"action":"pause"}` does
   the same on purpose. If the pause switch itself cannot be written, set `BUDGET_SPENDING_PAUSED=true` and redeploy.
3. Read the operator summary. Close any Budget listed as `FAILED` by hand, then rotate the KEKs if they may be known.

## Recording paid work

`verifyAndRecordBudgetCall` (`lib/jobs/budget-call.ts`) records a job only for a landed `payout_budget` or
`resolve_budget` (or the token forms) for that Budget's opening, this provider's reservation and this payer, using the
amounts of the program's own `BudgetPaid` event, and only with the provider's signed receipt v2 whose `budget` block names
the same Budget, opening and reservation and states at least what was charged. A payout that paid nothing records nothing.
