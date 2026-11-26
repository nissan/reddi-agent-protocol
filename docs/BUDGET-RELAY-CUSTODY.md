# Budget spending by the relay: the spender key in Vercel KMS

Audit round 4 (S7-claude-03, -06) asked for the pooled Budget's off-chain pieces before a Budget is offered to anyone;
audit rounds 5 and 5b (on 3102743 and 5b062a9) tightened who may ask for an approval and what one may allow.
This file says what they are, how to set them up and what to do in an incident. Code: `lib/budget/`,
`lib/jobs/budget-call.ts`, `app/api/budget/v1/`, `app/api/cron/budget-watch/`, and the Budget signer project
`apps/budget-signer/` (below).

## The Budget signer project

Only one small Vercel project, `rap-budget-signer` (`apps/budget-signer/`), is granted the KMS issuer (audit round 5,
R5-M2; owner decision, 25 November 2026). The main app holds no KMS grant and cannot sign: it names the key new
Budgets use (`BUDGET_SPENDER_P256_PUBLIC_KEY`), makes and activates records, runs the watcher, and asks the signer for
each approval (`lib/budget/signer-client.ts`). Its own `approveAsSpender` refuses (`signer_elsewhere`) before logging
anything.

The signer runs every check of `approveAsSpender` itself (`lib/budget/signer-service.ts`), against the custody store,
with its own RPC and program id from its own environment:

- `POST /api/v1/approve` answers only the main app (`BUDGET_SIGNER_TOKEN`), and only for an agent: the body carries
  the record id, the agent secret and the request, and there is no field that asks for the operator path. It returns
  the secp256r1 approval and the Budget call, which the main app checks are the precompile and a call to our own
  program for the purpose it asked before using them.
- `POST /api/v1/incident` is the operator's incident step (`BUDGET_INCIDENT_SECRET`, below). It runs in the signer,
  so the incident close never passes through the main app. It also lifts holds: `resume` ends a pause of every
  Budget and `unfreeze` (with the record `id`) ends a freeze of one. Nothing else can lift them.
- `GET /api/v1/health` says which network, program and spender key the signer serves. No secret.
- One signer serves one network (`BUDGET_SIGNER_NETWORK`, devnet only for now) with its own issuer, and refuses a
  record on another network (`wrong_cluster`) before logging or signing. Mainnet Budgets get a second signer
  deployment with their own issuer when they open.

A compromised main app can still misuse the agent secrets passing through it, and its database key, within the
payer-signed limits (the payer's providers, up to the payer's maximum, within the counted limits). It cannot have KMS
sign outside the signer's checks, the log and the limits.

### What the app can write does not make the signer sign (audit 2026-11-25, RT-M2)

The main app can write the records table, so the signer trusts nothing in a record that the payer did not sign:

- The agent secret is made when the page prepares the Budget, and its SHA-256 is one line of what the payer's wallet
  signs (`agent key hash: …`). A record whose hash the app swapped for one of its own fails the next check.
- Before every approval, every call signature and every incident close, the signer verifies the payer's Ed25519
  signature again over the record's network, payer, Budget, providers, max reserve, contact, time, terms and agent key
  hash, and checks the record's mint is the signed one (`recordAuthorizationProblem`). On any mismatch it refuses
  (`record_untrusted`), signs nothing and tells the operator. The limits it applies are the signed ones. The
  incident close refuses such a record too; its payer can always close the Budget from their own wallet.
