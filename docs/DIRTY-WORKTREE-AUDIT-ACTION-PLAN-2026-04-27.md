# Dirty Worktree Audit Action Plan

_Last updated: 2026-04-27 AEST_

## Purpose

The repository has a large pre-existing dirty/untracked worktree. Before more BDD iterations, classify every remaining file as:

- **TRACK** — product/source/docs/tests that should become commits.
- **IGNORE** — generated/local runtime files that should be added to `.gitignore` and left out of git.
- **DISCARD CANDIDATE** — safe to remove only after Nissan approval or after evidence is copied elsewhere.
- **REVIEW** — needs human/implementation review before deciding.

No files should be deleted or reset during this audit without explicit approval.

## Current inventory snapshot

Command used:

```bash
git status --porcelain=v1
```

Snapshot count: **78 dirty/untracked paths** after commit `bdb43b6d`.

## Initial classification

### A. Likely TRACK — product/source/test/doc work

These look like implementation, BDD, network-profile, planner, registry, demo, or protocol additions that should be reviewed and probably committed in scoped batches.

| Area | Paths | Proposed action |
|---|---|---|
| Network/config drift | `.env.example`, `Anchor.toml`, `lib/program.ts`, `archive/anchor-escrow/src/lib.rs`, `docs/NETWORK-PROFILES.md` | Review as one network-profile/program-id commit. Verify no secret values. |
| Onboarding/API/product routes | `app/api/onboarding/audit/route.ts`, `app/api/onboarding/preflight/`, `app/onboarding/page.tsx`, `e2e/onboarding.spec.ts` | Review against current onboarding BDD; commit if still aligned. |
| Planner/consumer lifecycle | `app/api/planner/tools/route.ts`, `app/api/planner/tools/register-consumer/`, `app/api/planner/tools/release/`, `app/api/planner/tools/resolve-attestor/`, `lib/onboarding/attestor-resolver.ts`, `lib/onboarding/planner-settlement.ts` | Likely TRACK; maps to Bucket H. Verify tests pass as a slice. |
| Registry/discovery | `app/api/registry/route.ts`, `data/onboarding/specialist-index.json`, `lib/__tests__/registry-route.test.ts`, `lib/__tests__/registry-bridge-sort.test.ts` | Likely TRACK if data is demo seed not private runtime data. Confirm seed fixtures are intentional. |
| BDD docs/features | `docs/BDD-*`, `docs/SURFPOOL-BUCKET-COVERAGE-AUDIT-2026-04-20.md`, `docs/bdd/features/bucket-a/b/c/d-e*.feature` | Likely TRACK; check duplicate/stale dates before committing. |
| BDD/test coverage | `lib/__tests__/endpoint-security-compat.test.ts`, `planner-*`, `program-rpc-config.test.ts`, `planner-auditability.test.ts` | Likely TRACK with matching source slices. |
| Live lane scripts | `scripts/run-*.sh`, `scripts/*runner.mjs`, `.github/workflows/integration-lane-nightly.yml` | Likely TRACK as CI/manual acceptance lanes; verify they do not require secrets or embed local-only paths. |
| Demo/live settlement | `lib/jupiter-client.ts`, `lib/jupiter-client.test.ts`, `lib/onboarding/x402-settlement.ts`, `packages/x402-solana/src/jupiter.ts`, `packages/per-client/src/config.ts` | Likely TRACK as Jupiter/PER settlement slice; verify current tests. |
| Demo agents | `packages/demo-agents/.env.devnet.example`, `src/config.ts`, `src/demo.ts`, `src/register-agents.ts` | Likely TRACK if example-only and no private keys. |
| Product pages/docs | `app/demo/page.tsx`, `app/specialist/page.tsx`, `app/features/`, `app/playbook/`, `docs/CONSUMER-ORCHESTRATOR-PLUMBING-PLAN.md`, `docs/DEMO-SCENE-SCRIPTS-FEATURES.md`, `DX-REPORT.md` | REVIEW/TRACK; group by product surface. |
| Pitch/docs | `pitch/`, `docs/verifiable-agent-protocol/.../COMPETITOR-POSITIONING-MATRIX.md` | REVIEW/TRACK if current pitch materials; avoid huge binary artifacts. |
| Package examples | `packages/eliza-plugin-x402/.env.example` | Likely TRACK if example-only; inspect for placeholders only. |

