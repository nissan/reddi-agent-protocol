# Bounty Gap Closure Plan — 2026-05-08

> **Superseded by RAP Assurance claim remediation.** This hackathon plan is historical and must not be used for current public claims. Use `docs/PUBLIC-CLAIM-BOUNDARY.md`: payments prove transfer; RAP Assurance proves paid work. Quasar, MagicBlock, AUDD, marketplace, production, and mainnet claims below are archived context unless re-proven by current shipped behavior.

## Purpose

Build a fair, claim-safe plan to close the remaining hackathon bounty gaps for Reddi Agent Protocol before final recording/submission.

Current clean baseline: `main` at `338b6906` (`docs: refresh final readiness status (#279)`).

## Executive verdict

We are close to a strong, defensible submission, but the remaining work is not evenly distributed.

- **Quasar:** historical hackathon assessment only. Current `config/quasar/deployments.json` blocks the recorded devnet deployment (`submissionReady: false`).
- **MagicBlock:** strong for the bounded Quasar-owned AgentVault route. Do not claim arbitrary-wallet/private payee settlement.
- **Pay.sh / `reddi-x402`:** strong for single-charge sandbox compatibility. Do not claim session/split settlement.
- **Umbra:** strong adapter + devnet encrypted-balance evidence; receiver-claimable UTXO devnet-only evidence is being aligned into the closure PR and may be featured with strict devnet-only boundaries.
- **Torque:** credible story already exists through reputation/ranking events and leaderboard UI, but needs a recording/evidence beat to become bounty-strong.
- **30 specialists / OpenRouter runtime:** configured, tested, devnet-registered, and have hosted Coolify endpoint evidence; `docs/OPENROUTER-30-SPECIALIST-READINESS-2026-05-08.md` now captures the boundary that the May 6 inventory verified 30/30 hosted manifests and unpaid x402 challenge endpoints, while production-paid settlement readiness still requires a fresh endpoint/funding/secrets/live paid-call pass.
- **Jupiter:** keep as bounded payment-flexibility/simulation/research lane only unless mainnet execution is approved. No reliable public devnet swap claim.

## Fair bounty-by-bounty assessment

### 1. Quasar — Green

What we have:
- Final demo-critical on-chain path uses Quasar-compiled programs.
- Quasar Registry, Escrow, Reputation, and Attestation program IDs are documented in `STATUS.md`.
- Critical success and submission guards exist.

Historical safe claim at the time:
- “Reddi Agent Protocol demonstrates a Quasar-native agent marketplace flow across registration, escrow/payment, reputation, and attestation.”

Current public copy must instead say that Quasar is local/blocked reference evidence unless a new deployment and review supersede `config/quasar/deployments.json`.

Remaining gap:
- None for a fair submission. Only keep the final recording on the documented Quasar path and rerun gates.

Close-out work:
1. Rerun `npm run check:quasar:critical-success`.
2. Rerun `npm run check:quasar:submission` if final packet changes.
3. Keep claim-boundary checker green.

### 2. MagicBlock — Green / bounded

What we have:
- Quasar-native MagicBlock PER/TEE route is proven for the **Quasar-owned AgentVault** path.
- Decisive settlement smoke exists with `ok=true`, `baseVaultSettled.ok=true`, and `withdrawAfterSettlementResult.ok=true`.
- Claim docs now separate agent-vault settlement from arbitrary-wallet/private payee settlement.

Safe claim:
- “MagicBlock PER/TEE powers bounded private delegated execution and settlement into a Quasar-owned AgentVault route.”

Do not claim:
- Arbitrary wallet/private payee lamport settlement.
- General private settlement for any wallet.

Remaining gap:
- If we want an even broader MagicBlock claim, build delegated-payee or private-payee design/proof. This is not required for a fair current submission and is risky to chase late.

Close-out work:
1. Keep current bounded claim language.
2. Include only AgentVault proof in final recording packet.
3. Rerun `npm run check:submission:claim-boundaries`.

### 3. Torque — Yellow, high-upside and quick to strengthen

