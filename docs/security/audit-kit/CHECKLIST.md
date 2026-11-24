# Security audit checklist

One section per surface. Each item is a question with a pass condition. The
auditor marks each item **Pass**, **Fail** (with a finding ID), **N/A** (with a
reason) or **Not verified** (with a reason), and copies the table into the
report. An item marked Not verified counts as a gap in the Go/No-go rubric.

Items marked **[gate]** are launch gates: the release is NO-GO until each one
passes, whatever the finding counts say.

## S1 On-chain program (`programs/pinocchio-escrow`, V1 default build)

### Build and deployment integrity
- [ ] **[gate]** S1.1 The default build has no `devnet`, `extended` or `per` feature, and the binary does not answer PER selectors.
- [ ] **[gate]** S1.2 The container build in `escrow-verifiable-build.yml` at the freeze commit is reproducible: two independent builds give the same sha256 and size.
- [ ] **[gate]** S1.3 The runbook reads the deployed program data back and compares its sha256 with the build of record.
- [ ] S1.4 `cargo build-sbf` keypair outputs are not committed and not reused as program keys.
- [ ] S1.5 Dependencies (`Cargo.lock`) are pinned, current stable, and have no known advisories (`cargo audit`).
- [ ] S1.6 The program id in source, configs and clients is `DcfW3Cxt…5Ucu` everywhere a V1 path reads it.

### Accounts and signers (every instruction)
- [ ] S1.7 Every account is checked for owner, writable flag, signer flag and expected address or PDA seeds before it is used.
- [ ] S1.8 Duplicate accounts are refused where two slots must differ (payer, payee, treasury, vault, refund, destination).
- [ ] S1.9 Token accounts are checked for mint, token program (classic or Token-2022), owner and state (initialised, not frozen where it matters).
- [ ] S1.10 PDAs use canonical bumps and seeds cannot collide across escrow types, ratings and attestations.
- [ ] S1.11 Closed accounts cannot be revived or re-used to replay an exit; lamports and data are cleared on close.
- [ ] S1.12 Records of the old size (149 bytes and other legacy sizes) are refused.

### Money paths
- [ ] S1.13 Lock: amount bounds and per-escrow caps hold; windows obey claim > 0, claim ≤ refund, refund ≤ maximum.
- [ ] S1.14 Release (payer), claim (payee after claim window), refund (payer after refund window) and settle (payee only, metered only) each require the right signer and slot.
- [ ] S1.15 At the exact boundary slot, the outcome is defined and documented when both parties act.
- [ ] S1.16 Fee: the rate in `consts.rs` for the payout time (2.5% launch rate before 2027-04-01 00:00 UTC by cluster clock, then 5%, owner decision 2026-11-22) of the amount paid, rounded down, from the provider's share, capped at 0.1 SOL on SOL only, using widening arithmetic, on every payout path; the lock rent check allows for the higher rate; off-chain fee mirrors (`packages/x402-solana`, `lib/jobs/`, `lib/payments/`) agree with the program on both sides of the cutoff.
- [ ] S1.17 The fee always goes to the treasury vault or its canonical token account; no caller-chosen fee destination.
- [ ] S1.18 Metered settle cannot exceed the locked maximum; the unused part always returns to the payer.
- [ ] S1.19 SOL payouts respect rent rules (payee rent check, treasury minimum); no lamport underflow.
- [ ] S1.20 Token-2022: transfer fee, transfer hook, permanent delegate, freeze and withheld fees are handled or documented; the harvest CPI cannot fail a payout that would otherwise succeed.
- [ ] S1.21 No path lets a third party move funds, and no path lets the payer take more than it deposited or the payee more than it is owed.

### Rating and attestation
- [ ] S1.22 A rating opens only with the seller's consent and is bound to one job (`opened_slot`); every exit, rated or not, names its escrow by `created_slot` and is refused for any other escrow at the same address.
- [ ] S1.23 Commit, reveal, expire and close always reach a final state; neither party can stall the other forever.
- [ ] S1.24 Attestations are bound to a real paid job and cannot be squatted by an unrelated judge.
- [ ] S1.25 A refused instruction never changes an agent's record.

