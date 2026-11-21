# Threat model

What we protect, from whom, and the attacks each surface review must try. Use
it to aim the review, not to limit it: report anything you find outside it.

## Assets, in order of harm

1. **Funds in escrow and in flight**: SOL and tokens locked by buyers, payouts
   to providers, refunds.
2. **Program upgrade authority and the treasury**: the Squads vault. Losing it
   means losing every future fee and the ability to replace the program.
3. **Keys**: deployer and program keypairs, provider signing keys, operator and
   attestation keys, server keys (RPC, Supabase service role, Resend,
   `CRON_SECRET`), npm publish credentials, Vercel and GitHub tokens.
4. **Correct accounting**: fee amounts, metered settle amounts, receipts, replay
   records. A wrong amount is a loss even without theft.
5. **Integrity of reputation**: ratings, attestations, provider stats, listings.
6. **User data**: wallet-to-account links, emails on the newsletter list,
   analytics events.
7. **Availability**: the app, the RPC proxy, providers' ability to settle,
   buyers' ability to get refunds.
8. **Trust and claims**: public copy that overstates what is live or reviewed
   is a legal and reputational risk (`docs/PUBLIC-CLAIM-BOUNDARY.md`).

## Adversaries

| Actor | Can | Wants |
|---|---|---|
| Malicious buyer | Sign any transaction, craft accounts, front-run, replay requests | Work without paying, underpay, block a provider's payout, take a refund after being served |
| Malicious provider | Run modified provider code, report any token count, choose payout accounts | Overcharge, take the full maximum, take fees for the treasury, fake ratings |
| Third party on chain | Watch the mempool and public transactions, create accounts, front-run | Present someone else's payment, grief escrows, redirect payouts, block closes |
| Web attacker | Send any HTTP request, run scripts in a victim's browser if XSS exists, phish | Take a session, link their wallet to another account, abuse the RPC key, read private rows, send email as us |
| Supply-chain attacker | Publish look-alike packages, compromise a dependency or a CI action | Run code in providers' servers or in CI with secrets |
| Insider or compromised maintainer machine | Push code, change env vars, sign with one multisig key | Change the upgrade authority, move treasury funds, ship a malicious build |
| Token issuer (Paxos, Circle, etc.) | Freeze accounts, change Token-2022 extensions (hook, fee, permanent delegate) | Not hostile, but changes can stall or drain escrows |
| Rater or judge | Commit, reveal or attest | Manipulate reputation, rate a job they did not pay for |

## Attack goals to try per surface

- **S1 program**: account substitution (wrong owner, wrong mint, wrong token
  program, duplicate accounts), missing signer, PDA seed collision, arithmetic
  overflow or rounding in fee and refund math, window boundary races (both
  parties at the exact slot), re-init or revival of closed accounts, Token-2022
  extension abuse (hook, transfer fee, permanent delegate, frozen accounts,
  withheld fees), rent and lamport edge cases, rating bound to the wrong job,
  compute exhaustion, upgrade authority and build reproducibility.
- **S2 app**: authn and authz on every route, IDOR on jobs, receipts and
  listings, SSRF through endpoint probes and source adapters, RPC proxy abuse
  (method allowlist, origin check, cost amplification), cron and manager routes
  open without a secret, sandbox signing keys reaching mainnet paths, network
  profile confusion (devnet code against mainnet, overrides), XSS and CSP,
  secrets in client bundles (`NEXT_PUBLIC_*`), wallet-adapter phishing (what a
  user is asked to sign), unsafe transaction building.
- **S3 marketing**: email abuse through subscribe (bombing, header injection),
  double-opt-in bypass, unsubscribe token forgery, cron routes open, PostHog
  consent bypass, open redirects, XSS in rendered updates, PII retention.
- **S4 packages**: payment-proof verification bypass, replay across providers or
  networks, delegation scope and length, raw-body hashing mismatches, mint and
  amount confusion, unit mistakes, SSRF from the provider to the upstream,
  secrets in logs, install scripts, dependency confusion on the `@redditech`
  scope, lockfile drift, package contents (`files`) leaking test keys or
  configs, unsafe defaults that a third-party operator will ship.
- **S5 database**: RLS gaps (any table, any column, any role), security definer
  functions with an open `search_path`, grants to `anon`, replay store race
  conditions, service-role use from code a user can steer, wallet linking
  takeover, migration order.
- **S6 infra**: who can deploy, who can change env vars, preview deployments
  exposing secrets, GitHub Actions permissions, `pull_request_target`,
  unpinned third-party actions, secret exposure in logs, branch protection,
  upgrade authority transfer and read-back, multisig membership and threshold,
  the investments squad kept apart, key storage, recovery and rotation,
  monitoring and an incident stop switch.
- **S7 flows**: get served without paying, pay once and be served twice,
  settle more than authorised, lock and refund after service, block a refund,
  route the fee elsewhere, rate or attest a job you were not part of.

## Out of scope by design (still report if you see harm)

- The archived Anchor program as a deployable target (it is a reference).
- Quasar programs and the frozen Quasar devnet deployment.
- MagicBlock PER (`per` feature), not part of V1.
- Third-party services' own security (Solana validators, Supabase platform,
  Vercel platform, Squads program), except how we configure and use them.