### B. Likely IGNORE — generated/local runtime state

These should generally not be committed. Add explicit `.gitignore` entries if not already covered.

| Path | Reason | Proposed action |
|---|---|---|
| `.surfpool/` | Local Surfpool runtime state/cache. | Add to `.gitignore`; discard after approval if no unique evidence. |
| `artifacts/` | Generated run artifacts/logs; large (approx 8.9 MB, 791 files). | Keep local until evidence pack is finalized; do not commit bulk artifacts. Consider committing only curated summaries if needed. |
| `test-results/` | Playwright/generated test output (approx 1.9 MB). | Add to `.gitignore`; safe discard after approval. |
| `data/onboarding/attestations.json` | Local runtime/demo data. | Do not commit unless converted to sanitized fixture. |
| `data/onboarding/dogfood-escrows.json` | Local runtime/demo data. | Do not commit unless sanitized fixture. |
| `data/onboarding/local-wallet.json` | **Potential key material/sensitive local wallet.** | Never commit. Add explicit ignore if needed. Remove only with approval. |
| `data/onboarding/planner-feedback.json` | Local runtime/demo data. | Do not commit unless sanitized fixture. |
| `data/onboarding/planner-runs.json` | Local runtime/demo data. | Do not commit unless sanitized fixture. |
| `data/onboarding/runtime-config.json` | Local runtime config. | Review for secrets; likely ignore. |
| `data/onboarding/specialist-profile.json` | Local endpoint/token profile. | Likely sensitive; do not commit. |
| `data/onboarding/token-gated-proxy.mjs` | Generated proxy script from onboarding. | Should be generated at runtime; ignore unless moved into source template intentionally. |

### C. Review before deciding

These may be useful but need content inspection before TRACK/DISCARD:

- `DX-REPORT.md`
- `pitch/`
- `app/features/`
- `app/playbook/`
- `docs/verifiable-agent-protocol/.../COMPETITOR-POSITIONING-MATRIX.md`
- `data/onboarding/specialist-index.json` (seed data vs runtime mutation)

## Proposed audit sequence

### Pass 1 — Safety ignore commit

Goal: prevent accidental commit of local/generated/sensitive files.

1. Inspect `.gitignore` and add explicit entries for:
   - `.surfpool/`
   - `artifacts/`
   - `test-results/`
   - `data/onboarding/*.json` runtime files except intentional seed fixtures
   - `data/onboarding/token-gated-proxy.mjs`
2. Verify ignored files disappear from `git status --short --ignored` as expected.
3. Commit `.gitignore` only.

### Pass 2 — Network/profile source slice

Goal: commit coherent network drift + Surfpool/devnet/mainnet readiness source changes.

Candidate paths:

- `.env.example`
- `Anchor.toml`
- `lib/program.ts`
- `archive/anchor-escrow/src/lib.rs`
- `docs/NETWORK-PROFILES.md`
- `scripts/run-mainnet-readiness-check.sh`
- relevant `packages/demo-agents/*`
- `lib/__tests__/program-rpc-config.test.ts`

Verification:

```bash
npx jest lib/__tests__/program-rpc-config.test.ts --runInBand
npm run build
```

### Pass 3 — Planner/consumer/attestor lifecycle slice

Goal: commit Bucket H route/source/tests together.

Candidate paths:

- `app/api/planner/tools/*`
- `lib/onboarding/attestor-resolver.ts`
- `lib/onboarding/planner-settlement.ts`
- `lib/__tests__/planner-*`
- `app/api/dogfood/*` if dirty in later checks

Verification:

```bash
npx jest lib/__tests__/planner-register-consumer-route.test.ts lib/__tests__/planner-tools-manifest-route.test.ts lib/__tests__/planner-resolve-attestor-route.test.ts lib/__tests__/planner-release-route.test.ts lib/__tests__/planner-auditability.test.ts --runInBand
```

### Pass 4 — BDD/docs/features slice

Goal: commit current BDD feature/docs if not stale/duplicative.

Candidate paths:

- `docs/BDD-*`
- `docs/bdd/features/bucket-a-onboarding.feature`
- `docs/bdd/features/bucket-b-discovery.feature`
- `docs/bdd/features/bucket-c-planner-consumption.feature`
- `docs/bdd/features/bucket-d-e-reliability.feature`
- `docs/SURFPOOL-BUCKET-COVERAGE-AUDIT-2026-04-20.md`