### Delivery-checked escrow
- [ ] S1.29 Only `open_delivery` sets the delivery flag, only by the payer in the lock slot and only once; nothing clears it, and it works with `open_rating` in either order.
- [ ] S1.30 Every exit of a flagged escrow (release, settle, claim, cancel, refund, resolve; SOL and token) refuses a missing, foreign, fake or other-job delivery account.
- [ ] S1.31 `record_delivery` is refused at and after the refund window; accept, dispute and resolve each work only in their state and window, and exactly one of each racing pair is valid at the boundary slot.
- [ ] S1.32 A refund is eventually reachable in every delivery state, and the worst-case lock time stays within the documented ceiling.
- [ ] S1.33 The judge's split pays at most the locked amount, sends the payee's share only to the recorded recipient, takes the fee on the paid part, and handles Token-2022 issuer debit and transfer fees with measured amounts in the event.
- [ ] S1.34 SDK, provider kit, sandbox and specialists refuse delivery-checked escrows by default until they support them.

### Robustness
- [ ] S1.35 No panics, unchecked arithmetic or unbounded loops; compute use is within limits for the largest instruction.
- [ ] S1.36 Error codes and events match the README interface; clients can tell outcomes apart.
- [ ] S1.37 The equivalence suite and program tests pass at the commit, and cover each money path's negative cases.

## S2 Developer app, sandbox and API routes

### Authentication and authorisation
- [ ] S2.1 Every route under `app/api/` is listed with its auth requirement (none, wallet session, cron secret, operator key); none that changes state is open by accident.
- [ ] S2.2 The wallet session is checked server-side with the auth service; the wallet comes from the identity, never from the request body or `user_metadata`.
- [ ] S2.3 Object-level checks: a user can read and change only their own jobs, receipts, listings, planner runs and onboarding records.
- [ ] S2.4 `api/cron/*` and `api/manager/*` refuse without the secret, compare it in constant time, and do nothing when it is not configured.
- [ ] S2.5 Onboarding routes that touch keys (`operator-key`, `attestation-operator`, `wallet/recovery`, `settlement-config`) cannot leak, replace or use another user's key.

### Network and keys
- [ ] **[gate]** S2.6 A mainnet build cannot load devnet program ids, sandbox keys, the sandbox gateway, faucet or demo paths; runtime overrides are refused on mainnet.
- [ ] **[gate]** S2.7 No secret is in a `NEXT_PUBLIC_*` variable or in the client bundle (build the app and search the output for key patterns).
- [ ] S2.8 The sandbox signing keys (derived from a public label) are only accepted on devnet and are labelled as test keys wherever they appear.
- [ ] S2.9 `/api/rpc`: method allowlist, body and batch limits, origin check, timeout, no upstream URL or key in errors, and a rate limit in front of it.

### Input handling
- [ ] S2.10 SSRF: routes that fetch a user-supplied URL (endpoint probe, healthcheck, source adapters, discovery) block private, loopback, link-local and metadata addresses, follow no redirects to them, and limit size and time.
- [ ] S2.11 All input is validated with a schema; sizes are bounded; errors do not leak stack traces or internal URLs.
- [ ] S2.12 Output that renders provider-supplied text (names, models, descriptions) is escaped; no `dangerouslySetInnerHTML` on untrusted text.

### Transactions the user signs
- [ ] S2.13 Every transaction the app asks a wallet to sign is built server-independently or verified client-side: program id, accounts, amounts and recipients match what the user sees.
- [ ] S2.14 The maximum the buyer authorises is shown before signing and enforced by the lock.
- [ ] S2.15 Session delegations are short (24 hours or less), held in memory only, and bound to one provider.

### Web hardening
- [ ] S2.16 Security headers: CSP (no `unsafe-eval` in production), frame-ancestors, HSTS, referrer policy, `X-Content-Type-Options`.
- [ ] S2.17 Cookies (if any) are `Secure`, `HttpOnly` where possible, `SameSite`; state-changing routes resist CSRF.
- [ ] S2.18 `npm audit --omit=dev` on the root app has no High or Critical that is reachable.

## S3 Marketing site (`apps/marketing`)

