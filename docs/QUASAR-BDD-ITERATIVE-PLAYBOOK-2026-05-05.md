# Quasar Hackathon Cutover — BDD Iterative Playbook

> **Dated historical campaign record — qualification added 2026-10-05; superseded 2026-10-02.** This playbook, including its cutover goal, phase plans, commands, and “no demo-critical Anchor path” exit criteria, is preserved as 2026-05-05 hackathon campaign planning, not current guidance or proof. Quasar is frozen, its recorded deployment is blocked, and stable Anchor `1.1.2` remains authoritative. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Date:_ 2026-05-05 AEST
_Issue:_ #236
_Goal:_ All hackathon submission demos use Quasar-deployed Solana programs.
_Method:_ Small BDD loops with a retrospective after every phase, then plan refinement before the next phase starts.

## North star

The hackathon demo must not silently rely on the legacy Anchor deployment. Every demo, judge packet, operator checklist, and readiness script must be able to answer:

1. Which Quasar program ID is used?
2. What proof says it is deployed and relevant?
3. What fails if the demo falls back to Anchor?
4. Which gaps are still approval-gated or unverified?


## Goal-alignment correction — 2026-05-06

Nissan clarified that the target is broader than “scoped Quasar proof green.” The final Colosseum Frontier submission must show **all final demo surfaces** running against **Quasar-compiled Solana programs** and must visibly incorporate the bounty protocols/products we identified for the hackathon story.

### Corrected north-star acceptance

A phase is not final-ready unless it can answer all of these:

1. **Quasar-native:** Does this demo path use Quasar-compiled Solana program IDs for every demo-critical on-chain action, with Anchor disabled or explicitly marked legacy/reference?
2. **Bounty-visible:** Which bounty product/protocol is visible in the demo evidence or UI — MagicBlock, x402, Jupiter, OpenRouter, Surfpool, and any later confirmed sponsor target?
3. **Honest proof boundary:** Is the proof live, local, replay/screenshot, or storyboard-only? MagicBlock PER/TEE must stay fail-closed/not claimed unless separately live-validated.
4. **Regression guard:** What test/check fails if the path silently falls back to Anchor or drops the bounty integration from the demo?

### Demo/bounty coverage matrix

| Demo surface | Required Quasar proof | Required bounty/product visibility | Current status | Next adjustment |
| --- | --- | --- | --- | --- |
| `/register` + agent onboarding | Quasar Registry + Attestation builders and readback | OpenRouter specialist identity/capability disclosure where relevant | Quasar-compatible builders exist; read/decode compatibility completed in PR #244 | Add/verify UI/evidence text that ties registered agents to OpenRouter-capable marketplace story |
| `/economic-demo` | Quasar program status card + no Anchor final-proof path | x402 payment evidence, OpenRouter specialist/workflow evidence, Jupiter route/quote evidence where applicable | Honesty card exists; bounty coverage is described but not yet a hard matrix gate | Add a sponsor/product checklist artifact and guard so every final demo packet lists visible bounty evidence |
| Demo-agent A→B→C script | Quasar Registry, Escrow, Reputation, Attestation IDs and transaction builders | x402/OpenRouter economic workflow; optional Jupiter step if used by final packet | Quasar-native A→B→C flow exists; PER/TEE scoped fail-closed | Ensure generated evidence labels each Quasar tx and each bounty product used |
| MagicBlock/PER rehearsal | No Anchor fallback; Quasar path must fail closed if PER/TEE is unavailable | MagicBlock / Surfpool evidence only when actually validated | MagicBlock PER/TEE is not claimed; Surfpool/local rehearsal evidence is separate | Keep as explicit decision gate: either live-validate with approval or present as non-claimed/local rehearsal only |
| Judge packet/operator checklist | Must cite Quasar CI + readiness guard, not Anchor CI | Must include sponsor/bounty map with evidence links | Scoped packet refreshed; CI now green | Refresh packet again after CI cutover with the corrected full-goal matrix |

### Plan adjustment

The CI cutover phases remain necessary, but they are **not sufficient**. After Quasar CI is green, the next loops must shift from “can Quasar compile/test?” to “does every final demo and evidence artifact prove Quasar + bounty-product usage?”

New order after current CI cutover:

1. **Phase A — CI final-proof boundary:** keep Quasar program tests green; de-scope Anchor checks only after branch protection is safe.
2. **Phase B — Bounty coverage guard:** add a repo-local sponsor/bounty coverage matrix/check for MagicBlock, x402, Jupiter, OpenRouter, Surfpool.
3. **Phase C — Demo evidence refresh:** update `/economic-demo`, demo-agent evidence generation, judge packet, and operator checklist so each final surface lists Quasar program IDs plus bounty evidence.
4. **Phase D — MagicBlock decision gate:** either approval-gated live validation for MagicBlock/PER/TEE or explicit non-claim with Surfpool/local rehearsal evidence only.
5. **Phase E — Final rehearsal:** run local Quasar-native rehearsal and checks; only perform live signing/deployment/provider calls with explicit approval.

## Non-negotiable guardrails

No phase may perform these without explicit Nissan approval:

- signing operations,
- wallet mutation,
- devnet transfer,
- program deployment/redeployment,
- Coolify/Vercel/environment mutation,
- paid provider calls,
- live provider/specialist execution.

If a phase discovers one of these is required, stop that phase at a blocker and write the retrospective.

## Loop template for every phase

Each phase must be done as a separate, reviewable loop:

1. **Expectation** — write the BDD expectation before implementation.
2. **Scenario(s)** — add or update Gherkin/Bucket scenario where appropriate.
3. **Implementation slice** — smallest code/docs change that tests the expectation.
4. **Validation** — run the smallest meaningful gates for that slice.
5. **Retrospective** — write what worked, what failed/surprised us, blockers, and plan tweaks.
6. **Plan refinement** — update this playbook and `STATUS.md` before moving to the next phase.
7. **PR + merge discipline** — keep each loop PR scoped; merge only after checks are green or a blocker is explicitly documented.

## Retrospective format

Append this block under the relevant phase before proceeding:

```md
### Retrospective — Phase N

- **Expected:**
- **Observed:**
- **Validation:**
- **What worked:**
- **What failed / surprised us:**
- **Safety / approval review:**
- **Decision:** continue / adjust / block
- **Plan changes for next phase:**
```

## Current completed loops

### Phase 0 — Decision lock

