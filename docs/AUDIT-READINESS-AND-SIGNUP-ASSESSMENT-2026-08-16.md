# Audit Readiness & Signup-Flow Assessment — 2026-08-16

Scope: current state of `reddi-agent-protocol` (this repo) and `reddiagent-lab` (open-spec home), assessed for two goals:

1. Readying the protocol for an external smart-contract audit.
2. Shipping a practical front-end use case for users to sign up and get started.

Method: full-repo sweep of both repositories (programs, app routes, packages, tests, CI, docs) with spot verification of load-bearing claims against source. File references are to this repo unless noted.

---

## 1. Executive summary

**Built and defensible:** five Quasar Rust programs with 70 CI-gated tests plus the CI-gated legacy Anchor 1.1.2 reference; an honest four-document adversarial security-audit chain with named regression tests; a complete external-audit handoff pack with frozen commit and full ABI appendix; `@reddi/agent-protocol` (47 modules, ~586 tests, CI-gated, release-guarded); mechanically enforced claim boundaries; a real on-chain registration flow at `/register`; and, lab-side, a stable ADL v0.2 spec with a deterministic conformance suite.

**Not built / blocking:**

- **Audit:** four open Criticals in the Quasar programs (job-binding class), self-documented as mainnet blockers since 2026-05-06, and **no external auditor engaged**. The lab-side freeze packet is done; the protocol-side engagement is not.
- **Signup:** the onboarding funnel (`/onboarding/intake` → `/onboarding/profile-editor` → `/onboarding/readiness-gate`) is three fixture-backed islands with **no persistence, no live endpoint inspection, and no listing generation**. There is no account system, no database, and the payer side of x402 settlement returns a mock signature.

The shortest path to both goals: (a) freeze and send the already-prepared audit pack after fixing or explicitly scoping the open Criticals, and (b) wire the existing `/start → /setup → /register` path into a single connected funnel backed by a real persistence layer, rather than building new surface.

---

## 2. What is built

### 2.1 On-chain programs

| Program set | Location | Status |
|---|---|---|
| Quasar registry / escrow / reputation / attestation | `experiments/quasar-*` | Deployed to devnet (IDs in `config/quasar/deployments.json`); 42 tests across the four programs; CI-gated via `.github/workflows/quasar-program-tests.yml` |
| Quasar escrow-PER (5th program) | `experiments/quasar-escrow-per/` | 28 tests (most-tested program); **not** in the four-program demo narrative; listed as an active audit target in the handoff doc |
| Legacy Anchor reference | `programs/escrow/` | 14 instructions, 33 passing LiteSVM tests plus 1 devnet-only ignored test under Anchor 1.1.2; historical reference only; CI-gated by `.github/workflows/anchor-program-tests.yml` as regression evidence, not final Quasar proof |

The reputation program carries the audit-hardened commit-reveal (`sha256(score ‖ salt ‖ job_id ‖ program_id)`, zero-commitment rejection, expire restricted to recorded parties) — remediation verified line-by-line in `docs/QUASAR-PROGRAMS-SECURITY-AUDIT-STAGE2-2026-05-06.md`.

### 2.2 Security/audit artifacts (the strongest part of the repo)