What we have:
- Torque event vocabulary in `lib/torque/events.ts`: specialist job completed, consumer query run, onboarding completed, rating submitted.
- Reputation commit/reveal flow calls Torque event emission for rating/reputation activity.
- `/leaderboard` presents specialist rankings as Torque-powered.
- Current tests pass: `lib/__tests__/torque-client.test.ts`, `torque-event-route`, `torque-leaderboard-route`, `torque-onboarding-event` — 4 suites / 17 tests.

Safe claim today:
- “Reddi Agent Protocol converts real protocol activity into Torque-compatible reputation and retention signals: completed jobs, query runs, onboarding milestones, and ratings feed specialist rankings.”

Do not claim yet:
- Live production rewards campaign.
- Paid incentives distributed through Torque.
- Sponsor-side campaign fully launched unless credentials/evidence prove it.

Remaining gap:
- We need a concise evidence artifact and recording beat tying reputation rankings to Torque. Right now the code/tests exist, but the final recording packet does not foreground the story strongly enough.

Close-out work:
1. Generate a Torque reputation/ranking evidence artifact from deterministic or sandbox data.
2. Add a final recording beat: show completed/rated specialist → Torque event evidence → leaderboard/ranking update.
3. Update bounty audit/final packet with bounded Torque language.
4. Add/verify a guard that blocks “live rewards campaign” overclaims.
5. Rerun Torque tests and final claim-boundary checks.

Recommended owner/sequence:
- Do this before expanding Umbra; it is a likely quick bounty-story win.

### 4. Umbra — Yellow/Green depending on feature scope

What we have on current final baseline:
- Umbra SDK/prover import verification.
- Adapter contract and dependency-injected receiver-claimable UTXO tests.
- Bounded devnet encrypted-balance deposit evidence.
- Final packet currently claims adapter + devnet encrypted-balance deposit only.

Newly aligned closure evidence:
- Successful devnet-only receiver-claimable UTXO create→scan→claim evidence is included at `artifacts/umbra-devnet-receiver-claimable-utxo/20260507T092405Z/SUMMARY.json` / `.md`.
- Evidence includes create txs, relayer claim txs, selected UTXO `0:813`, and receiver encrypted wSOL balance moving from `497867` to `995734` base units.

Safe claim after this closure PR:
- “Umbra private-payment adapter, bounded devnet encrypted-balance deposit, and devnet-only receiver-claimable UTXO create→scan→claim evidence are implemented.”
- “A devnet-only receiver-claimable UTXO create→scan→claim path was proven, with receiver encrypted balance updated.”

Do not claim:
- Mainnet/live-production Umbra settlement.
- Quasar-native Umbra execution.
- Production private x402 settlement.

Remaining gap:
- Keep final gates green after alignment.
- Keep wording devnet-only and do not broaden into mainnet/live-production private settlement, Quasar-native Umbra execution, MagicBlock PER settlement, or general arbitrary receiver/payee settlement.

Close-out work:
1. Reintroduce the receiver-claimable UTXO helper/test/smoke script and artifact onto the closure branch.
2. Verify artifact paths and package script.
3. Rerun `npx jest --runTestsByPath lib/__tests__/umbra-receiver-claimable-utxo.test.ts --runInBand`.
4. Rerun `npm run check:umbra:sdk-imports`, `npm run check:umbra:adapter-imports`, and `npm run check:final-recording`.
5. Update final recording packet/handoff/bounty audit with devnet-only wording.
6. Revert timestamp-only Umbra evidence churn after final checks unless intentionally refreshing artifacts.

### 5. Pay.sh / `reddi-x402` — Green / bounded

What we have:
- Pay.sh CLI installed.
- Sandbox single-charge compatibility evidence exists.
- `reddi-x402` naming/product guard exists.
- Session/split probes exist but are blocked extensions.

Safe claim:
- “Reddi Agent Protocol exposes `reddi-x402` compatible agent-paid API/payment evidence via Pay.sh sandbox single-charge flow.”