**Expectation:** The repo records that Quasar-deployed Solana programs are the hackathon demo target.

**Delivered:** PR #237 added the cutover plan and BDD scenario.

**Validation:**

- `npm run test:bdd:index`
- `git diff --check`
- GitHub checks on PR #237

### Retrospective — Phase 0

- **Expected:** Replace the old “Anchor now, Quasar later” posture with a Quasar hackathon target.
- **Observed:** The old docs were clear but outdated; the decision needed explicit reversal so future loops would not drift back to Anchor proof.
- **Validation:** BDD index and PR checks passed.
- **What worked:** Decision was captured early before more runtime work happened.
- **What failed / surprised us:** The stale `feature/wire-quasar-programs` branch was unsafe to revive wholesale.
- **Safety / approval review:** Docs/BDD only; no signing, deployment, wallet/env mutation, or paid calls.
- **Decision:** continue.
- **Plan changes for next phase:** Inventory Quasar deployment evidence before wiring runtime.

### Phase 1 — Deployment inventory

**Expectation:** One canonical repo-local inventory records Quasar deployment metadata and separates it from legacy Anchor references.

**Delivered:** PR #237 added:

- `config/quasar/deployments.json`
- `npm run check:quasar:deployments`
- candidate devnet Quasar program `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`

**Validation:**

- `npm run check:quasar:deployments`
- read-only `solana account ... --url https://api.devnet.solana.com` confirmed executable account
- GitHub checks on PR #237

### Retrospective — Phase 1

- **Expected:** Find or create a safe local source of truth for Quasar program IDs.
- **Observed:** Candidate Quasar ID exists and is executable, but deployment existence alone is not demo readiness.
- **Validation:** Inventory check passed; read-only RPC check showed executable=true.
- **What worked:** Captured legacy Anchor ID separately as reference only.
- **What failed / surprised us:** Evidence did not yet prove instruction/layout compatibility or PER parity.
- **Safety / approval review:** Read-only RPC only; no signing/deployment/wallet mutation.
- **Decision:** continue with `submissionReady=false`.
- **Plan changes for next phase:** Add readiness guard that makes known gaps explicit.

### Phase 2 — Demo readiness guard

**Expectation:** The repo fails safely if someone tries to treat Anchor-era judge packet evidence as final Quasar hackathon proof.

**Delivered:** PR #238 added:

- `npm run check:quasar:demo-readiness`
- Quasar notes in judge packet/operator checklist
- explicit blocker handling while `submissionReady=false`

**Validation:**

- `npm run check:quasar:deployments`
- `npm run check:quasar:demo-readiness`
- `npm run test:bdd:index`
- `git diff --check`
- GitHub checks on PR #238

### Retrospective — Phase 2

- **Expected:** Prevent accidental use of Anchor-era packet as final Quasar proof.
- **Observed:** Guard works and surfaces known gaps while still passing as an honest readiness check.
- **Validation:** Local gates and PR checks passed.
- **What worked:** The check prints `BLOCKED` plus known gaps instead of silently pretending ready.
- **What failed / surprised us:** The current public packet needed stronger language to avoid being reused incorrectly.
- **Safety / approval review:** Docs/script only; no external mutation.
- **Decision:** continue.
- **Plan changes for next phase:** Wire explicit runtime target selection but label layout compatibility as unverified.

### Phase 3 — Explicit runtime target selection

**Expectation:** Demo/runtime config can intentionally select the Quasar devnet program without relying on unsafe override behavior.

**Delivered:** PR #239 added:

- `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar`
- `HACKATHON_DEMO_TARGET=quasar`
- `DEMO_PROGRAM_TARGET=quasar`
- runtime exports: `PROGRAM_TARGET`, `PROGRAM_FRAMEWORK`, `PROGRAM_COMPATIBILITY`, `PROGRAM_SUBMISSION_READY`, `PROGRAM_KNOWN_GAPS`
- tests proving Quasar selection is explicit and legacy Anchor remains default otherwise

**Validation:**

- `npx jest --runTestsByPath lib/__tests__/quasar-demo-program-config.test.ts lib/__tests__/program-network-alignment.test.ts lib/__tests__/program-rpc-config.test.ts --runInBand`
- `npm run check:quasar:deployments`
- `npm run check:quasar:demo-readiness`
- `npm run test:bdd:index`
- `git diff --check`
- GitHub checks on PR #239

### Retrospective — Phase 3

- **Expected:** Runtime can point to Quasar only when the demo target is explicit.
- **Observed:** Config now resolves `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW` in explicit Quasar/devnet mode and exposes `quasar-layout-unverified`.
- **Validation:** Local Jest target tests passed; PR checks passed.
- **What worked:** We avoided unsafe `NEXT_PUBLIC_ESCROW_PROGRAM_ID` overrides as the primary cutover path.
- **What failed / surprised us:** Package-level demo-agent `tsc` has a pre-existing rootDir/import issue from `packages/x402-solana/src` imports outside `packages/demo-agents/src`.
- **Safety / approval review:** Runtime/config/tests only; no signing/deployment/wallet/env mutation.
- **Decision:** continue, but do not claim Quasar transaction compatibility yet.
- **Plan changes for next phase:** Verify Quasar instruction builders/account layouts and isolate incompatible Anchor assumptions.

## Upcoming phased plan

This is the staged plan from the current PR onward. Each phase remains a separate BDD loop unless the slice is explicitly marked as a sub-slice inside the same PR. After every phase/slice, append the retrospective block above, then refine the next phase before implementation continues.

### Phase 4 — Quasar compatibility audit and builder boundary ✅ complete

**Expectation:** The repo identifies which runtime paths are safe to run against Quasar and which still assume Anchor discriminators/account layouts.

**Delivered:** `config/quasar/runtime-compatibility.json` plus `npm run check:quasar:runtime-compatibility`.

**Current result:** Guard audits 14 demo-critical paths and blocks submission readiness while Quasar-incompatible paths remain.

**Retrospective status:** Written above.

### Phase 5 — Quasar transaction builder port 🟡 active in PR #244

**Expectation:** Demo-critical transactions have Quasar-compatible instruction data/account metadata or are deliberately disabled with a blocker.

**Delivered in slices so far:**

1. Shared instruction-data builders for registry, reputation, and attestation.
2. Registry + attestation `TransactionInstruction` wrappers.
3. `/register` target-aware Quasar construction.
4. Demo-agent registration target-aware Quasar construction.
5. Onboarding `attest_quality` target-aware Quasar construction.

