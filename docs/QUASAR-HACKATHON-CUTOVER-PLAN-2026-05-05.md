# Quasar Hackathon Cutover Plan

> **DATED campaign plan — superseded 2026-10-02.** Preserve the phases, commands, and contemporaneous approvals below as historical provenance only. They do not authorize execution now. Quasar is frozen; the recorded deployment is blocked and the retained loopback Surfpool lane is reproducibility evidence, not readiness or promotion. Current authority: [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Date:_ 2026-05-05 AEST
_Issue:_ #236
_Status:_ Phase 0 plan/spec. No signing, deployment, wallet mutation, env mutation, or live paid/provider calls performed.

## Decision reversal

Prior Quasar docs treated Quasar as fork-isolated/post-hackathon optimisation. Nissan has now changed the product goal:

> Hackathon submission and all demos must use Quasar-deployed Solana programs.

This document supersedes the older "Anchor now, Quasar later" submission posture for demo/submission readiness. Anchor may remain as a legacy/reference implementation until parity is complete, but it must not be presented as the hackathon demo proof after cutover.


## Goal alignment update — 2026-05-06

The plan remains aligned on the Quasar migration, but it was too narrow if read as “Quasar CI green = final submission ready.” The corrected goal is:

> Final Colosseum Frontier demos must use Quasar-compiled Solana programs for demo-critical on-chain paths **and** must visibly use the bounty protocols/products identified for the submission story: MagicBlock, x402, Jupiter, OpenRouter, Surfpool, plus any later confirmed sponsor targets.

Therefore Phase 4/5 must include a bounty/product evidence matrix, not only Quasar CI. Anchor can remain as legacy/reference coverage, but it must not be the final demo proof path. MagicBlock PER/TEE remains fail-closed/not claimed unless separately live-validated with approval.

## Current state audit

- Quasar PR guard exists: `.github/workflows/quasar-readiness-guard.yml` runs `npm run check:quasar:submission` for Quasar-relevant changes.
- Legacy Anchor CI remains as historical/reference implementation evidence only; it is not final hackathon proof.
- Runtime config can select Quasar via `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar`, `HACKATHON_DEMO_TARGET=quasar`, or `DEMO_PROGRAM_TARGET=quasar`.
- Runtime compatibility inventory has zero blocker-status demo-critical paths for the scoped Quasar proof boundary.
- Quasar parity reports exist for escrow, registry, reputation, attestation, and PER; live PER/TEE execution remains approval-gated and not claimed by the scoped packet.
- The legacy `packages/demo-agents/src/demo.ts` full-flow/PER script is explicitly scoped out of Quasar proof and fails closed when selected with a Quasar target.

## Cutover principle

All hackathon demo surfaces must answer three questions clearly:

1. **Which Quasar program ID is this using?**
2. **Which deployment/evidence artifact proves that program is deployed and demo-relevant?**
3. **Which demo routes/scripts/readiness checks would fail if the app silently fell back to Anchor?**

If any answer is missing, that phase is not submission-ready.

## Guardrails

Allowed without further approval:

- Local docs/spec/BDD changes.
- Local static/source checks.
- Local config scaffolding that does not mutate secrets or deployment environments.
- Reading public GitHub/docs and existing repo artifacts.

Requires explicit approval before action:

- Any signing operation.
- Any wallet mutation.
- Any devnet deployment or transfer.
- Any Coolify/Vercel/env/secret mutation.
- Any paid provider call.
- Any live specialist/research execution beyond current approved local-only checks.

## BDD iterative phases

### Phase 0 — Decision lock and migration plan

**Expectation:** The repo records Quasar-deployed programs as the hackathon demo target and stops treating Anchor CI as sufficient submission proof.

**Implementation:** This plan, BDD scenario, STATUS update, and Issue #236.

**Acceptance:**

- Plan states the new Quasar target and supersedes prior Anchor-first submission posture.
- BDD scenario requires Quasar-deployed program alignment for hackathon demos.
- STATUS points future work at Quasar cutover.

**Validation:**

- `npm run test:bdd:index`
- `git diff --check`

**Retrospective:** Required before Phase 1.

### Phase 1 — Quasar deployment inventory and config contract

**Expectation:** The repo has one canonical place for Quasar deployment metadata.

**Implementation:** `config/quasar/deployments.json` plus `npm run check:quasar:deployments`.

**Acceptance:**

- A local check can load the inventory and verify required fields exist.
- Missing Quasar program IDs fails locally.
- Anchor program IDs are allowed only under explicit `legacyAnchorReference`, not as demo target IDs.

**Validation:**

- `npm run check:quasar:deployments`
- `npm run test:bdd:index`
- `git diff --check`

**Retrospective:** Complete locally. Known Quasar candidate ID exists and is executable on devnet by read-only RPC check, but this is not enough for submission readiness because runtime wiring and PER/judge-packet proof chain are still incomplete. No deployment/signing approval has been used.

### Phase 2 — Demo/readiness guardrail

**Expectation:** Demo submission checks fail if hackathon demo surfaces target Anchor-only evidence.

**Implementation:** `npm run check:quasar:demo-readiness` plus Quasar cutover notes in the judge packet and operator checklist.

**Acceptance:**

- `npm run check:quasar:demo-readiness` fails without Quasar metadata.
- Judge packet/readiness docs reference Quasar deployment evidence, not Anchor-only CI.
- `submissionReady=false` is allowed only when known gaps and approval-gated blockers are explicit.

**Validation:**

- `npm run check:quasar:deployments`
- `npm run check:quasar:demo-readiness`
- `npm run test:bdd:index`
- `git diff --check`

**Retrospective:** Complete locally. The guard now prevents us from accidentally treating the Anchor-era judge packet as final Quasar proof. UI/runtime copy needs Phase 3 wiring next because `lib/program.ts` still assumes Anchor-compatible instruction/account layouts.

### Phase 3 — Runtime/demo wiring

**Expectation:** Demo code resolves Quasar program IDs from the new config when in hackathon/demo mode.

**Implementation:** `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar` / `HACKATHON_DEMO_TARGET=quasar` / `DEMO_PROGRAM_TARGET=quasar` now selects the Quasar devnet program from `config/quasar/deployments.json` in app runtime config. Demo-agent config mirrors the same target flag.

**Acceptance:**

- Local tests prove Quasar IDs are used in hackathon/demo mode.
- Tests prove legacy Anchor IDs are not silently used.
- Runtime exports expose `PROGRAM_COMPATIBILITY=quasar-layout-unverified` so target selection is not misread as instruction/layout proof.

**Validation:**

- `npx jest --runTestsByPath lib/__tests__/quasar-demo-program-config.test.ts lib/__tests__/program-network-alignment.test.ts lib/__tests__/program-rpc-config.test.ts --runInBand`
- `npm run check:quasar:deployments`
- `npm run check:quasar:demo-readiness`
- `npm run test:bdd:index`
- `git diff --check`

**Retrospective:** Runtime ID selection is wired, but transaction builders and account decoders still need Quasar layout verification before submissionReady can become true. Package demo-agent TypeScript project has a pre-existing `rootDir` issue when typechecking due `packages/x402-solana/src/*` imports outside `packages/demo-agents/src`; this is a separate tooling blocker to fix before using package-level `tsc` as a gate.

### Phase 4 — CI cutover

**Expectation:** PR/main checks reflect the Quasar submission path.

**Implementation target:** Add QuasarSVM/build/readiness CI or rename legacy Anchor CI so it cannot be mistaken for final submission proof.

**Acceptance:**

- Quasar checks run in CI or a documented blocker explains why local-only Quasar checks are temporarily required.
- Anchor check, if retained, is named legacy/reference.
- Judge packet proof chain cites Quasar checks/evidence.

**Retrospective:** Decide whether submission is ready or deployment/signing approval is required.

### Phase 5 — Final Quasar judge packet and rehearsal

**Expectation:** The final submission packet and operator rehearsal use Quasar-deployed programs.

**Implementation target:** Refresh judge packet, operator checklist, local rehearsal, and STATUS around Quasar proof.

**Acceptance:**

- Final packet answers the three cutover questions.
- Rehearsal demonstrates demo flow against Quasar-targeted metadata/evidence.
- Approval-gated items remain explicit.

## Phase 0 retrospective

_Status:_ Complete locally; ready for PR.

- **What worked:** The audit found a clear mismatch: our latest submission-readiness loop was rigorous, but it validated the current Anchor-based repo state rather than the newly stated Quasar demo goal.
- **What failed or surprised us:** A stale `feature/wire-quasar-programs` branch exists, but it is too divergent and polluted to merge directly. We need a clean forward-port, not a branch resurrection.
- **Safety review:** Phase 0 was docs/issue/source inspection only. No signing, deployment, wallet mutation, env mutation, paid calls, or live specialist execution.
- **Plan adjustment:** Phase 1 must inventory actual Quasar deployment IDs/evidence before runtime wiring. If no valid deployed Quasar IDs exist, the next honest blocker is explicit approval to deploy/sign.