- Holds live in the signer's own log, `budget_signer_holds` (`lib/budget/holds.ts`): insert and select only, ids and
  times set by the database, no update or delete even for the table owner. Anyone with the store may add a hold (a
  pause of every Budget, or a freeze of one record). A release counts only with a MAC keyed from
  `BUDGET_INCIDENT_SECRET`, which only the signer holds, over its place in the log, so a release copied later does
  not count. The app can ask for a pause but cannot lift one; writing `budget_controls.paused` or a record's status
  does not lift a hold. A frozen record still lets its agent close the Budget (that only refunds the payer); a pause
  stops that too. If the log cannot be read, the signer signs nothing. The signer reads at most 1,000 rows for a
  record (all-Budget rows plus its own, within the Supabase API's default row cap) and checks the exact count the
  API reports; since anyone with the store key can add rows, a longer log, or an answer shorter than its count,
  means it cannot know it saw every hold, so it signs nothing at all and tells the operator (treat that as a
  compromised app). A
  freeze retries its hold three times and tells the operator if it still could not be written.
- Not signed by the payer, so not re-checked: the record's status and `createdSlot`. A rewrite of either only yields
  approvals or call signatures the program or the provider then refuses (they name another Budget instance or one
  that is not open), never a payment. The use log keeps the SHA-256 of `call <body hash>` for a call, not of the
  signed message, since the number is assigned in the same step that logs it; the number is in the row's detail.
- Call numbers come from the append-only use log (`budget_spender_call`), counted per record and provider under the
  record's row lock, so a number is handed out once whatever the app writes to the record. The app can still add
  rows to that log and so push a counter up, which only stops that Budget's calls (the payer closes it).

## What the relay holds

A pooled Budget names a spender that may reserve slices for providers, waive, and close. When the Reddi Agent Protocol
(RAP) relay spends for a payer, the spender is a P-256 key in Vercel KMS (owner decision, 24 November 2026), and the
relay holds no spender key material at all (the main app does hold the devnet sandbox providers' own wallets, below):

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
  incident step). If the log write fails, the relay signs nothing. That holds for the signer's path only: any code
  deployed to the project the KMS issuer is granted to could ask KMS directly, which is why only the small signer
  project holds the grant (above).
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
  These bound what the signer's approval path can sign. They do not bound a compromised signer deployment: code
  running in the project the KMS issuer is granted to can ask KMS directly, without the log or the limits. That is
  the signer project alone, which has no pages and few routes.
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
  nonce). A Budget opened on chain but not activated within that hour gets no relay approvals: it stays locked until
  its own expiry, and the payer recovers it then by closing it from their wallet, not the relay. Activation reads the Budget through the relay's own RPC after its genesis hash shows it serves the record's network, and opens the record only when
  the Budget on chain names the payer, the KMS spender with flag `0x08`, and an
  allowlist equal to the providers signed for. A relay Budget therefore always has an allowlist, and the program
  itself refuses a slice for anyone else.
- A reserve is approved only for a provider on that list and only up to the signed maximum.
- A waive is approved only for a slice of this opening that has posted and is not waived, for exactly its posted
  amount, and expires 50 slots ahead (about 20 seconds) instead of 150.
- The main app's Budget page routes (`app/api/budget/v1/`: `prepare`, `start`, `activate`, `status`, `action`,
  `dispute`) call `createSpender` and `activateSpender`; they take the program id and the RPC from the server's
  configuration, never from the request, and refuse (`not_devnet`) when the RPC is not devnet. The payer's wallet
  signs the Budget's terms too (site, program, token, total, per-provider maximum, judge, windows, whether the agent
  may approve posted totals), and activation refuses (`terms_mismatch`) a Budget whose on-chain terms differ. The
  page checks each transaction the server builds before the wallet signs it (`lib/budget/tx-check.ts`). Pending
  records older than an hour can never activate: the watcher closes up to 200 a pass ("never activated"), and the
  incident step handles real Budgets first and skips them. Relay Budgets still need a review before mainnet. The operator path cannot be asked for through the signer's approve route
  (it only takes an agent secret); `{ operator: "incident" }` is set only by the signer's incident route, behind
  `BUDGET_INCIDENT_SECRET`.
- Residual (availability only): the ceiling counts approvals when they are asked for, not when they land, so a few
  payer wallets at the per-payer limit can have other payers' approvals refused for up to ten minutes. Counting on
  landing would remove it.