**Current result:** Runtime blockers reduced from 9 to 6. Remaining blockers are:

- `lib/program.ts` — shared builders/decoders still document Anchor account assumptions.
- `app/onboarding/page.tsx` — confirm/dispute transaction paths still use shared Anchor builders.
- `lib/onboarding/reputation-signal.ts` — commit/reveal reputation builders remain Anchor-layout-only.
- `lib/registry/bridge.ts` — registry read/decode path filters Anchor account discriminators.
- `lib/useOnchainAgents.ts` — client agent fetch/decode path filters Anchor account discriminators.
- `packages/demo-agents/src/demo.ts` — escrow/reputation/attestation/PER flow still has inline Anchor-era construction and PER uncertainty.

**Validation for current PR:**

- `npm run build`
- targeted Quasar/register/onboarding/demo-agent Jest suites
- `npm run check:quasar:runtime-compatibility`
- `npm run check:quasar:deployments`
- `npm run check:quasar:demo-readiness`
- `npm run test:bdd:index`
- `git diff --check`
- GitHub checks on PR #244 — green as of this checkpoint

**Retrospective status:** Slice retrospectives are written above through Phase 6 Slice 1. After PR #244 merge, add one merge retrospective recording check status, blocker count, and whether the plan should prioritize read/decode paths or reputation builders.

### Phase 6 — Quasar demo honesty surfaces

**Expectation:** Operator-facing demo surfaces show Quasar target, deployment status, submission readiness, and known gaps before anyone records or triggers a wallet path.

#### Slice 6.1 — Register page honesty ✅ active in PR #244

**Delivered:** `/register` shows Quasar target, compatibility, submission readiness, and known gaps.

**Retrospective status:** Written above.

#### Slice 6.2 — Economic demo status card ✅ implemented in PR #244

**BDD expectation:** `/economic-demo` must distinguish economic workflow evidence from Quasar on-chain proof.

**Implementation:** `/economic-demo` now renders a Solana program target card using centralized program/readiness metadata. It names the active program ID, target/framework, compatibility status, submission readiness, known Quasar proof gaps, and hard no-live-action boundary.

**Acceptance:**

- The page names the active program ID.
- The page says `submissionReady=blocked` while Quasar blockers remain.
- The page explicitly says controlled x402/OpenRouter evidence, Surfpool local rehearsal evidence, and storyboard dry-runs are not automatically final Quasar submission proof.
- No hosted call, signing, wallet mutation, devnet transfer, env mutation, or paid call is introduced.

**Validation:**

- `npm run build`
- `npm run check:quasar:runtime-compatibility`
- `npm run check:quasar:deployments`
- `npm run check:quasar:demo-readiness`
- `npm run test:bdd:index`
- `git diff --check`

### Retrospective — Phase 6 / Slice 2

- **Expected:** Economic demo should stop being ambiguous about what is economic workflow evidence versus Quasar on-chain proof.
- **Observed:** A visible status card can reuse existing centralized metadata; no new API or live call was needed.
- **Validation:** Build/readiness/BDD/diff gates are the required proof for this slice.
- **What worked:** The existing program metadata made this a UI honesty slice instead of a new state-management surface.
- **What failed / surprised us:** The page is a client component and already imports program metadata elsewhere in the app, so we kept the implementation simple rather than introducing a server API.
- **Safety / approval review:** UI/build only; no signing, send, deployment, wallet/env mutation, paid calls, or live execution.
- **Decision:** continue.
- **Plan changes for next phase:** Move from honesty surfaces back to blocker reduction. Phase 7 should start with read/decode compatibility because judge screenshots depend on not accidentally showing Anchor-filtered account data in Quasar mode.

### Phase 7 — Read/decode Quasar compatibility ✅ implemented in PR #244

**Expectation:** Marketplace and app read paths either decode Quasar accounts correctly or fail closed with explicit status.

**BDD scenarios:**

- Given the demo target is Quasar, when registry data is read for marketplace or `/agents`, then the path must not use Anchor account discriminator filtering unless marked legacy-only.
- Given Quasar account layout is not fully verified, when a reader would produce a misleading agent list, then it must surface a blocker instead of silently showing Anchor data.

**Implementation:**

1. Inspected Quasar attestation parity source for final AgentAccount layout: one-byte account discriminator `20`, 153-byte account data, fixed `model: [u8;64]`, and `attestation_accuracy` after bump.
2. Added target-aware account discriminator/data-size constants and `decodeQuasarAgentAccount` / `decodeActiveAgentAccount` in `lib/program.ts`.
3. Ported `lib/registry/bridge.ts` and `lib/useOnchainAgents.ts` to use active target filters and active decoder instead of Anchor-only memcmp/data-size/decode.
4. Added fixture tests for Quasar AgentAccount decoding and active Quasar mode.
5. Updated runtime compatibility inventory: read/decode blockers reduced from 6 to 4.

**Acceptance:**

- Read/decode blockers are reduced from 6 to 4.
- Quasar decoder has fixture tests covering discriminator, data size, fixed model layout, invalid discriminator, and invalid model length.
- Anchor decode remains available through legacy target mode.

**Validation:**

- `npx jest --runTestsByPath lib/__tests__/quasar-agent-account-decoder.test.ts --runInBand`
- `npm run check:quasar:runtime-compatibility`
- Full build/readiness/BDD gates before push.

### Retrospective — Phase 7

- **Expected:** Read/decode paths should stop filtering Quasar accounts with Anchor account discriminators and Anchor data sizes.
- **Observed:** The Quasar parity source gave exact offsets, letting us implement a deterministic decoder without live RPC or signing.
- **Validation:** Focused decoder tests passed; runtime compatibility now reports 4 blockers instead of 6.
- **What worked:** Reusing one active decoder/filter boundary fixed both server bridge and client hook without duplicating layout logic.
- **What failed / surprised us:** Quasar comments in test source used “disc=1” wording while the account macro uses discriminator 20; offset math and account macro confirm the actual account discriminator is byte 20.
- **Safety / approval review:** Local source/tests only; no signing, send, deployment, wallet/env mutation, paid calls, or live execution.
- **Decision:** continue.
- **Plan changes for next phase:** Phase 8 should port reputation commit/reveal and remaining onboarding transaction paths; read/decode is now good enough for screenshots only if transaction readiness remains honestly marked blocked.