Do not claim:
- Session/split settlement success.
- Mainnet paid settlement.

Remaining gap:
- None for bounded submission. Optional: one short recording beat showing 402 → payment receipt → downstream readiness.

Close-out work:
1. Keep single-charge Pay.sh evidence in final packet.
2. Keep session/split as blocked extension.
3. Rerun `npm run check:pay-sh:provider-spec`, `npm run check:pay-skills:registry`, and final gates if touched.

### 6. 30 specialists / OpenRouter runtime — Yellow/Green depending on claim

What we have:
- `manifest:parity` passes with 30 profiles checked.
- `packages/openrouter-specialists` tests pass: 54/54.
- Historical devnet registration artifact shows all 30 specialists registered/already registered with no errors.
- Hosted manifest parity had previously reached 30/30 current endpoints in Phase 4 evidence.

Latest caveat:
- Current `deployment:readiness` reports `blocked` for all 30 because the env-less preflight requires public endpoints/Coolify deployment/funding/deployment confirmations under the latest checker.
- This does **not** mean endpoints are absent: May 6 inventory verified hosted Coolify endpoint responsiveness for 30/30 well-known manifests and 30/30 unpaid x402 challenges.
- Closure note added: `docs/OPENROUTER-30-SPECIALIST-READINESS-2026-05-08.md`.

Safe claim:
- “All 30 specialist profiles are configured, manifest-valid, tested, devnet-registered, and have hosted Coolify endpoint evidence for well-known manifests and unpaid x402 challenges.”

Do not claim unless revalidated:
- “All 30 are production-paid settlement endpoints with freshly confirmed funding, production secrets, and live paid downstream calls.”

Remaining gap:
- Decide if the submission needs live hosted all-30 proof or if configured/devnet-registered specialist marketplace proof is enough.
- If live all-30 is needed, refresh endpoint/Coolify/funding readiness and rerun hosted smoke.

Close-out work:
1. Add an explicit “30 specialists: configured vs hosted-live” note to final packet. ✅
2. If we want live-hosted claim: configure/confirm public endpoints, Coolify deployments, funding, and rerun hosted manifest smoke.
3. Rerun `npm --prefix packages/openrouter-specialists run manifest:parity` and `npm --prefix packages/openrouter-specialists test`.
4. Do not run paid live specialist calls without explicit approval.

### 7. Jupiter — Red for devnet execution, okay as boundary/supporting lane

What we have:
- Research found public Jupiter devnet swap execution is not reliable because APIs return mainnet-routed liquidity/account material.
- Final docs already keep Jupiter as a bounded lane.

Safe claim:
- “Jupiter is represented as payment-flexibility/swap-readiness research and UI/proof-boundary evidence.”

Do not claim:
- Successful public Jupiter devnet swap.
- Live/mainnet Jupiter swap.
- Judge wallet charged.

Remaining gap:
- Only closable with explicit mainnet approval or by keeping it as simulation/boundary evidence.

Recommendation:
- Do not chase Jupiter before submission. Keep it bounded.

## Closure plan

### Phase A — Lock the claim matrix (low risk, mandatory)

Deliverables:
- Update bounty audit/final packet with a single matrix: Quasar, MagicBlock, Torque, Umbra, Pay.sh, Specialists, Jupiter.
- Add exact “claim / do not claim / evidence / gap” language.

Validation:
- `npm run check:submission:claim-boundaries`
- `npm run check:product:naming`
- `git diff --check`

Exit criteria:
- No overclaim language remains in final packet, handoff, bounty audit, proof hierarchy, or submission prep.

### Phase B — Strengthen Torque story (recommended quick win)

Deliverables:
- `artifacts/torque-reputation-ranking/20260508*/SUMMARY.{json,md}` or equivalent deterministic evidence.
- Recording script beat: “rating submitted → Torque-compatible event → specialist leaderboard/ranking.”
- Update `docs/TORQUE-BDD-FEATURE-MAP.md` or final packet with a bounded “reputation rankings powered by Torque signals” claim.