- Residual: whoever first submits a payer's signed authorization gets the agent secret. That holder can still only
  reserve for the payer's own providers, up to the payer's maximum, within the limits above, and the payer is alerted
  of every slice. The payer's app should submit the authorization itself, straight after signing.

No record is made unless the payer gave a contact (email or an https webhook) that this server can actually reach, and an
operator channel is set. A payer webhook gets a secret at key creation; every webhook alert carries
`x-rap-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` (operator webhooks use
`BUDGET_OPS_WEBHOOK_SECRET`, which is required with `BUDGET_OPS_WEBHOOK`: without it no record is made and the operator
webhook counts as not set up, never sent unsigned). Receivers should check it and refuse a `t` older than five minutes.

## What the payer is told

On mainnet the payer's alert address is confirmed before a Budget can open (`lib/budget/email-confirm.ts`, #1208). The
page asks `POST /api/budget/v1/confirm-email` to email a link; the link carries a proof (an HMAC of the network, the
wallet, the address and a 30-day expiry) in its fragment, the page keeps it in the browser, and prepare and start refuse
a Budget whose address has no valid proof (`409 email_unconfirmed`). Nothing is stored on the server. Limits: the proof
shows that someone with the link's inbox opened it for that wallet, not that later alerts keep arriving, and the
one-email-a-minute hold per address is per server instance, next to the per-client rate limit.

`/api/cron/budget-watch` runs every five minutes (`.github/workflows/budget-watch.yml`). For each Budget it compares the
slices on chain with what it saw last time and tells the payer about every new or raised slice, every post or re-post
(with the amount, the dispute deadline and a Solana Pay link that builds the dispute for their wallet), every dispute and
every payout or settled slice. A slice for a provider the payer did not name also alerts the operator, because the relay
never approves one: treat that as a compromised relay or KMS access and run the incident step.

- The sandbox payout sweep (`/api/cron/sandbox-budgets`) answers 503 when a slice could not be settled and sends the
  operator a `payout_sweep_failed` alert naming each slice (provider and Budget) and the reason, at most hourly for the
  same slices (`lib/budget/sweep-alert.ts`). RAP's own providers alert on a failed sweep from their own project.
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

Values go in 1Password first, then Vercel or GitHub. Never in the repository. Two Vercel projects are involved: the
main app (`reddi-agent-protocol`) and the signer (`rap-budget-signer`, root directory `apps/budget-signer`; its
`vercel.json` installs from the repository root).

1. Create a KMS issuer with algorithm `ES256` per network (Vercel dashboard, or the Vercel connector), and grant it
   to the signer project only, for Production only: `vercel kms add-grant <issuer> --project rap-budget-signer
   --environment production`. Never grant it to the main app. Vercel marks KMS as beta.
2. Set `BUDGET_SPENDER_P256_PUBLIC_KEY` to the active signing key's `publicKeyPem` as the issuer shows it (or the
   point in hex or base64: 33-byte compressed or 65-byte uncompressed), in both projects.
3. Make a random `BUDGET_SIGNER_TOKEN` and set it in both projects; set `BUDGET_SIGNER_URL` in the main app to the
   signer's production origin.

The "Where" column says which project: **app** is `reddi-agent-protocol`, **signer** is `rap-budget-signer`.