### Phase 8 — Reputation and onboarding remaining transaction paths ✅ implemented in PR #244

**Expectation:** Reputation commit/reveal and onboarding confirmation/dispute paths are Quasar-compatible or explicitly blocked.

**Implementation:**

1. Added Quasar `TransactionInstruction` wrappers for reputation commit/reveal and attestation confirm/dispute in `lib/quasar/instructions.ts`, using parity account metas and one-byte discriminators.
2. Routed `lib/onboarding/reputation-signal.ts` through target-aware Quasar helpers in explicit Quasar mode while preserving Anchor builders for legacy mode.
3. Routed `app/onboarding/page.tsx` registration and attestation confirmation/dispute wallet transaction construction through Quasar helpers in explicit Quasar mode.
4. Updated runtime compatibility inventory: blockers reduced from 4 to 1.
5. Added wrapper tests covering registry, reputation commit/reveal, and attestation confirm/dispute account order/data length/discriminators.

**Acceptance:**

- Reputation signal path no longer uses Anchor 8-byte discriminators in Quasar mode.
- Onboarding UI transaction builders no longer expose Anchor-only registration or attestation confirmation/dispute actions in Quasar mode.
- Remaining blocker is limited to the demo-agent full-flow/PER path.

**Validation:**

- `npm run build`
- `npx jest --runTestsByPath lib/__tests__/quasar-instructions.test.ts lib/__tests__/quasar-agent-account-decoder.test.ts --runInBand`
- `npm run check:quasar:runtime-compatibility`
- `npm run check:quasar:deployments`
- `npm run check:quasar:demo-readiness`
- `npm run test:bdd:index`
- `git diff --check`

### Retrospective — Phase 8

- **Expected:** Reputation/onboarding blockers should convert into target-aware Quasar builders without live devnet execution.
- **Observed:** Parity tests gave exact account metas: reputation commit/reveal and attestation confirm/dispute map cleanly to Quasar one-byte instruction data. Runtime blocker count fell 4→1.
- **Validation:** Build and focused Jest passed; readiness remains honestly blocked because the demo-agent/PER path is not cut over.
- **What worked:** Centralizing wrappers in `lib/quasar/instructions.ts` kept app/server callers simple and preserved legacy Anchor mode.
- **What failed / surprised us:** The remaining blocker is no longer broad runtime plumbing; it is specifically the submission demo-agent full-flow/PER decision.
- **Safety / approval review:** Local source/tests only; no signing, send, deployment, wallet/env mutation, paid calls, or live execution.
- **Decision:** continue to Phase 9 decision gate. Recommend splitting PER/escrow into scoped claim: demo can prove registry/reputation/attestation Quasar paths now, but cannot claim PER/escrow Quasar parity until the remaining full-flow path is either ported or explicitly excluded.
- **Plan changes for next phase:** Phase 9 should inspect `packages/demo-agents/src/demo.ts`, identify exactly which escrow/PER instructions block submission readiness, then choose either (A) port non-PER demo-agent calls and mark PER out of scope, or (B) keep readiness blocked pending Quasar PER semantics.

### Phase 9 — Demo-agent full flow and PER decision gate ✅ implemented in PR #244

**Expectation:** The submission demo has an honest Quasar-compatible path for the flows it shows, and PER is either proven under Quasar or explicitly scoped as fallback/future work.

**Implementation:**

1. Inspected `packages/demo-agents/src/demo.ts`: it is an end-to-end legacy full-flow script with inline escrow/PER transaction construction and live send paths.
2. Compared against current Quasar evidence: registry, reputation, attestation, and PER parity reports exist; however live MagicBlock/TEE PER remains explicitly unproven and approval-gated.
3. Chose the safe scoped-proof path: do not silently reuse this script as Quasar proof.
4. Added a fail-closed guard so the script throws immediately when `HACKATHON_DEMO_TARGET` / `DEMO_PROGRAM_TARGET` / `NEXT_PUBLIC_DEMO_PROGRAM_TARGET` is `quasar`.
5. Marked the script `not-demo-critical` in runtime compatibility because the Quasar submission proof boundary is now scoped to web/onboarding/judge-packet paths, not this legacy full-flow/PER script.
6. Added a guard test proving the legacy full-flow script cannot be accidentally presented as Quasar proof.

**Acceptance:**

- Demo script does not silently run Anchor constructions when target is Quasar.
- PER claims remain scoped: Quasar PER parity exists as source/test evidence, but live TEE execution remains unproven without explicit approval.
- Required signing/deployment/devnet/live action remains stopped behind explicit Nissan approval.
- Runtime compatibility has zero blocker-status demo-critical paths.

**Validation:**

- `npm run check:quasar:runtime-compatibility` should now report submission-compatible runtime inventory (no blocker-status demo-critical paths).
- Full build/Jest/readiness/BDD gates before push.

### Retrospective — Phase 9

- **Expected:** Either port demo-agent full flow or explicitly block/scope it so it cannot become false proof.
- **Observed:** Full-flow `demo.ts` mixes escrow, PER, Jupiter, reputation, and attestation live sends; porting it would expand scope and still not prove live TEE PER without approval. The correct hackathon-safe move is fail-closed scoping.
- **Validation:** Static guard test added; runtime compatibility no longer treats the legacy full-flow script as a Quasar blocker because it is not eligible as Quasar proof.
- **What worked:** The BDD loop prevented a misleading “all demos are Quasar” claim by forcing the PER decision into a visible phase.
- **What failed / surprised us:** Runtime compatibility can reach zero blockers while submission readiness is still gated by judge-packet proof-chain language and known-gaps cleanup.
- **Safety / approval review:** Local source/tests only; no signing, send, deployment, wallet/env mutation, paid calls, or live execution.
- **Decision:** Quasar final proof boundary is scoped proof, not full-flow PER proof. PER remains future/approval-gated live validation.
- **Plan changes for next phase:** Phase 10 should convert the zero-blocker runtime inventory into CI/readiness language, update Quasar deployment known gaps from broad runtime wiring to scoped live-PER/judge-packet proof chain, and keep `submissionReady=false` until judge packet is refreshed.

### Phase 10 — CI cutover from Anchor proof to Quasar proof ✅ implemented in PR #244

**Expectation:** CI and PR checks no longer present legacy Anchor as final hackathon proof, while preserving Anchor as reference if still useful.

**Implementation:**