- Four-document audit chain (2026-05-06): audit → remediation → stage-2 re-verification → response with explicit **non-closure statement**. Verdict on record: *safe to merge, not safe to deploy to mainnet*.
- Regression tests named for their findings (`test_audit_cancel_before_window_rejected`, `test_audit_self_confirmation_attest_rejected`, `test_audit_zero_commitment_rejected`, `test_audit_cross_job_commitment_reuse_rejected`, `test_audit_expire_third_party_rejected`).
- External-audit handoff pack (2026-06-24, issues #526/#530/#531): per-program inventory, full ABI appendix (instruction/account discriminators, PDA seeds, layouts), auditor-facing scope with frozen input commit `3561dc5`, script-guarded (`check-solana-audit-appendix.mjs`, `check-solana-audit-handoff.mjs`).
- Whitepaper threat model (`docs/whitepaper/APPENDIX-THREAT-MODEL.md`) with residual-risk column and prioritized hardening roadmap.
- Lab-side: smart-contract audit-readiness freeze packet (`reddiagent-lab/scripts/smart_contract_audit_readiness_freeze_packet.py`, #366) and receipt-integrity validator (#387/PR #405, motivated by the USENIX Security 2026 x402-facilitator findings) — both complete.

### 2.3 Web app

45 routes, 75 API handlers. The genuinely real user-facing surface:

- `/start` — role-based entry hub (run agents → `/setup`; build specialists → `/register`; want proof → `/economic-demo`).
- `/setup` — endpoint configuration and 5-step endpoint test (largest genuine tool, 1,311 lines).
- `/register` — wallet connect + real on-chain agent registration (0.01 SOL), existing-agent detection, liveness probe. **This is the only true signup today.**
- `/onboarding` — operator-grade "Onboarding Lab" exercising registration, attestation, and commit-reveal on-chain.
- Marketplace/product surfaces: `/agents`, `/agents/[wallet]`, `/planner`, `/runs`, `/leaderboard`, `/dashboard`, `/orchestrator`.

### 2.4 Packages

`@reddi/agent-protocol` is release-ready in engineering terms (47 src modules, 48 export subpaths, ~556 tests, README/LICENSE/CHANGELOG, committed dist, CI guard) but **unpublished** pending an approved release issue. `@reddi/x402-solana` is second (real verification path, Jupiter Swap V2 client). The rest range from moderate (`rap-mcp-bridge`, `openrouter-specialists`) to stub/deferred (`sendai-x402`, `eliza-plugin-x402` — formally deferred from v0.1).

### 2.5 Lab repo (reddiagent-lab)

ADL v0.2 spec + JSON Schema (stable, canonical), 102 pytest files, conformance levels 0–4, error taxonomy, 30 negative fixtures, 11 provider mappings (report-only by ADR 0006), public pages live at `agent-protocol.reddi.tech/{spec,updates,feedback}`. Payment/reputation extension specs map cleanly onto implemented protocol features. Everything executable is deterministic and dry-run by design.

---

## 3. What is yet to be built — ordered by severity

### Audit blockers

1. **Four open Criticals in the Quasar programs** (root cause: `job_id` is a free-form caller-chosen `u128` with no binding to an escrow or signed counterparty authorization): rating-PDA squatting, judge self-confirmation/reputation theft (partially mitigated), unbounded attestation creation, cheap repeatable reputation grief. Open since 2026-05-06. Also still open: HIGH-2 (no payee dispute path), HIGH-3 (reputation laundering), HIGH-7 (split registries).
2. **No external auditor engaged.** The handoff pack requires named human approval to send; nothing has been sent. Lab `docs/TRACKS.md` rung 7: "Not started."
3. **Upgrade authority is a single dev wallet** (`d4ST3N…` per `config/quasar/deployments.json`) — no multisig, no timelock, no rotation policy. Auditors will flag this on page one.
4. **Committed live-format Jupiter API key** in `.env.example:16` — violates SECURITY.md's own rule. Treat as compromised and rotate immediately; scrub history or note it in the audit disclosure.
5. **Remaining CI coverage gaps:** PR #638 added root Jest, legacy Anchor reference, and signup/onboarding funnel workflows; PR #648 added the pinned Solana toolchain baseline. The entire Playwright suite remains split between blocking funnel coverage and best-effort/nightly evidence capture, and any broader Surfpool/devnet lane still needs its documented approval/safety preconditions.
6. **Configuration truth-drift that an auditor will trip over:**
   - App defaults to `legacy-anchor` unless `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar` is set (`lib/config/network.ts:66-78`), contradicting the "Quasar cutover complete" posture; Quasar is only permitted on the devnet profile, and the client emits `compatibility: "quasar-layout-unverified"`.
   - `config/networks/mainnet.json` carries the devnet legacy escrow ID as a placeholder.
   - `DEPLOY.md` publishes program ID `77rkRQxe…` that exists nowhere in code or config (known doc rot, still unfixed at the top of the deploy runbook).
   - `$schema` pointers in `config/quasar/*.json` reference schema files that do not exist.
   - Vendored Quasar framework upstream SHA still a TODO in `third_party/quasar/VERSION.md` (MEDIUM-6 partial).
7. **Audit-scope naming trap:** the real audit targets live under `experiments/quasar-*`, not `programs/` — worth restructuring or at minimum documenting prominently before handoff.

### Product / signup blockers

8. **No persistence layer, no user identity.** No auth, no database (no next-auth/clerk/supabase/prisma; no postgres/redis/kv). State is JSON files written with `writeFileSync` (`data/agents.json` — 11 seeded demo agents; `data/onboarding/specialist-index.json` — 5 real entries), which is ephemeral per-invocation on Vercel. Nothing a user creates durably survives.
9. **The onboarding funnel does not connect.** `/onboarding/intake` (#384) is fixture-backed with zero network calls (live endpoint inspection gated on unshipped #459); `/onboarding/profile-editor` (#385) reviews three hardcoded drafts because draft persistence doesn't exist; `/onboarding/readiness-gate` (#386) is read-only over five fixture scenarios; listing-payload generation (#376) is unshipped. Each page is individually polished; the pipe between them is missing.
10. **Payment execution is mocked on the payer side.** `packages/x402-solana/src/payment.ts:326` returns `mock_tx_signature_…`; the `allowRealPayment` gate is set nowhere outside the package. The economic demo's settlement claims rest on the escrow programs, not on a live x402 payer path.
11. **Surface sprawl vs. funnel.** 45 routes and 24 nav links against 5 real specialist-index entries; roughly half the routes are demo/evidence/doc surfaces. The newest strategic pages (`/spec`, `/updates`, `/feedback`) are orphaned — linked only to each other, absent from NavBar/Footer/homepage.
12. **Doc truth-drift:** CHANGELOG.md frozen at 2026-04-18; STATUS.md top entry (2026-07-17) predates the last three commits; `/testers` hardcodes the legacy program ID; ~half of the 141 top-level docs are hackathon-era archival.

### Lab-side open items

- Buzz marketplace curation envelope (spdd 0426) and Buzz boundary threat model (spdd 0427): planned, unbuilt — the two most recent commits are both "Plan …".
- ADL v0.3 candidates: `charge` intents escape Level-3 enforcement; no price-discovery field (`maxAmount` is a cap, not a quote — a discovery card can't say "costs X per task"); seller-side rigor optional in schema.
- Maintainer-owed items from STATUS (2026-07-29): flip repo public, publish v0.2.0-beta release, submit Superteam AU tranche-2 form. Launch target on record: **2026-08-31**.
- No payment/receipt/delegation tutorials (only two tiny 2026-05 tutorials) — a visible content gap for the public launch.

---

## 4. Recommended path to audit engagement

Sequenced so each step unblocks the next; items 1–4 are pre-engagement hygiene, 5–6 are the engagement itself.

1. **Rotate the Jupiter API key** and purge it from `.env.example` (finding #4). Same-day fix.
2. **Decide the Critical strategy per finding:** fix job-binding in-program (escrow-reference in rating/attestation PDA seeds + counterparty authorization), or contractually scope it as a known-open finding in the engagement letter. The audit response doc already frames these as re-review preconditions — fixing before engagement is cheaper than a re-audit round.
3. **Close the config drift** (finding #6): flip the default program target to Quasar (or document why not), fix `DEPLOY.md`, remove the mainnet placeholder ID, pin the vendored Quasar SHA, add the missing JSON schemas. All are small, and all would otherwise consume auditor hours.
4. **Gate the ungated tests** (finding #5): add a root `test` script, a Jest workflow, an Anchor-tests workflow, and make the Playwright lane blocking for the funnel specs. The audit pack's credibility rests on "~1,470 automated checks"; make that claim mechanically true.
5. **Re-freeze and send the handoff pack.** `docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md` needs its frozen commit updated to post-fix HEAD, then the named-human approval it is waiting for. Auditor selection is the critical path — everything in steps 1–4 can proceed in parallel with soliciting quotes.
6. **Plan the upgrade-authority transition** (multisig, e.g. Squads, before mainnet; documented policy now). Auditors will ask; having the answer in SECURITY.md pre-empts a finding.

---

## 5. The practical signup / get-started use case

### 5.1 What exists today

The pieces of a real funnel already exist but are unconnected:

```
/start (role picker)
  ├─ "I run agents"        → /setup     (endpoint config + test — real, no persistence)
  ├─ "I build specialists" → /register  (wallet connect + on-chain registration — real)
  └─ "I want proof"        → /economic-demo (demo)

/onboarding/intake → /onboarding/profile-editor → /onboarding/readiness-gate
  (polished, fixture-backed, no persistence, no network — #459, #385-persistence, #376 unshipped)
```

A user today can connect a wallet and register an agent on devnet. They cannot: keep a draft, have their endpoint actually inspected, generate a listing, see "my agents" tied to any identity beyond the connected wallet, or pay/get paid for real (payer path mocked).

### 5.2 Recommended MVP: "Specialist operator signs up, registers, gets listed"

One connected path, using only surfaces that already exist, in dependency order:

**Phase 1 — persistence + identity (unblocks everything).**
Add a durable store (Vercel Postgres/Neon or Supabase — smallest change that survives serverless) with wallet-signature auth (sign-in-with-Solana; the wallet is already the identity primitive at `/register`, so no email/password system is needed for MVP). Tables: `operators` (wallet pubkey), `agent_drafts`, `listings`. This directly closes the #385 draft-persistence gap.

**Phase 2 — connect the intake pipe.**
- Ship #459 (live endpoint inspection adapter) so `/onboarding/intake` analyzes the operator's real endpoint instead of fixtures — `/setup` already contains the 5-step endpoint test logic to reuse.
- Persist intake output as an `agent_draft`; feed `/onboarding/profile-editor` from the draft instead of the three hardcoded fixtures.

**Phase 3 — registration + listing.**
- From the approved draft, hand off to the existing `/register` on-chain flow (already real).
- Ship #376 (listing-payload generation) so a completed registration produces a marketplace listing in `/agents` backed by the durable store instead of `data/agents.json`.
- Readiness-gate (#386) runs against the operator's real record; the 16 gates are already built.

**Phase 4 — funnel hygiene.**
- Make `/start` the homepage CTA; add a "My agents" view keyed to the signed-in wallet.
- Trim the NavBar to the funnel + proof surfaces; link the orphaned `/spec`, `/updates`, `/feedback` pages; move demo/evidence routes under a single "Evidence" section.
- Fix `/testers`' hardcoded legacy program ID.

**Explicitly out of MVP scope** (consistent with existing claim boundaries): live x402 payer settlement (keep `sendPayment` mocked and labeled until the audit lands), mainnet anything, marketplace publication to Buzz (lab spdd 0426/0427 are unbuilt), and reputation mutation from the UI.

This MVP uses the audit-safe read/register surface only, so it can ship **in parallel with the audit engagement** rather than waiting on it.

### 5.3 Success criteria

A new operator, starting from the homepage, can in one session: connect a wallet → describe/test their endpoint → review a generated profile → register on-chain (devnet) → see their agent listed in `/agents` → return the next day and find all of it still there. Every step already has a page; the work is persistence and the three unshipped issues (#459, #376, #385-persistence).

---

## 6. Priority matrix

| # | Action | Goal served | Size | Depends on |
|---|---|---|---|---|
| 1 | Rotate/purge committed Jupiter key | Audit | XS | — |
| 2 | Fix config drift (default target, DEPLOY.md, mainnet placeholder, schemas, vendored SHA) | Audit | S | — |
| 3 | CI-gate Jest / Playwright / Anchor tests | Both | S–M | — |
| 4 | Decide + fix (or scope) the four Criticals | Audit | M–L | — |
| 5 | Select auditor, re-freeze handoff, send | Audit | S (+ human approval) | 1, 2, 4 |
| 6 | Durable store + wallet auth | Signup | M | — |
| 7 | #459 live endpoint inspection | Signup | M | 6 |
| 8 | Draft persistence intake→editor (#385 gap) | Signup | S | 6 |
| 9 | #376 listing generation + `/agents` on durable store | Signup | M | 6, 8 |
| 10 | Funnel hygiene (nav, homepage CTA, orphaned pages, `/testers` ID) | Signup | S | — |
| 11 | Upgrade-authority multisig plan | Audit | S (doc) / M (impl) | — |
| 12 | Lab: publish v0.2.0-beta, flip public, tranche-2 form | Launch | XS (maintainer) | — |

Items 1–3, 6, and 10 have no dependencies and can all start immediately.