| Name | Where | What |
| --- | --- | --- |
| `BUDGET_SPENDER_KMS_ISSUER_ID` | signer, Production only | The KMS issuer whose ES256 key approves. Never in the app. |
| `BUDGET_SPENDER_P256_PUBLIC_KEY` | app and signer, Production only | Its public key (above). New Budgets name it; every KMS signature is checked against the Budget's own key. |
| `BUDGET_SIGNER_TOKEN` | app and signer, Production only | Bearer secret the app sends to the signer's `/api/v1/approve`. |
| `BUDGET_SIGNER_URL` | app, Production only | The signer's https origin, nothing after it. |
| `BUDGET_SIGNER_NETWORK` | signer, optional | `solana-devnet` (default, and the only one served yet). |
| `BUDGET_SIGNER_RPC_URL` | signer, optional | The signer's own devnet RPC, default the public one. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | app and signer | The custody store. |
| `RESEND_API_KEY`, `BUDGET_ALERT_FROM` | app and signer | Alert email sender (for example `RAP Budgets <alerts@reddi.tech>`). |
| `BUDGET_EMAIL_CONFIRM_SECRET` | app | At least 32 random characters. Signs the proof in the alert-address confirmation link. Required on mainnet; without it new Budgets are refused (`email_confirm_not_configured`). |
| `BUDGET_REQUIRE_CONFIRMED_EMAIL` | app, optional | `true` asks for a confirmed alert address on devnet too (mainnet always asks). |
| `BUDGET_OPS_EMAIL`, `BUDGET_OPS_WEBHOOK` | app and signer | Where operator alerts go. Set at least one. |
| `BUDGET_OPS_WEBHOOK_SECRET` | app and signer, required with `BUDGET_OPS_WEBHOOK` | Signs operator webhook alerts. |
| `CRON_SECRET` | app | Bearer secret of `/api/cron/budget-watch`. The route refuses every call while it is unset. |
| `BUDGET_WATCH_CRON_SECRET` | GitHub repository secret | The same value as `CRON_SECRET`. The workflow skips while it is missing. |
| `BUDGET_INCIDENT_SECRET` | signer | Bearer secret of the signer's `/api/v1/incident`. Delete it from the app. It must differ from `BUDGET_SIGNER_TOKEN` (the app holds that one): the route refuses every call while they match. |
| `BUDGET_OPS_FEE_PAYER` | signer, Production only | JSON array of the 64 secret-key bytes of a fee key that holds only SOL for fees, never Budget money. Delete it from the app. |
| `BUDGET_SPENDING_PAUSED` | signer | The pause switch read at approval time (above). |
| `BUDGET_SPENDER_MAX_USES_PER_10_MIN` | signer, optional | Overuse limit per Budget, default 30. |
| `BUDGET_SPENDER_MAX_PER_PAYER_PER_10_MIN` | signer, optional | Limit for all of one payer's Budgets, default 60. |
| `BUDGET_SPENDER_MAX_GLOBAL_PER_10_MIN` | signer, optional | Ceiling across all relay Budgets on one network, default 300; past it approvals are refused until the count drops. |
| `BUDGET_LINK_ORIGIN` | app, optional | Origin of dispute links, default the production app. |
| `BUDGET_CALLS_MAX_PER_10_MIN`, `BUDGET_CALLS_MAX_PER_PAYER_PER_10_MIN`, `BUDGET_CALLS_MAX_GLOBAL_PER_10_MIN` | signer, optional | Limits on paid-call signatures, counted apart from approvals: per Budget (default 300; past it the Budget is frozen), per payer (600) and across all Budgets (6,000). The operator is alerted when a payer hits its limit, when the ceiling is first hit (its own alert marker, apart from the approval ceiling's), and when KMS fails to sign. |
| `BUDGET_USDC_PROVIDERS` | app, optional | JSON array of RAP's own USDC providers a Budget can name: `{ id, name, tagline?, model?, url, payee, inputPerMillionUsd, outputPerMillionUsd }`, `url` the provider's https chat endpoint. Empty: Budgets hold SOL only. |

Grant the issuer to the signer's Production only, never Preview and never the main app: any deployment it is granted
to can approve for every relay Budget. The limits above bound only what the signer's path approves, not what a
compromised signer deployment could ask KMS for, and Vercel's KMS audit log is the record to compare against
`budget_spender_uses` (any signature there without a logged use means something other than the signer's path
asked). `BUDGET_SPENDER_KEKS` is no longer read; delete it from Vercel and 1Password once this is deployed.

Apply `supabase/migrations/20261125090000_budget_custody.sql`, `20261125100000_budget_custody_hardening.sql`,
`20261125110000_budget_custody_kms.sql`, `20261125120000_budget_custody_round5.sql`,
`20261125130000_budget_custody_round5b.sql`, `20261125140000_budget_custody_calls.sql` (paid calls in the use log) and
`20261125150000_sandbox_budget_slices.sql` (the sandbox providers' Budget ledger), in that order, before the first Budget record is made. The KMS one drops
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
   curl -X POST "$BUDGET_SIGNER_URL/api/v1/incident" \
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
   the same on purpose. If the pause switch itself cannot be written, set `BUDGET_SPENDING_PAUSED=true` on the signer
   project and redeploy it. To end a pause once it is safe, send `{"action":"resume","reason":"..."}`; to lift the
   freeze of one record, `{"action":"unfreeze","id":"<record id>","reason":"..."}`. Only this route can.
3. If the signer itself may be compromised, remove the KMS issuer's grant to it (or revoke its key) once the closes
   are done: from then on nothing, the relay included, can approve for any relay Budget, and open ones end with their
   payers.
4. Read the operator summary. Close any Budget listed as `FAILED` by hand.

## Agent calls through the relay

An agent spends a Budget with its key (`<agentSecret>.<recordId>`, shown once on `/budget`) at
`POST /api/budget/v1/chat/completions`, `Authorization: Bearer <key>`, an OpenAI-style body whose `model` names one of
the providers the payer picked, in the Budget's token (`lib/budget/providers.ts`). The relay (`lib/budget/relay.ts`):

1. checks the key against the record (the signer checks it again) and that the record is open;
2. has the signer sign the call (`/api/v1/sign-call`, `budgetRequestMessage`: Budget instance, provider, call number,
   body hash) and checks the answer is the Budget's spender over exactly that call. The signer gives the call the next
   number of its own counter per Budget and provider (`calls` on the record), taken before KMS is asked, so no number
   is signed twice; a call that fails leaves a gap, and providers take any number above the last one they served. The
   sign-call route signs paid calls only (no read or close, no number named by the caller);
3. sends it to the provider; on a 402 Budget offer it checks the offer (this program and cluster, this payee, the
   Budget's token, the provider's own payout account), has the signer approve a reserve of at most the payer's
   per-provider maximum, and sends the same call again with the reserve, which the provider signs and pays for. No
   approval while the provider's slice on chain is already at that maximum or within 60 s of the last one; each raise
   is at least a quarter of the maximum; after three approvals in a row the provider left unused, none more for it
   in this Budget (`reserves` on the record);
4. stops within 260 s in all (the route allows 300 s), and passes on at most 1 MB of the provider's answer.

The spender key is in KMS, but the main app is not without keys that move money: SOL Budgets pay the devnet sandbox
providers, served by the app's own gateway
(`lib/sandbox/budget-desk.ts`): they register themselves on devnet before their first reserve (0.01 devnet SOL plus
rent each, from their `SANDBOX_DEVNET_PAYEE_KEYS` wallets), keep their ledger in `sandbox_budget_slices`, and post and
collect through `/api/cron/sandbox-budgets`, which the Budget watcher workflow calls after the watcher. So the app holds
those providers' payee wallets, their slice ledger and the cron that posts and pays them out. That is devnet test SOL
only; a mainnet version must run those providers apart from the relay. The sweep reads every page of slices, stops
within 240 s, and lets a slice go only when its Budget account is still missing five minutes later. USDC Budgets pay
RAP's own providers (provider kit) listed in `BUDGET_USDC_PROVIDERS`.

## Recording paid work

`verifyAndRecordBudgetCall` (`lib/jobs/budget-call.ts`) records a job only for a landed `payout_budget` or
`resolve_budget` (or the token forms) for that Budget's opening, this provider's reservation and this payer, using the
amounts of the program's own `BudgetPaid` event, and only with the provider's signed receipt v2 whose `budget` block names
the same Budget, opening and reservation and states at least what was charged. A payout that paid nothing records nothing.
