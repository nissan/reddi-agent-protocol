# Architecture for auditors

What the system is, where each part lives, and how value and trust move between
the parts. Read this before the surface prompt. File paths are relative to the
repository root. Where this file and the code disagree, the code wins; report
the drift as an Info finding.

## One paragraph

Reddi Agent Protocol (RAP) is a marketplace and receipt layer for paid AI agent
work on Solana. Providers list a service priced per token. A buyer either pays a
call directly (x402-style, the payer signs a proof over the payment) or locks a
maximum in an on-chain escrow; after the response the provider settles the
actual cost, the program sends a 2.5% protocol fee to the treasury (capped at
0.1 SOL on SOL payments only) and returns the unused part to the buyer. Buyers
can opt a job into an on-chain rating, and judges can attest to job quality.
Receipts (`reddi.receipt.v2`) tie the payment, the work and the evidence
together. Supported currencies: SOL, USDC and AUDD (classic SPL Token), PYUSD and
USDG (Token-2022).

## Components and trust boundaries

```
 Buyer wallet ──signs──▶ Developer app / sandbox (Next.js, Vercel) ──▶ /api/rpc proxy ──▶ Solana RPC (Helius on mainnet)
      │                        │  wallet sign-in (Supabase Auth, web3:solana identity)
      │                        ▼
      │                  Supabase Postgres (RLS)  ◀── server routes using the service role
      │
      ├──signs lock/release──▶ On-chain program (Pinocchio, program id DcfW3Cxt…5Ucu)
      │                               │ fee ──▶ Treasury = Squads vault 5CsBuT…3Hxe (2 of 3)
      │                               │ upgrade authority ──▶ Squads vault
      │
      └──x402 request + payer proof──▶ Provider (provider kit / openrouter-specialists)
                                          │ settles metered escrow as payee
                                          └──▶ upstream model API (provider's own key)

 Marketing site (apps/marketing, Vercel) ── newsletter (Resend), analytics (PostHog), no wallet
 npm packages (@redditech/*) ── consumed by third-party providers and buyers
 GitHub Actions ── tests, verifiable program build, mint watch, uptime
```

## Surfaces in detail

### S1 On-chain program

- Source: `programs/pinocchio-escrow/program/src/` (`lib.rs`, `checks.rs`,
  `consts.rs`, `state.rs`, `token.rs`, `instructions/`). Interface and rules:
  `programs/pinocchio-escrow/README.md` and `interface/vectors.json`.
- One V1 build (default features). The `devnet`, `extended` and `per` features
  are not part of the mainnet build; `per` is never built for mainnet.
- 23 instructions: the 13 escrow and registry instructions that keep the
  archived Anchor wire contract (`archive/anchor-escrow/`, IDL source), plus 10
  rating and attestation instructions documented only in the program README.
- Money paths: SOL and token locks (fixed and metered), release by payer, claim
  by payee after the claim window, refund by payer after the refund window,
  metered settle by payee only. Each lock names its own claim and refund windows
  in slots (claim no later than refund).
- Tests: `programs/pinocchio-escrow/equivalence/` (Anchor tests run against the
  Pinocchio binary, side-by-side suite, program-only rating tests).
- Build of record: `.github/workflows/escrow-verifiable-build.yml` (container
  build, sha256 and size). Treasury preflight `scripts/check-escrow-treasury.mjs`;
  Token-2022 posture `scripts/check-token2022-mint-posture.mjs` and
  `.github/workflows/token2022-mint-watch.yml`.

### S2 Developer app, sandbox and API

- Next.js 16 App Router at the repository root: `app/`, `components/`, `lib/`,
  `providers/`. About 69 API route handlers under `app/api/`.
- High-value routes: `api/auth/*` (wallet session), `api/rpc` (RPC proxy,
  `lib/rpc/proxy.ts`), `api/sandbox/v1/*` (OpenAI-compatible sandbox that locks
  and settles on devnet), `api/jobs`, `api/listings*`, `api/onboarding/*`
  (operator key, attestation operator, wallet recovery, settlement config),
  `api/planner/*`, `api/cron/*` (protected by `CRON_SECRET`), `api/manager/*`,
  `api/dogfood/*`, source adapters.