- [ ] S3.1 `api/subscribe` validates email, rate-limits per IP and per address, and cannot be used to send mail to arbitrary people repeatedly (double opt-in).
- [ ] S3.2 Confirm and unsubscribe tokens are unguessable, single-purpose, and cannot be forged or replayed for another address.
- [ ] S3.3 Cron routes (`newsletter/prune`, `newsletter/issues`) refuse without the cron secret.
- [ ] S3.4 Email content cannot be injected (headers, HTML) from user input; the from and reply-to are fixed.
- [ ] S3.5 Analytics load only after consent where required; the privacy page matches what is collected and kept.
- [ ] S3.6 No open redirects; links to the app and sandbox go to the expected hosts.
- [ ] S3.7 Security headers as S2.16; no secrets in the client bundle.
- [ ] S3.8 `npm ci --ignore-scripts` is used in the build; `npm audit --omit=dev` has no reachable High or Critical.
- [ ] S3.9 Public copy stays inside `docs/PUBLIC-CLAIM-BOUNDARY.md` (no claim of audit completion, live fees or production readiness before they are true).

## S4 Provider kit, SDK packages and npm supply chain

### Payment verification
- [ ] **[gate]** S4.1 `SolanaReceiptVerifier` (or its successor) requires the payer proof by default; the opt-out serves nothing.
- [ ] S4.2 The proof binds network, transaction signature, payTo, amount, mint and the raw body hash; a proof cannot be moved to another provider, body or network.
- [ ] S4.3 The replay store is durable and atomic across instances (database), with a transaction age bound and a genesis-hash network check.
- [ ] S4.4 Amounts use integer base units end to end; no float math; decimals come from the mint.
- [ ] S4.5 Metered settle charges the computed cost, never above the buyer's maximum, and creates the treasury and payer token accounts idempotently.
- [ ] S4.6 Rated escrows are refused unless the operator opts in; providers check the refund time left before serving and fail closed.
- [ ] S4.7 The provider refuses a currency whose treasury account does not exist (`provider_not_ready`).

### Operator safety
- [ ] S4.8 The provider's own keys are loaded from a path or env var, never logged, and never written into receipts or errors.
- [ ] S4.9 The upstream model call cannot be redirected by the buyer (no buyer-controlled upstream URL); SSRF guards as S2.10.
- [ ] S4.10 Defaults are safe for a third party who changes nothing: mainnet requires explicit config, test keys refuse mainnet, logs have no secrets.
- [ ] S4.11 The Dockerfile runs as non-root, pins its base image, and copies no secrets.

### Supply chain
- [ ] **[gate]** S4.12 Every published package's `files` list (or `npm pack --dry-run`) contains no keys, `.env` files, test wallets or internal configs.
- [ ] S4.13 No `preinstall`/`postinstall` scripts in published packages; lockfiles committed and used in CI (`npm ci`).
- [ ] S4.14 The `@redditech` scope is owned by the project's npm account with 2FA required for publish; publishing uses provenance from CI or a documented manual process.
- [ ] S4.15 Dependency names cannot be confused with public look-alikes; internal package names are scoped.
- [ ] S4.16 `npm audit --omit=dev` per published package has no reachable High or Critical; dependencies are current stable.
- [ ] S4.17 Dependabot or an equivalent update and advisory process is set up for npm, Cargo and GitHub Actions.

## S5 Supabase database, RLS and wallet sign-in

- [ ] **[gate]** S5.1 RLS is enabled on every table in `public`, and the migration starts from no grants for `anon` and `authenticated`, then grants back the minimum.
- [ ] S5.2 Each policy matches the design: users read only their own profiles, jobs and receipts; public reads are limited to listed providers, attestations and stats; column grants hide private columns.
- [ ] S5.3 `security definer` functions set `search_path`, validate input, and are executable only by the roles that need them (`replay_check_and_store` by `service_role` only).
- [ ] S5.4 The replay check is atomic under concurrency (unique constraint or single statement), so two requests cannot both pass.
- [ ] S5.5 The service role key is used only in server code and only after the caller is authorised; no route lets a user steer a service-role query to another user's rows.
- [ ] S5.6 Wallet linking: one wallet links to one account; a user cannot link someone else's wallet; changing wallets needs a fresh signature.
- [ ] S5.7 Auth settings: sign-in message includes domain, nonce and expiry; sessions expire; email sign-up is off if not used.
- [ ] S5.8 The applied production schema matches the migrations (no hand-made drift); backups and point-in-time recovery are on.
- [ ] S5.9 Local access-rule tests cover each policy with a negative case.

