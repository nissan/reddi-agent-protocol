# Incident runbook (V1 mainnet)

Status: **draft for owner approval** (audit condition C15). Contacts are kept
privately by the owner, not in this file. The custody rules this runbook relies
on are in [CUSTODY-POLICY.md](CUSTODY-POLICY.md).

## 0. First five minutes

1. **Stop new money** (section 2). It is always safe: it never blocks a refund,
   a cancel or the settle of an escrow that is already locked.
2. Open a private record: a GitHub security advisory draft (Security, Advisories)
   or a private note. Write the time (UTC), what was seen, and who is acting.
3. Decide the severity (section 1) and follow its playbook (section 3).
4. Do not post details in public issues, pull requests, chats or social media
   until the fix is out (`SECURITY.md`, Responsible Disclosure).

## 1. Severity

| Level | Examples | Target response |
|---|---|---|
| SEV1 | Funds moving that should not; a program upgrade nobody approved; a multisig member or provider key in someone else's hands; a mint gains a transfer hook or fee | Stop switches within 15 minutes; owner on it now |
| SEV2 | Payments failing for everyone (RPC down, treasury account closed, app broken); a leaked credential with no funds at stake | Within 1 hour |
| SEV3 | One provider failing, slow pages, a monitor that flaps | Next working day |

## 2. Stop switches

The escrow program has no pause. Locked funds can always be refunded by the
buyer once the escrow's refund window opens, and settled by the provider before
then. Stopping new money is done off-chain, at three places:

| Where | Switch | Effect | Time to apply |
|---|---|---|---|
| App (planner and wallet pages) | `RAP_STOP_NEW_PAYMENTS=true`, or `RAP_PAUSED_CURRENCIES=PYUSD,USDG` (any of SOL, USDC, AUDD, PYUSD, USDG), set on the app's Vercel project (Production), then redeploy the current deployment | The app no longer asks a wallet to sign a new payment or lock in that currency; `GET /api/payments/status` shows the state. An unknown value stops everything. | About 2 minutes |
| First-party providers (provider kit) | `RAP_PROVIDER_PAUSED_CURRENCIES=<symbols>` on the providers' Vercel project, then redeploy; list every currency to stop them all | Providers refuse new paid calls in those currencies (`currency_paused`) and report `acceptingPayments: false`, so the listing health check marks them failing | About 2 minutes |
| Listings | Pause the listing (status `paused`) or rerun `rap-provider register` | The planner stops offering it | Minutes |

Third-party providers run their own copy of the kit. Tell them through the
operator contact list (kept privately) to set `RAP_PROVIDER_PAUSED_CURRENCIES`.

To reopen: remove the variable, redeploy, check `GET /api/payments/status`
reports `stopAll: false` with no paused currencies, and make one small paid
call per reopened currency.

**Test before launch and every quarter:** on a preview deployment, set each
switch, confirm the planner refuses with "Nothing was signed", and that a provider
answers `currency_paused`; then clear it. Record the date on #736.

## 3. Playbooks

### 3.1 Program upgrade nobody approved, or upgrade authority changed

Signs: `scripts/check-escrow-deployment.mjs` fails on the executable hash or the
authority; a Squads proposal nobody recognises.

1. Stop new money everywhere (section 2).
2. Read the program: `node scripts/check-escrow-deployment.mjs --record
   config/releases/<record>.json` against two RPCs.
3. If the authority is still the vault: reject any pending proposal, then
   prepare an upgrade back to the binary of record (2 of 3), after checking its
   hash against the release record.
4. If the authority moved: treat as a member-key compromise (3.2). Tell buyers to
   refund open escrows once their windows open; plan a redeploy under a new
   program id; never point the app back at the old id.

### 3.2 Multisig member key lost or compromised

Follow `CUSTODY-POLICY.md` section 4. Stop new money first if there is any doubt
the attacker holds two keys.