- Network profile: `lib/config/network.ts`, `config/networks/*.json`,
  `docs/NETWORK-PROFILES.md`. Program id overrides are refused on devnet unless
  the build opted in; mainnet must never accept a runtime override.
- Payments: `lib/payments/` (metered lock, quote, session auth, direct payment),
  `lib/jobs/paid-call.ts`, `lib/sandbox/` (gateway, settle signer, keys).
- Sandbox provider keys (`lib/sandbox/keys.ts`) are derived from a published
  label, so anyone can recompute them. They must never control value outside
  devnet.

### S3 Marketing site

- `apps/marketing/` (separate Next.js app and Vercel project). Routes: home,
  market, newsletter, privacy, terms, status, updates, watch, sandbox (link-out).
- API: `api/subscribe`, `api/newsletter/{confirm,unsubscribe,issues,prune}`,
  `api/health`. Two Vercel crons. Email through Resend; analytics through
  PostHog with a consent choice.

### S4 Provider kit, SDK packages and supply chain

- `packages/provider-kit` (CLI, server, handler, chain, sessions, replay, keys,
  Dockerfile), `packages/x402-solana` (payment verification, metered settle,
  fee math, middleware, client), `packages/agent-protocol`,
  `packages/openrouter-specialists`, `packages/rap-mcp-bridge`, and others.
- Published under the `@redditech` npm scope. Each package has its own lockfile
  and `files` list.
- Paid-request authentication: every paid request carries the payer's
  signature (`x402-payment-proof`, optional `x402-payment-delegation`, session
  headers `x402-session-delegation` and `x402-session-signature`), over the raw
  body bytes. Delegations are short and provider-bound.

### S5 Supabase

- Schema and RLS: `supabase/migrations/` (V1 core: profiles, providers, jobs,
  receipts, payment_replay with `replay_check_and_store`, attestations,
  provider_stats). Design: `docs/V1-DATA-AND-SIGNIN-DESIGN.md`.
- Server access: `lib/supabase/`, `lib/auth/`, `lib/jobs/`, `lib/listings/`.
  The service role key is server-only.
- Sign-in: Supabase Auth with the Solana web3 identity; the server reads the
  wallet from the identity, never from the browser or `user_metadata`.

### S6 Infrastructure, keys, custody, CI/CD

- Vercel: app project (app.agent-protocol.reddi.tech) and marketing project
  (agent-protocol.reddi.tech), plus a leftover duplicate project with its Git
  connection removed. Environment variables hold the RPC key, Supabase keys,
  Resend key, `CRON_SECRET`.
- Custody: Squads multisig "Reddi Agent Protocol", 2 of 3. Its vault is the
  fee treasury and the intended program upgrade authority. A separate
  investments squad must stay out of protocol flows. Always the vault address,
  never the multisig account address.
- Keys: devnet deployer and program keypairs live in 1Password and on the
  owner's machine only. Agents never create, read or hold keys.
- CI: 21 GitHub Actions workflows under `.github/workflows/`. Runbooks:
  `docs/MAINNET-LAUNCH-RUNBOOK.md`, `docs/MAINNET-RPC.md`, `DEPLOY.md`.

### S7 End-to-end payment and economic flows

Cross-cuts S1, S2, S4 and S5: quote, authorise a maximum, lock, call, meter,
settle, fee, refund, receipt, replay store, rating. The question is whether the
pieces together let anyone take, freeze or misdirect value, or get work without
paying.

## Key public facts

| Item | Value |
|---|---|
| V1 program id (devnet and planned mainnet) | `DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu` |
| Treasury and upgrade authority (Squads vault) | `5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe` |
| Fee | 2.5% (250 bps) of the amount paid, rounded down, from the provider's share; 0.1 SOL cap on SOL only |
| Mainnet mints | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, AUDD `AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw` (classic SPL Token); PYUSD `2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo`, USDG `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH` (Token-2022). Check against `config/` before relying on them. |
| Launch runbook | `docs/MAINNET-LAUNCH-RUNBOOK.md` |