Validation:
- Torque focused tests: `npx jest lib/__tests__/torque-client.test.ts lib/__tests__/torque-event-route.test.ts lib/__tests__/torque-leaderboard-route.test.ts lib/__tests__/torque-onboarding-event.test.ts --runInBand`
- Final claim-boundary checker.

Exit criteria:
- Torque is no longer a buried integration; it has a visible, defensible judge story.

### Phase C — Merge/align Umbra receiver-claimable UTXO proof (recommended if we want Umbra bounty strength)

Deliverables:
- Bring successful receiver-claimable UTXO devnet smoke proof onto current main.
- Update final packet/handoff from “not claimed” to “devnet-only receiver-claimable UTXO smoke proven,” if and only if the artifact is merged and guards pass.
- Keep mainnet/live-production private settlement out of scope.

Validation:
- `node --check scripts/run-umbra-devnet-receiver-claimable-utxo-smoke.mjs`
- `npx jest --runTestsByPath lib/__tests__/umbra-receiver-claimable-utxo.test.ts --runInBand`
- `npm run check:umbra:sdk-imports`
- `npm run check:umbra:adapter-imports`
- `npm run check:final-recording`
- `git diff --check`

Exit criteria:
- Receiver-claimable UTXO proof is either merged and claimable as devnet-only, or explicitly excluded from final claims.

### Phase D — Clarify 30-specialist readiness (mandatory wording, optional live refresh)

Deliverables:
- Add a short readiness note distinguishing:
  - configured/tested/devnet-registered = yes;
  - all hosted production live endpoints = only claim if freshly revalidated.
- Optional hosted-live refresh if necessary.

Validation:
- `npm --prefix packages/openrouter-specialists run manifest:parity`
- `npm --prefix packages/openrouter-specialists test`
- If live refresh: deployment readiness + hosted manifest smoke, no secrets in artifacts.

Exit criteria:
- Submission cannot be read as “30 paid production specialists live” unless that is freshly proven.

### Phase E — Final recording/submission gate

Deliverables:
- Final packet, handoff, runbook, bounty audit, proof hierarchy, and submission prep all aligned.
- One concise recording path with optional appendices:
  1. Quasar-native marketplace core.
  2. Pay.sh / `reddi-x402` single-charge compatibility.
  3. MagicBlock bounded AgentVault private delegated settlement.
  4. Torque reputation rankings.
  5. Umbra private-payment lane, with receiver-claimable devnet proof only if merged.
  6. 30 specialist configured/devnet registration proof.
  7. Jupiter boundary note.

Validation:
- `npm run check:final-recording`
- `npm run check:submission:claim-boundaries`
- `npm run check:product:naming`
- `npm --prefix packages/openrouter-specialists run manifest:parity`
- `npm --prefix packages/openrouter-specialists test`
- Torque focused tests
- Umbra focused tests if Umbra receiver-claim proof is included
- `git diff --check`

Exit criteria:
- Clean main via PR.
- Final recording can proceed without adding new claims verbally.

## Recommended priority order

1. **Torque evidence/recording beat** — fastest high-upside improvement.
2. **Umbra receiver-claimable proof merge/alignment** — high value, but must be claim-boundary careful.
3. **30-specialist wording/readiness clarification** — mandatory for honesty; live refresh optional.
4. **Final claim matrix and gates** — mandatory before recording.
5. **Do not chase Jupiter mainnet or arbitrary-wallet MagicBlock settlement** unless Nissan explicitly decides to spend time/risk there.

## Approval gates

Need Nissan approval before:
- Any mainnet transaction.
- Any paid/live specialist downstream call.
- Any Coolify/Vercel/environment mutation for live hosted endpoints.
- Any devnet wallet mutation beyond already-approved bounded workstreams.
- Any irreversible account/program close or treasury action.

## Definition of done

- One merged PR with the closure plan implementation docs/evidence updates.
- Final checks green.
- `STATUS.md` updated with exact resume point and any remaining excluded claims.
- Recording script has no overclaims and points to concrete evidence artifacts.