- Added `npm run check:quasar:submission` to compose runtime compatibility, deployment inventory, and demo-readiness guards.
- Added `.github/workflows/quasar-readiness-guard.yml` so Quasar runtime/deployment/readiness guards run on PRs touching Quasar-relevant app/lib/config/docs/scripts/package surfaces.
- Refreshed deployment inventory known gaps: broad runtime Anchor-layout wiring gap is resolved; remaining gaps are scoped live PER/TEE proof and final judge-packet proof-chain refresh.
- Kept `submissionReady=false` because zero runtime blockers is not the same as final judge-packet readiness.

**Acceptance:**

- CI has a named Quasar readiness guard independent of legacy Anchor tests.
- Quasar readiness check runs in PRs and blocks honestly only on guard failures; current expected readiness state remains `submissionReady=false` with explicit known gaps.
- Anchor proof cannot be mistaken for Quasar proof in the runtime/deployment/readiness guard language.

**Validation:**

- `npm run check:quasar:submission`
- Full build/Jest/readiness/BDD gates before push.

### Retrospective — Phase 10

- **Expected:** Convert local guard suite into CI-friendly command/workflow without claiming final submission readiness too early.
- **Observed:** Runtime compatibility can now be clean while demo-readiness remains blocked for proof-chain language. That separation is useful and should stay.
- **Validation:** Quasar guard command is composable and PR workflow is path-scoped to avoid unnecessary CI churn.
- **What worked:** Moving the broad runtime gap out of deployment inventory made remaining risk precise: live PER/TEE and judge-packet wording.
- **What failed / surprised us:** The existing Anchor workflow name is still Anchor-specific; not renamed in this phase because it is still a real reference check and changing it may affect existing branch filters/status expectations.
- **Safety / approval review:** Local source/docs/workflow edits only; no signing, send, deployment, wallet/env mutation, paid calls, or live execution.
- **Decision:** Anchor CI remains as a legacy/reference quality gate, not final hackathon proof. Quasar readiness guard becomes the hackathon cutover gate.
- **Plan changes for next phase:** Phase 11 should refresh judge packet/checklist copy to reflect: runtime blockers zero, submissionReady still false until final proof-chain language is updated, live PER not claimed without approval.

### Phase 11 — Judge packet and submission refresh ✅ implemented in PR #244

**Expectation:** Public submission materials describe the Quasar-deployed demo path and do not lean on stale Anchor-era evidence.

**Implementation:**

- Added `docs/QUASAR-SCOPED-JUDGE-PROOF-2026-05-06.md` as the explicit proof-boundary packet.
- Refreshed `docs/ECONOMIC-DEMO-JUDGE-PACKET-2026-05-05.md` from Anchor-era/superseded language to scoped Quasar proof language.
- Refreshed `docs/ECONOMIC-DEMO-OPERATOR-CHECKLIST-2026-05-05.md` so operator narration uses Quasar submission guard and does not claim live PER/TEE.
- Refreshed `docs/QUASAR-HACKATHON-CUTOVER-PLAN-2026-05-05.md` current-state audit to reflect zero runtime blockers and Quasar PR guard.
- Updated deployment inventory to `submissionReady=true` for the scoped proof boundary, with live PER/TEE and live actions moved to `knownLimitations` rather than unresolved blockers.

**Acceptance:**

- A reviewer can see what is proven, what is local/simulated, and what is not claimed.
- The packet names the correct Quasar program target.
- Anchor CI is retained only as historical/reference evidence, not final proof.
- All local ignored artifacts are referenced only as operator pointers, not published raw.

**Validation:**

- `npm run check:quasar:submission`
- Full build/Jest/BDD/diff gates before push.

### Retrospective — Phase 11

- **Expected:** Refresh public-facing packet/checklist so `submissionReady` can either become true or remain blocked with a precise reason.
- **Observed:** After Phase 10, remaining blockers were language/proof-boundary gaps, not runtime blockers. Once the packet explicitly scoped out live PER/TEE and legacy full-flow proof, readiness could become true for the scoped Quasar proof boundary.
- **Validation:** Quasar readiness guard now passes without expected BLOCKED output after inventory update.
- **What worked:** Separating `knownLimitations` from `knownGaps` avoided overstating: live PER is not proven, but it is also not claimed by the packet.
- **What failed / surprised us:** The economic demo packet needed stronger language to prevent reviewers from reading old Anchor PR rows as Quasar final proof.
- **Safety / approval review:** Local docs/config only; no signing, send, deployment, wallet/env mutation, paid calls, or live execution.
- **Decision:** `submissionReady=true` for scoped Quasar proof, not for live PER/TEE proof.
- **Plan changes for next phase:** Phase 12 should be a final approval-gated validation decision: either stop with local proof ready, or ask Nissan before any live devnet/PER/signing validation.

### Phase 12 — Approval-gated final validation ✅ local proof complete; live validation requires Nissan approval

**Expectation:** If local/code/CI proof is insufficient, request exactly the missing approval and perform only the approved action.

**Decision:** Stop at local scoped proof unless Nissan explicitly approves live validation.

**Possible approvals still available, but not used:**

- devnet signing,
- wallet funding/transfer,
- program deployment/redeployment,
- environment/Coolify/Vercel mutation,
- live hosted demo run,
- paid provider/specialist execution,
- live MagicBlock PER/TEE validation.

**Acceptance:**

- Approval request must name scope, max calls/transactions, spend cap, rollback, and artifact output.
- Runbook performs no extra live actions beyond the approval scope.
- Public-safe evidence is captured and secret-scanned.

### Retrospective — Phase 12

- **Expected:** Decide whether scoped local proof is enough or whether live devnet/PER/signing validation is required.
- **Observed:** Local proof is now internally consistent: runtime blockers are zero, Quasar readiness guard passes, judge packet is scoped, and live PER is explicitly not claimed.
- **Validation:** Local gates passed; PR checks are running on GitHub after latest push.
- **What worked:** The loop produced a submission-ready scoped proof without crossing any external/sensitive boundary.
- **What failed / surprised us:** Final PR merge readiness still depends on asynchronous GitHub/Vercel checks, not local work.
- **Safety / approval review:** No signing, send, deployment, wallet/env mutation, paid calls, or live execution. Continue to require explicit Nissan approval for live validation.
- **Decision:** Scoped Quasar proof is ready locally. Do not perform Phase 12 live validation unless Nissan asks for it.
- **Plan changes:** Next operational step is to monitor/resolve PR #244 checks, then merge/review according to normal repo policy. If Nissan wants stronger evidence, prepare a separate approval request for one bounded live validation lane.