### 3.3 Provider wallet key leaked (first-party provider)

The key can settle that provider's open escrows (to its own payee account) and
spend its float. It cannot touch the treasury or other providers.

1. Pause that provider (section 2) and remove its keypair variable.
2. Sweep what the old wallet still holds to the operating vault (owner signs).
3. Make a new wallet, list it, and point the provider at it. Open escrows naming
   the old wallet are settled from the old key or refunded by buyers when their
   windows open.

### 3.4 Token-2022 mint changes (PYUSD, USDG)

Signs: the daily `Token-2022 mint watch` workflow opens a `mint-watch` issue;
`node scripts/check-token2022-mint-posture.mjs` fails.

1. Pause that currency in the app and on providers (section 2).
2. Follow "If the posture changes" in `docs/ESCROW-PAYOUT-SAFETY.md`: read what
   changed (hook program, fee, delegate, freeze or pause authority) and decide
   whether open escrows in that mint can still settle or refund.
3. Reopen only after the recorded posture is updated by a reviewed pull request.

### 3.5 RPC outage (Helius)

Signs: `scripts/app-live-check.mjs` or the uptime workflow fails on `/api/rpc`;
providers log `payment_check_unavailable`.

1. Nothing is charged while the RPC is down: providers refuse to accept a lock
   they cannot read, and the settle sweep retries pending settles later.
2. If it lasts over 15 minutes, set `SOLANA_RPC_URL` to the fallback provider
   (kept privately) and redeploy; never point it at a URL from an incident
   report or a message.
3. After recovery, check the providers' pending settles have cleared (the
   `/api/sweep` run reports `swept` for each provider), and that no buyer was charged for a call it did not get.

### 3.6 Treasury cannot receive (empty vault, closed token account)

Signs: `scripts/check-escrow-treasury.mjs --network mainnet` fails; paid exits
in one currency fail.

1. Pause that currency (section 2).
2. Fund the vault or recreate the token account (anyone can pay). Rerun the
   check until it passes, then reopen.

### 3.7 Leaked service credential

Revoke and rotate it at the provider first, then update the sensitive variable
and redeploy, then look for use in the provider's logs. Record which credential
and when (not its value) on the private record. See `CUSTODY-POLICY.md` §5.

### 3.8 App or provider code vulnerability reported

Acknowledge through private vulnerability reporting, stop new money if funds can
be at risk, fix on a private fork or a pull request with neutral text, ship, then
publish the advisory.

## 4. Monitoring and who is alerted

| Monitor | Schedule | Alert goes to |
|---|---|---|
| Token-2022 mint watch (`token2022-mint-watch.yml`) | Daily | Issue assigned to the repository owner |
| Marketing and app uptime (`marketing-uptime.yml`, `app-live-check.mjs`) | Hourly | Issue and email to the owner |
| Treasury check (`check-escrow-treasury.mjs --network mainnet`) | To be scheduled after deploy (launch runbook §6) | Owner |
| Program deployment check (`check-escrow-deployment.mjs`; weekly by `escrow-deployment-watch.yml` against its `MAINNET_RECORD`) | At every release; weekly (Monday 22:23 UTC) once the record has a `deployedSlot` | `deployment-watch` issue assigned to the repository owner; verdict lines only, RPC URL scrubbed |
| Providers' `alert: true` log events (sweep failures, answers not held, cluster check) | Continuous: Vercel logs, plus an email per event (`apps/providers/lib/alerts.ts`), at most one per event name per 15 minutes per instance | Owner by email, once `PROVIDER_ALERT_RESEND_API_KEY`, `PROVIDER_ALERT_EMAIL_TO` and `PROVIDER_ALERT_EMAIL_FROM` are set in the providers project |

## 5. After an incident

Within a week: a short private review (timeline, cause, what stopped it, what
changes), the fixes as pull requests, and a public note if users were affected.
Update this runbook if a step was missing or wrong.
