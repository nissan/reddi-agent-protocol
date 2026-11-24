# Budget spending by the relay: the spender key in Vercel KMS

Audit round 4 (S7-claude-03, -06) asked for the pooled Budget's off-chain pieces before a Budget is offered to anyone;
audit rounds 5 and 5b (on 3102743 and 5b062a9) tightened who may ask for an approval and what one may allow.
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
  key, contacts, the payer's signed authorization, the SHA-256 of the agent secret and what the watcher saw. Nothing
  that can approve on its own.
- Every approval is logged to `budget_spender_uses` before KMS is asked, by one database function
  (`budget_spender_use`) that in the same step checks the pause switch, the record's status and the limits below, so
  concurrent requests cannot slip past them. It runs only at READ COMMITTED (under REPEATABLE READ its counts would
  come from a stale snapshot, so it refuses) and refuses a missing limit. The log keeps what was signed: the approval message
  in hex, its expiry, the Budget's `created_slot`, the amount and payout account, and who asked (the agent, or the
  incident step). If the log write fails, the relay signs nothing. That holds for the relay's own path only: any code
  deployed to the project the KMS issuer is granted to could ask KMS directly, which is why the grant matters (below).
- Before it signs, the relay reads the cluster's genesis hash from its own RPC and refuses (`wrong_cluster`, operator
  told) when it is not the record's network. The slot for the expiry comes from that RPC too, never from the caller.
- Limits, each over the last ten minutes, counting every approval the agent asked for, its closes included:
  - `BUDGET_SPENDER_MAX_USES_PER_10_MIN` (default 30) for one Budget. Past it the Budget is frozen and the operator
    told. This bounds a stolen agent secret.
  - `BUDGET_SPENDER_MAX_PER_PAYER_PER_10_MIN` (default 60) for all of one payer's Budgets. Past it that payer is
    refused until the count drops, and the operator told.
  - `BUDGET_SPENDER_MAX_GLOBAL_PER_10_MIN` (default 300) for all relay Budgets on one network (devnet and mainnet
    count apart). Past it every request is refused until the count drops; the operator is told once per ten minutes.
    It does not pause, so requests alone cannot stop every relay Budget for longer than the window; to pause, the
    operator uses the switch below. With the per-payer limit, reaching it takes at least five payers with open relay
    Budgets.
  These bound what the relay's own approval path can sign. They do not bound a compromised deployment: code running
  in the project the KMS issuer is granted to can ask KMS directly, without the log or the limits (see the grant
  below).
- The incident step's close is the only approval not counted and not paused. It is logged (`by_operator`) like the
  rest.
- `BUDGET_SPENDING_PAUSED` (any value but empty, `false`, `0`, `no` or `off`), or the switch in `budget_controls`,
  stops every approval the agent asks for, its closes included. The incident step's close is still approved, so it
  works while paused. A pause does not
  revoke an approval already given; it expires within about a minute. Removing the KMS project grant stops all
  signing at once.
- There is no nonce: replay is stopped by the Budget's state (a reserve must raise the slice, a waive or close happens
  once) and the short expiry.

### Who may ask for an approval

- A record is made only on the payer's own Ed25519 signature over a plain-text authorization that starts
  "Reddi Agent Protocol: let the RAP relay spend from my Budget" and names the network, the payer, the Budget address, the providers
  (one to four), the most one reserve may hold (`max reserve`, in the Budget mint's base units: lamports for SOL, the
  token's smallest unit otherwise), the alert contact and when it was signed. It must be under ten minutes old. The
  alert email and webhook may hold no control, format, line-separator or private-use characters, so they cannot add a
  line to the text the wallet shows. The Budget address must be the payer's own PDA for the nonce given (`["budget", payer, nonce]`), so nobody can
  make a record for a Budget the payer did not sign for, and the record is pinned to that one Budget: a second record
  for it is refused (`budget_taken`).
- Making the record returns an agent secret (`rap_budget_…`) once. The relay keeps only its SHA-256. Every reserve and
  waive needs it; the incident step may only close.
- The record turns open only within an hour of the payer's signature (after that the payer signs again with a new
  nonce), read through the relay's own RPC after its genesis hash shows it serves the record's network, and only when
  the Budget on chain names the payer, the KMS spender with flag `0x08`, and an
  allowlist equal to the providers signed for. A relay Budget therefore always has an allowlist, and the program
  itself refuses a slice for anyone else.
- A reserve is approved only for a provider on that list and only up to the signed maximum.
- A waive is approved only for a slice of this opening that has posted and is not waived, for exactly its posted
  amount, and expires 50 slots ahead (about 20 seconds) instead of 150.
- The routes that will call `createSpender`, `activateSpender` and `approveAsSpender` do not exist yet. They must take
  the program id and the RPC from the server's configuration, never from the request, and need a review when written.
- Residual: whoever first submits a payer's signed authorization gets the agent secret. That holder can still only
  reserve for the payer's own providers, up to the payer's maximum, within the limits above, and the payer is alerted
  of every slice. The payer's app should submit the authorization itself, straight after signing.