## Active next step

1. Wait for PR #244 asynchronous GitHub/Vercel checks to finish.
2. If checks fail, fix only the failing gate and append a small retrospective note.
3. If checks pass, proceed with normal PR review/merge policy.
4. Ask Nissan before any live devnet/PER/signing validation. before coding.

## Phase 13 — Local Surfpool confidence before devnet/live demo

**Expectation:** Before any devnet signing, registration, deregistration, or live PER/TEE validation, run local-only Surfpool/localnet gates to catch bugs and clarify what they prove.

**BDD scenarios:**

- Given we are preparing a hackathon live demo, when a local Surfpool rehearsal is available, then it must run before devnet/testnet mutation is requested.
- Given existing Surfpool scripts deploy the legacy Anchor program locally, when they pass, then they prove local economic/onboarding behavior but do not by themselves prove Quasar live devnet execution.
- Given the scoped Quasar proof is `submissionReady=true`, when we decide to do devnet validation, then the approval request must name exact transactions, wallets, program IDs, rollback/deregister steps, and artifact outputs.

**Planned loops:**

### Phase 13.1 — Local-safe inventory + quick rehearsal

- Inspect existing Surfpool/localnet lanes and classify each as Quasar-proof, Anchor-local-regression, or economic-demo-local-only.
- Run quick local-only gates that do not sign devnet or call paid providers.
- Retrospective: decide whether a heavier Anchor-local Surfpool lane adds useful confidence before devnet.

### Phase 13.2 — Heavier Surfpool/localnet regression lanes

- Run the relevant Surfpool program lanes locally if Phase 13.1 indicates they add value.
- Capture artifact paths and summarize failures/successes.
- Retrospective: separate bugs requiring code changes from scope limitations requiring explicit devnet approval.

### Phase 13.3 — Devnet approval runbook, no execution without approval

- Identify whether existing devnet agents are Anchor-era and whether Quasar requires deregister/re-register or fresh registration.
- Prepare a bounded approval request for any devnet signing: exact commands, max transactions, wallets, program IDs, expected explorer links, rollback/deregister plan, and secret-scan/public artifact plan.
- Stop until Nissan approves.

**Guardrails:** No devnet signing, no devnet register/deregister, no wallet mutation, no deployment, no env/Coolify/Vercel mutation, no paid/live provider calls, and no live PER/TEE execution without explicit approval.

### Retrospective — Phase 13.1

- **Expected:** Quick local-only Surfpool rehearsal should confirm economic-demo transfer semantics before any devnet mutation.
- **Observed:** `npm run smoke:economic-demo:surfpool` passed. It executed 4 local transfers on Surfpool offline local RPC, credited amount matched planned transfers, debit covered transfers/fees, and blocked-transfer delta stayed zero.
- **Artifact:** `artifacts/economic-demo-surfpool-rehearsal/20260505T205134Z/SUMMARY.md`
- **What worked:** This gives useful recording confidence for the economic workflow without devnet signing or provider spend.
- **What failed / surprised us:** This lane is economic-demo/local-only and does not deploy or execute the Quasar devnet program. The heavier Surfpool program lanes in this repo currently use legacy Anchor local deployment (`--legacy-anchor-compatibility`), so they are regression confidence, not Quasar live proof.
- **Safety / approval review:** Local Surfpool only; no devnet, no signing outside local ephemeral wallets, no wallet/env mutation, no paid/live calls.
- **Decision:** Continue to Phase 13.2 with local Anchor-regression Surfpool lanes only if we want extra confidence in the legacy economic/onboarding behavior; keep Quasar proof claims tied to static/runtime compatibility and devnet approval-gated validation.
- **Plan adjustment:** Before devnet, prepare a precise approval runbook for Quasar devnet registration/deregistration rather than trying to infer from local Anchor Surfpool results.

### Retrospective — Phase 13.2

- **Expected:** Heavier Surfpool localnet regression should catch local program/demo breakage without touching devnet.
- **Observed:** `npm run test:surfpool:critical` passed. It built/deployed the local legacy Anchor escrow program to Surfpool offline RPC, ran public settlement, then ran PER-requested flow with unreachable PER RPC and verified L1 fallback.
- **Artifact:** `artifacts/surfpool-smoke/20260506-065203/SUMMARY.md`
- **What worked:** The full A→B→C local regression stayed under the 10s target after setup and exercised escrow, settlement fallback, blind ratings, reveal, and attestation on local Surfpool.
- **What failed / surprised us:** The local program ID is the legacy Anchor reference `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`, so this is regression confidence only. It should not be presented as Quasar program proof.
- **Safety / approval review:** Surfpool localnet only; no devnet mutation, no paid/live provider calls, no real PER/TEE execution. Explorer URLs printed by demo logs use devnet formatting but refer to local Surfpool transaction signatures from `http://127.0.0.1:18999`.
- **Decision:** Local regression confidence is good. Next phase should prepare the devnet approval runbook rather than running any devnet register/deregister now.
- **Plan adjustment:** Devnet runbook must include a preflight read-only registry check first, then approval-gated actions for deregistering any legacy Anchor registrations and registering Quasar-targeted agents if needed.

### Retrospective — Phase 13.3

- **Expected:** Devnet prep should be read-only first, then produce a bounded approval request before any signed state mutation.
- **Observed:** Read-only PDA inspection found existing A/B/C agent registrations under the legacy Anchor devnet program and no A/B/C registrations under the Quasar devnet program.
- **Artifact:** `docs/QUASAR-DEVNET-VALIDATION-RUNBOOK-2026-05-06.md`
- **Implementation fix:** Added target-aware demo-agent deregistration encoding so cleanup can safely use legacy Anchor 8-byte discriminator in legacy mode or Quasar one-byte discriminator in Quasar mode. Added read-only `scripts/check-devnet-agent-pdas.ts` for repeatable PDA inspection.
- **Validation:** `npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/check-devnet-agent-pdas.ts`, focused Jest, `npm run build`, and `npm run check:quasar:submission` all passed.
- **Decision:** Registering Quasar A/B/C agents on devnet is the likely next live step. Deregistering legacy Anchor agents is optional cleanup; keeping them does not block Quasar because PDAs are derived under a different program ID.
- **Safety / approval review:** No devnet signing or mutation was performed in this loop. Next state-changing action remains Nissan-approval-gated.
- **Plan adjustment:** Ask approval for Quasar registration first; only ask for legacy cleanup if Nissan wants a clean operator surface before recording.

