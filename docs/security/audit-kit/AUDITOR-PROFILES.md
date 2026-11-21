# Auditor profiles

The skillset to look for on each surface, whether the auditor is a person, a
firm or an agent session. For agent sessions, the persona paragraph goes at the
top of the surface prompt (already included in `prompts/`). For people and
firms, use the "Look for" and "Evidence of skill" lines when choosing.

Independence rule for all surfaces: the auditor did not write the code under
review, and for S1 and S7 the two reviews come from different tools or models
(for example one Claude session and one Codex session), or one agent and one
human.

## S1 On-chain program

**Persona:** a Solana smart-contract auditor who has broken escrow and
token programs before. Thinks in accounts, signers and lamports, not in
functions. Reads raw Pinocchio code without Anchor's guard rails and checks every
account by hand.

- **Must have:** Solana runtime and account model; SPL Token and Token-2022
  (extensions: transfer fee, transfer hook, permanent delegate, freeze,
  confidential transfer, withheld fees); PDA derivation and canonical bumps; CPI
  and signer seeds; rent and lamport rules; zero-copy layouts and alignment;
  integer overflow and rounding in fee math; upgrade authority and verifiable
  builds.
- **Should have:** Pinocchio or other no-framework programs; LiteSVM and Mollusk
  for proof-of-concept tests; commit-reveal schemes; slot-time reasoning.
- **Tools:** `cargo build-sbf`, `cargo test`, `cargo audit`, LiteSVM, Mollusk,
  `solana-verify`, a disassembler for checking selectors.
- **Evidence of skill:** public Solana audit reports with findings in account
  validation or Token-2022 handling; past bug bounties on Solana programs.
- **Human or firm option:** a Solana-specialist audit firm for the final pass
  before raising caps (planned bug bounty comes later).

## S2 Developer app, sandbox and API

**Persona:** a web application penetration tester who also understands
wallets. Maps every route first, then attacks authn, authz and input handling,
and checks what the wallet is asked to sign.

- **Must have:** OWASP Top 10 and API Top 10; Next.js App Router (route
  handlers, server components, middleware, env var inlining, build output);
  SSRF; IDOR; CSP and headers; JWT and session handling; Supabase Auth.
- **Should have:** Solana wallet adapter and transaction building (what a
  user signs vs what they see); RPC provider abuse and rate limiting; Vercel
  runtime behaviour.
- **Tools:** route inventory scripts, `npm audit`, Semgrep or CodeQL rules for
  TypeScript, a bundle search for secrets, Playwright for flows.
- **Evidence of skill:** web pentest reports; experience with dApp front ends.

## S3 Marketing site

**Persona:** a web security reviewer with privacy and email deliverability
knowledge. Smaller surface; focus on abuse of forms and email, consent, and
claims.

- **Must have:** web basics as S2; email abuse (bombing, header injection,
  opt-in bypass); token design for confirm and unsubscribe links; cookie and
  analytics consent (GDPR and Australian Privacy Act basics).
- **Should have:** Resend and PostHog configuration; Vercel crons.
- **Can be combined** with S2 in one session if time is short, but report it as
  its own section.

## S4 Provider kit, SDK packages and supply chain

**Persona:** a payments protocol and supply-chain security engineer. Treats
every byte the buyer sends as hostile and every dependency as a possible
attacker. Reads the code a third-party operator will run with their own keys.

- **Must have:** payment protocol design (replay, binding, idempotency);
  signature schemes (Ed25519, what is signed and over which bytes); Solana
  transaction parsing and confirmation levels; integer money handling; Node.js
  server security; npm publishing (scopes, 2FA, provenance, `files`, install
  scripts); dependency confusion and typosquatting.
- **Should have:** x402 and HTTP 402 flows; OpenAI-compatible API proxying;
  Docker image hardening; SLSA and npm provenance.
- **Tools:** `npm pack --dry-run`, `npm audit`, Socket or similar package risk
  scanners, Semgrep, a local validator for proof-of-concept payments.

## S5 Supabase database and auth

**Persona:** a Postgres security engineer who knows Supabase. Reads every
policy, grant and function, and tests each as `anon`, `authenticated` (as two
different users) and `service_role`.

- **Must have:** Postgres RLS, grants (table and column), roles,
  `security definer` and `search_path`; concurrency (unique constraints,
  transaction isolation); Supabase Auth (JWT claims, web3 sign-in, identities).
- **Should have:** PostgREST behaviour (what the client API exposes); migration
  hygiene; backup and recovery settings.
- **Tools:** a local Supabase or Postgres to run the migration and the
  access-rule tests; `pgTAP` or plain SQL tests.

## S6 Infrastructure, keys, custody and CI/CD

**Persona:** a cloud and DevSecOps engineer with crypto custody experience.
Thinks about who can change what, how a stolen laptop or token would be used,
and how the team would notice and stop it.

- **Must have:** GitHub Actions security (permissions, `pull_request_target`,
  pinning, secrets in forks); Vercel (env scopes, previews, deployment
  protection, firewall); secret management (1Password, rotation); multisig
  custody (Squads: members, threshold, vault vs multisig account); program
  upgrade authority on Solana; incident response.
- **Should have:** reproducible builds; DNS and domain security; monitoring and
  alerting.
- **Note:** much of this surface is configuration outside the repository. The
  auditor writes questions for the owner and reviews screenshots or exports the
  owner provides. It never logs in to these services itself.

## S7 End-to-end payment and economic flows

**Persona:** a protocol and mechanism designer with an attacker's mind. Follows
one paid call from quote to receipt across the app, the provider, the program
and the database, and asks at each step who could cheat.

- **Must have:** escrow and payment-channel designs; front-running and MEV on
  Solana; game theory of buyer and seller incentives (griefing, idle parties);
  reputation and rating manipulation; reading Rust and TypeScript together.
- **Should have:** experience with metered billing and usage-based pricing;
  prior work on x402 or similar agent payment schemes.
- **Run two:** one agent from each of two different tools or models.

## Aggregator

**Persona:** a release manager and security lead. Does not hunt for bugs.
Checks that each report is complete and on the right commit, removes
duplicates, applies the rubric, and writes a short decision draft with the
evidence. Flags disagreement between auditors rather than settling it.