Verification:

```bash
npm run test:bdd:index
```

### Pass 5 — Product/pitch/review slice

Goal: inspect and decide whether product pages and pitch docs belong in repo.

Candidate paths:

- `app/features/`
- `app/playbook/`
- `app/demo/page.tsx`
- `app/specialist/page.tsx`
- `pitch/`
- `docs/DEMO-SCENE-SCRIPTS-FEATURES.md`
- `docs/CONSUMER-ORCHESTRATOR-PLUMBING-PLAN.md`
- `DX-REPORT.md`

Verification:

```bash
npm run build
```

## Audit progress — 2026-04-27 11:05 AEST

Status after scoped review/verification/commits:

- Started from **78** dirty/untracked paths after original local commit `bdb43b6d`.
- Rebasing onto current `origin/main` dropped already-upstream slices (`consumer attestor settlement tools`, `adoption playbook catalog`) and rewrote local hashes.
- Current scoped audit commits after rebase:
  - `30fb4931` `feat(bdd): add manager readiness role slice`
  - `a47e7b2a` `chore: ignore local protocol runtime artifacts`
  - `d841e56a` `feat: add network profile readiness controls`
  - `b7c5544a` `docs(bdd): restore bucket coverage audit trail`
  - `c25ce6f2` `feat(onboarding): add operator preflight and registry guards`
  - `83713040` `fix(x402): harden jupiter swap fallback`
  - `2ad3876a` `chore: add demo and integration evidence tooling`
  - `1ae620a2` `docs: add collaborator positioning map`
  - `bb96e6cb` `docs: record dirty worktree audit progress`
- Final dirty path `data/onboarding/specialist-index.json` was discarded after Nissan approval; worktree returned clean.

Verification completed during audit:

```bash
npx jest lib/__tests__/program-rpc-config.test.ts --runInBand
npx jest lib/__tests__/planner-register-consumer-route.test.ts lib/__tests__/planner-tools-manifest-route.test.ts lib/__tests__/planner-resolve-attestor-route.test.ts lib/__tests__/planner-release-route.test.ts lib/__tests__/planner-auditability.test.ts --runInBand
npm run test:bdd:index
npx jest lib/__tests__/registry-route.test.ts lib/__tests__/endpoint-security-compat.test.ts lib/__tests__/registry-bridge-sort.test.ts --runInBand
npx playwright test e2e/onboarding.spec.ts --reporter=line
npx jest lib/__tests__/jupiter-client.test.ts --runInBand
(cd packages/x402-solana && npm test -- --runInBand)
bash -n scripts/run-integration-lane.sh scripts/run-jupiter-live-smoke.sh scripts/run-per-happy-smoke.sh scripts/run-surfpool-critical-smoke.sh scripts/run-surfpool-jupiter-invoke-smoke.sh scripts/run-surfpool-onboarding-attestation-smoke.sh scripts/run-surfpool-onboarding-wrapper-smoke.sh
node --check scripts/capture-tx-proof.mjs scripts/capture-tx-proof-v2.mjs scripts/surfpool-jupiter-invoke-runner.mjs scripts/surfpool-onboarding-wrapper-runner.mjs
npm run build
```

### Final local runtime-data decision

`data/onboarding/specialist-index.json` appeared to be local/demo runtime mutation rather than curated seed data:

- added multiple `https://127.0.0.1:3899` endpoint entries,
- empty capability arrays,
- timestamped local registration artifacts,
- reformatted the existing seed records.

Nissan approved discarding this final mutation on 2026-04-27; the file was restored to HEAD.

## Decision rules

- **Never commit:** local wallet/key material, endpoint tokens, generated runtime JSON, raw logs with prompts, bulk test outputs.
- **Commit only with source/tests:** route/source changes that have matching BDD or unit coverage.
- **Commit docs separately from code** unless the doc is the acceptance artifact for that slice.
- **One scoped commit per slice**, matching the BDD playbook.
- **Ask Nissan before deletion/reset** of any file or directory.

## Immediate next action

Start with **Pass 1 — Safety ignore commit**. It reduces risk without discarding anything.