## Phase 14 — Goal realignment: Quasar-native hackathon demo stack

**Goal correction:** The final Colosseum Frontier submission must not merely be “scoped Quasar proof plus legacy economic evidence.” It must present the hackathon demos as a deliberate move from legacy Anchor-compiled programs to Quasar-compiled Solana programs, while making the identified ecosystem/bounty products visible: MagicBlock PER, x402, Jupiter, OpenRouter specialist agents, Surfpool local validation, and supporting integrations such as Torque/ElizaOS/SendAI where evidence exists.

**Alignment verdict:** The current plan is partially aligned but too conservative for the final demo goal. It is correctly preventing false Anchor-as-Quasar claims, but it over-scopes Quasar to registry/reputation/attestation and leaves MagicBlock/PER/Jupiter/economic-demo evidence as mostly legacy or local/supporting proof. That is safe, but not yet the strongest hackathon submission posture.

**BDD scenarios:**

- Given Nissan’s hackathon goal is Quasar-compiled programs, when a demo records on-chain registry/reputation/attestation actions, then the active program ID must be the Quasar devnet program `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`, not the legacy Anchor reference.
- Given the demo uses MagicBlock as a bounty/ecosystem product, when PER is shown, then the narration must distinguish: “MagicBlock PER path proven in current/legacy evidence; Quasar-native live PER is approval-gated until explicitly validated.”
- Given x402/OpenRouter specialists are core to the economic workflow, when the web app or evidence pack shows paid calls, then it must show fail-closed `402 + x402-request`, controlled demo receipts or real receipt verifier status, downstream disclosure, and no hidden paid provider calls.
- Given Jupiter is part of cross-token settlement, when mentioned in the final demo, then it must be tied to the existing tested Jupiter/SOL→USDC artifact or a newly approved live/devnet validation lane.
- Given Surfpool is local confidence infrastructure, when local tests are cited, then they must be framed as pre-devnet regression confidence, not final Quasar proof unless the lane actually deploys/executes the Quasar-compiled program.

### Phase 14.1 — Quasar-first demo eligibility matrix

- Create a final demo eligibility matrix that classifies every demo surface as one of:
  - `quasar-live-ready`: executed or read against Quasar devnet program.
  - `quasar-local-compatible`: Quasar-compatible construction/readiness proven locally, but not signed on devnet.
  - `ecosystem-supporting-evidence`: x402/MagicBlock/Jupiter/OpenRouter/Surfpool evidence that supports the story but is not Quasar program proof.
  - `legacy-reference-only`: Anchor-era evidence retained only for comparison/history.
- Gate: no final demo script can present `ecosystem-supporting-evidence` or `legacy-reference-only` as Quasar-native proof.

### Phase 14.2 — Quasar devnet registration + readback, approval-gated

- Register A/B/C demo agents under Quasar devnet after explicit approval.
- Save signatures and readback artifacts proving Quasar PDAs exist.
- Update web app/operator surfaces to point at Quasar and avoid showing legacy Anchor registrations as the primary demo state.
- Optional cleanup: deregister legacy Anchor A/B/C only if Nissan wants a cleaner operator surface.

### Phase 14.3 — MagicBlock/PER decision gate for final submission

Choose one before recording:

- **Track A — Honest scoped claim:** Show MagicBlock PER as proven ecosystem evidence from current/legacy path plus fallback semantics; state Quasar-native PER is next/approval-gated. This is safest and likely sufficient if time is tight.
- **Track B — Stronger live claim:** Seek explicit approval for bounded live devnet/PER validation against Quasar-compatible flows. Requires exact commands, max tx/call count, wallet/program IDs, rollback, evidence output, and failure criteria before execution.

Recommendation until Nissan approves live PER: Track A.

### Phase 14.4 — x402/OpenRouter economic workflow alignment

- Keep x402/OpenRouter demo as the economic workflow centerpiece, but label settlement status precisely:
  - unpaid challenge: real `402 + x402-request`;
  - controlled demo-paid completions: demo receipts unless real verifier enabled;
  - real settlement: only if a receipt verifier/signing path is approved and validated.
- Ensure `/economic-demo`, judge packet, and video script use the same language.

### Phase 14.5 — Jupiter/Torque/framework visibility pass

- Jupiter: include tested SOL→USDC/Jupiter invoke evidence if final demo mentions cross-token settlement; do not imply live production swap unless approved and run.
- Torque: include retention/leaderboard telemetry only as supporting layer unless a sidetrack requires it.
- ElizaOS/SendAI: include as framework integration/distribution proof, not core on-chain proof.

### Phase 14.6 — Final recording readiness gate

Before recording, verify:

1. Quasar devnet A/B/C registrations exist or the script explicitly says registration is approval-gated/not yet performed.
2. Web app target cards and operator checklist say Quasar program ID first.
3. x402 evidence panel shows challenge/receipt status accurately.
4. MagicBlock/PER wording matches Track A or Track B.
5. Legacy Anchor evidence is visually labeled “reference/history only.”
6. Final judge packet has a one-page proof map: Quasar proof, MagicBlock proof, x402 proof, Jupiter proof, OpenRouter proof, Surfpool proof.

**Plan adjustment:** Phase 13’s “scoped proof is enough” posture is now superseded for recording readiness. Scoped proof remains a safe fallback, but the active plan is Quasar-first demo readiness with explicit ecosystem-product proof mapping.

## Critical Success Factor Reset — Full Quasar or not done

Nissan corrected the goal on 2026-05-06: the final Colosseum Frontier goal is **not** satisfied by scoped Quasar proof, Quasar-compatible builders, or legacy Anchor evidence with honest caveats. The goal is achieved only when the final demo is fully using Quasar-compiled Solana programs for every demo-critical on-chain path.

### Non-negotiable success factors