## S6 Infrastructure, keys, custody and CI/CD

### Custody and authority
- [ ] **[gate]** S6.1 After deploy, the program upgrade authority read from chain is the Squads vault `5CsBuT…3Hxe`, not the multisig account or a hot key.
- [ ] **[gate]** S6.2 The treasury in program constants and in provider config is the same vault, and the vault holds at least 0.001 SOL and its token accounts for USDC, AUDD, PYUSD and USDG before the first lock.
- [ ] S6.3 The multisig is 2 of 3 with the expected members; members' keys are hardware or otherwise protected; there is no single member who can act alone.
- [ ] S6.4 The investments squad is not referenced anywhere in protocol code, config or runbooks.
- [ ] S6.5 There is a written plan for a lost or compromised member key, and for freezing upgrades (or making the program immutable) later.

### Keys and secrets
- [ ] **[gate]** S6.6 No secret in the repository or its history (run a secret scanner over the full history).
- [ ] S6.7 Deployer and program keypairs exist only in 1Password and on the owner's machine; the deployer holds no more SOL than the deploy needs and is emptied after.
- [ ] S6.8 Each server secret (RPC key, Supabase service role, Resend, `CRON_SECRET`) is scoped to the production environment only, not to previews, and has a rotation owner.
- [ ] S6.9 Agents and CI never receive custody keys; any agent permission to run key or deploy scripts is limited to named scripts.

### Vercel
- [ ] S6.10 Production env vars are not exposed to preview deployments of untrusted branches; deployment protection is on for previews.
- [ ] S6.11 Only the owner can promote to production and change env vars; team members and tokens are reviewed.
- [ ] S6.12 The firewall rate limit on `/api/rpc` and the auth routes is set; attack challenge mode can be turned on quickly.
- [ ] S6.13 The duplicate Vercel project has no production secrets and no domain.
- [ ] S6.14 Domains: DNS records reviewed; no dangling CNAMEs; HSTS on the production hosts.

### GitHub and CI/CD
- [ ] S6.15 Branch protection on `main`: required checks, no force pushes, signed or verified merges as the owner decides.
- [ ] S6.16 Workflows set least `permissions:`; none uses `pull_request_target` with a checkout of PR code; secrets are not available to fork PRs.
- [ ] S6.17 Third-party actions are pinned to a commit SHA.
- [ ] S6.18 The verifiable build workflow cannot be influenced by a PR to produce a different hash of record on `main`.
- [ ] S6.19 Logs do not print RPC URLs with keys or other secrets (scripts print host only).

### Operations
- [ ] S6.20 Monitoring: mint posture watch, uptime checks, and an alert owner for each; alerts reach a person.
- [ ] S6.21 There is a stop switch per currency and for the provider kit, and an incident runbook (who, how, in what order).
- [ ] S6.22 The launch runbook's every step that signs, deploys or spends names the owner as the actor.

## S7 End-to-end payment and economic flows

- [ ] **[gate]** S7.1 A buyer cannot get a paid response without a valid, unused, signed payment or lock for that provider, body and network.
- [ ] S7.2 A buyer cannot be served twice for one payment, across instances, providers or networks.
- [ ] S7.3 A provider cannot take more than the actual cost or the authorised maximum, whichever is lower, as far as the protocol can check; the rest returns to the buyer.
- [ ] S7.4 The fee lands in the treasury on every payout path (direct payment where it applies, settle, release, claim) and the receipt shows it.
- [ ] S7.5 A third party cannot front-run a buyer's payment proof, a provider's settle, or a refund.
- [ ] S7.6 The refund path stays available to the buyer when the provider disappears; the claim path stays available to the provider when the buyer disappears.
- [ ] S7.7 Receipts (`reddi.receipt.v2`) are bound to the transaction and the job and cannot be reused for another job.
- [ ] S7.8 Ratings and attestations can only come from parties to a paid job, once per job.
- [ ] S7.9 The full devnet e2e (`scripts/devnet-escrow-e2e.cjs` lanes) passes at the release commit, including negative cases; the run log is kept.
- [ ] S7.10 Every currency (SOL, USDC, AUDD, PYUSD, USDG) is exercised through lock, settle and refund at least once on devnet or a local validator with mainnet-like mint settings.