No record is made unless the payer gave a contact (email or an https webhook) that this server can actually reach, and an
operator channel is set. A payer webhook gets a secret at key creation; every webhook alert carries
`x-rap-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` (operator webhooks use
`BUDGET_OPS_WEBHOOK_SECRET`, which is required with `BUDGET_OPS_WEBHOOK`: without it no record is made and the operator
webhook counts as not set up, never sent unsigned). Receivers should check it and refuse a `t` older than five minutes.

## What the payer is told

`/api/cron/budget-watch` runs every five minutes (`.github/workflows/budget-watch.yml`). For each Budget it compares the
slices on chain with what it saw last time and tells the payer about every new or raised slice, every post or re-post
(with the amount, the dispute deadline and a Solana Pay link that builds the dispute for their wallet), every dispute and
every payout or settled slice. A slice for a provider the payer did not name also alerts the operator, because the relay
never approves one: treat that as a compromised relay or KMS access and run the incident step.

- A slice's alert counts as sent only when a payer channel took it; otherwise it is sent again every pass, and after
  three passes the operator is told (counted as told only once a channel took it).
- Every operator alert no channel took, wherever it was raised (a freeze, the ceiling, a refused approval, a stalled
  or wrong-cluster watcher, a frozen Budget found open), is kept in `budget_controls.operator_pending` (one of each,
  the newest 50) and sent again at the end of every pass. Until they all go through, the pass counts as failed.
- Budgets are watched several at once, least recently watched first, each alert channel with a 5 second timeout, so one
  payer's slow webhook cannot hold up the rest. There is no row cap.
- The route answers 503 when any Budget could not be watched or the pass ran out of time, so the workflow run fails.
  The workflow also fails when its secret is missing, and logs only counts.
- A Budget's record is marked closed only on proof the Budget is over: reopened under a new `created_slot`, or its account
  missing at the finalized commitment on two passes at least four minutes apart. An unreadable account only alerts.
  When more than one record is closed that way in one pass, the operator is told, in case the RPC is misreading.
- The watcher checks its RPC's genesis hash first. Records of another cluster are not watched at all (nothing is closed
  through a wrong RPC) and the operator is told.
- A frozen record the relay never saw open is looked up at its pinned Budget address, so a Budget the payer opened
  anyway is watched and can be closed.
- A live record whose public key is not `BUDGET_SPENDER_P256_PUBLIC_KEY` (the KMS key was rotated, or the setting is
  missing) is a warning, not a failed pass: the operator is told at most once a day (counted only once delivered),
  because the relay cannot approve
  anything for it, the close included.
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
| `BUDGET_OPS_WEBHOOK_SECRET` | Vercel, required with `BUDGET_OPS_WEBHOOK` | Signs operator webhook alerts. |
| `CRON_SECRET` | Vercel | Bearer secret of `/api/cron/budget-watch`. The route refuses every call while it is unset. |
| `BUDGET_WATCH_CRON_SECRET` | GitHub repository secret | The same value as `CRON_SECRET`. The workflow skips while it is missing. |
| `BUDGET_INCIDENT_SECRET` | Vercel | Bearer secret of `/api/budget/v1/incident`. |
| `BUDGET_OPS_FEE_PAYER` | Vercel, Production only | JSON array of the 64 secret-key bytes of a fee key that holds only SOL for fees, never Budget money. |
| `BUDGET_SPENDER_MAX_USES_PER_10_MIN` | Vercel, optional | Overuse limit per Budget, default 30. |
| `BUDGET_SPENDER_MAX_PER_PAYER_PER_10_MIN` | Vercel, optional | Limit for all of one payer's Budgets, default 60. |
| `BUDGET_SPENDER_MAX_GLOBAL_PER_10_MIN` | Vercel, optional | Ceiling across all relay Budgets on one network, default 300; past it approvals are refused until the count drops. |
| `BUDGET_LINK_ORIGIN` | Vercel, optional | Origin of dispute links, default the production app. |

Grant the issuer to Production only, never Preview: any deployment it is granted to can approve for every relay
Budget. Audit round 5 (R5-M2) asks for the issuer to be granted to a small project that does nothing but sign, with
one issuer per cluster, so that the large app project and its dependencies cannot ask KMS at all; that move waits on
an owner decision. Until then the app's production deployment holds the grant. The limits above bound only what the
relay's own path approves, not what a compromised deployment could ask KMS for, and Vercel's KMS audit log is the record to compare against `budget_spender_uses` (any signature
there without a logged use means something other than the relay path asked). `BUDGET_SPENDER_KEKS` is no longer read; delete it from Vercel and 1Password once this is deployed.

Apply `supabase/migrations/20261125090000_budget_custody.sql`, `20261125100000_budget_custody_hardening.sql`,
`20261125110000_budget_custody_kms.sql`, `20261125120000_budget_custody_round5.sql` and
`20261125130000_budget_custody_round5b.sql`, in that order, before the first Budget record is made. The KMS one drops
the sealed-key columns and fails if any record exists, so a record from the earlier design is never silently kept
without a key. `supabase/tests/10_access_rules.sql` runs against all of them in CI (`supabase-access-rules.yml`).

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
   `BUDGET_OPS_FEE_PAYER`, and logged as the incident's. It closes nothing through an RPC on the wrong cluster. A
   close stops new slices and returns what was never reserved to the payer. Slices already
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