1. **No demo-critical Anchor path.** Legacy Anchor code, tests, and artifacts may remain as historical/reference material only. They must not power the final demo, screenshots, judge packet, operator flow, or readiness claim.
2. **Quasar-native multi-program target.** Final demo surfaces must use the Quasar devnet program inventory:
   - Escrow: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`
   - Registry: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
   - Reputation: `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`
   - Attestation: `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`
3. **Full A→B→C demo path is Quasar-native.** The demo-agent full flow cannot be excluded as “legacy/reference only” if it is part of the final story. It must be ported to Quasar or replaced with an equivalent Quasar-native full-flow demo.
4. **MagicBlock/PER is not punted.** If MagicBlock PER is claimed in the final demo, it must be validated against the Quasar-native path. If it cannot be validated, it must be removed from final on-chain claims rather than described as future work.
5. **CI blocks premature readiness.** `submissionReady=true` is forbidden while any of the above are incomplete.

### Immediate plan adjustment

Phase 14’s scoped-proof fallback is superseded as a final readiness strategy. Keep the Quasar Registry registration evidence, but mark the final submission blocked until Phase 15 ports/replaces the full demo-critical flow and validates or removes the MagicBlock PER final claim.

## Phase 15 — Full Quasar critical-success closure 🟡 active

**Expectation:** The final demo achieves the actual goal: no demo-critical Anchor path remains.

**BDD scenarios:**

- Given the final demo uses on-chain registration, discovery, escrow, settlement, reputation, or attestation, when the demo is run, then each transaction/read must target the matching Quasar program ID, not the legacy Anchor program.
- Given the A→B→C demo flow is part of the submission story, when `DEMO_PROGRAM_TARGET=quasar`, then the flow must run or fail only on a real Quasar blocker, not because it is intentionally excluded.
- Given MagicBlock PER is a bounty/ecosystem product, when it appears in the final demo claim, then the evidence must show Quasar-native PER/TEE validation or the claim must be removed.
- Given `submissionReady=true`, when CI runs, then the critical success guard must pass and find no scoped-proof/future-work punt.

**Active blockers:**

1. `packages/demo-agents/src/demo.ts` is still a legacy Anchor full-flow/PER script and is now a blocker, not an acceptable exclusion.
2. Quasar-native escrow/settlement/MagicBlock PER validation is not complete.
3. Some public surfaces still need copy/ID cleanup so they cannot visually imply the legacy Anchor program is the active demo state.

**Validation gate:** `npm run check:quasar:critical-success` must pass before final readiness can be restored.

### Phase 15 — Full Quasar critical-success closeout (2026-05-06)

- **Expectation:** The final Colosseum demo cannot rely on a scoped Quasar proof or a legacy Anchor full-flow script. `packages/demo-agents/src/demo.ts` must execute a Quasar-native A→B→C path, and MagicBlock PER/TEE must be either live-validated on Quasar or explicitly removed from final claims.
- **Implementation:** Ported `packages/demo-agents/src/demo.ts` to explicit Quasar mode with Quasar multi-program IDs: registry `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`, escrow `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`, reputation `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`, and attestation `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`. Quasar mode uses escrow make/take public settlement, reputation commit/reveal, and attestation attest. MagicBlock PER/TEE now fails closed/not claimed for the Quasar final path.
- **Validation:** `DEMO_PROGRAM_TARGET=quasar DEMO_SETTLEMENT_MODE=public npm run demo --prefix packages/demo-agents` PASS in 8106ms. Escrow lock tx `njfAs12qtYD9P1Y1FpdPpwBPPwYgaihSNpWNGVVU7xT5oJDCFbBQmk9eqPHdRoYSrq8vaiw6pXs48oiXnadu7qQ`; settlement tx `29Hp6YKgBsWHnA9SwtEky4dc6UvKQcu4e7msSTkRPd3e3j1pxibzCz5pyXhVj4L1BDCLAqZm6YBrnyCYNH6iz8JS`; rating PDA `39M7XcFaTXmEmkrBLxRZpmVHRXD79GwbpRPVWbAkftgu`; attestation PDA `9YaMF1Wd2N9o2AxQeGsvdB8Yv7RH7WqiVpMTdHvexNTK`. `npm run check:quasar:submission` PASS. `npm run build` PASS.
- **Retrospective:** The earlier scoped-proof boundary was too weak for the user’s actual goal. The hard gate caught the issue and prevented a premature “ready” claim. The honest final boundary is now: Quasar-native registry/escrow/reputation/attestation demo is ready; MagicBlock PER/TEE is not claimed in the final Quasar path without a separate live validation loop.
- **Plan changes for next phase:** PR #244 can be reviewed as final Quasar critical-success work once GitHub checks are green. Do not reintroduce Anchor as a final-demo proof path; preserve legacy Anchor only as historical comparison.


### Retrospective — Surfpool Quasar localnet gate

- **Expected:** Existing Surfpool localnet tests would prove the final Quasar-native demo path before devnet rehearsal.
- **Observed:** The existing `test:surfpool:critical` smoke still deployed and exercised the legacy Anchor escrow path (`Target: legacy-anchor`). That was useful regression coverage but not aligned with the final Colosseum goal.
- **Implementation adjustment:** Added `scripts/run-surfpool-quasar-critical-smoke.sh` and `npm run test:surfpool:quasar-critical`. The new gate starts Surfpool, locally deploys Quasar escrow/registry/reputation/attestation programs, patches local `declare_id!` values only for the local build/deploy artifact, restores sources on exit, registers A/B/C with the local Quasar Registry, and runs the A→B→C demo with `DEMO_PROGRAM_TARGET=quasar`.
- **Validation:** `npm run test:surfpool:quasar-critical` PASS; `npm run check:quasar:submission` PASS; `npm run test:bdd:index` PASS; `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar npm run build` PASS.
- **What worked:** Surfpool caught a real local-only bug: deploying Quasar programs under generated local program IDs while leaving source `declare_id!` values unchanged caused owner-check failure during escrow release. The new script now catches and avoids that by aligning local declared IDs with local deploy keypairs.
- **What failed / surprised us:** The legacy Surfpool smoke was named “critical” but was not Quasar-critical; final-demo confidence must use the new Quasar-specific gate.
- **Safety / approval review:** Local validator only. No devnet signing, deregistration, deployment, env mutation, paid call, or live PER/TEE claim.
- **Decision:** continue. Devnet A/B/C Quasar Registry accounts already exist; legacy Anchor registrations can remain as reference unless Nissan explicitly approves cleanup.
- **Plan changes for next phase:** Before live demo recording, run the Quasar Surfpool gate, read-only devnet PDA check, Quasar submission guard, and Quasar-target web build. Then proceed to approval-gated devnet/testnet rehearsal only if needed.
