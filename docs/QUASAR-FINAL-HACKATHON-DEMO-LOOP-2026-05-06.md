# Quasar Final Hackathon Demo Loop — 2026-05-06

> **DATED campaign record — superseded 2026-10-02.** The goals, commands, deployment actions, and approvals below describe the May 2026 campaign and are retained unchanged as provenance; they are not current instructions or authorization. Quasar is frozen, its recorded deployment is blocked, and no live demo/redeployment is planned. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

## Controlling goal

The Colosseum Frontier submission is successful only if the final demo moves from legacy Anchor-compiled Solana programs to Quasar-compiled Solana programs for every demo-critical on-chain path, while visibly using the identified ecosystem/bounty products in the demo story: MagicBlock, x402, Jupiter, OpenRouter specialist agents, Surfpool, and supporting products where evidence exists.

Legacy Anchor code may remain in the repository as historical/reference material only. It must not power the final recording, judge packet, web-app active state, or readiness claim.

## Approval boundary

Nissan approved devnet transactions as needed to reach the Quasar-final-demo goal on 2026-05-06. Still approval-gated unless separately approved: mainnet transactions, paid provider calls, production env/Coolify/Vercel mutation, real image generation, and live MagicBlock PER/TEE claims if they require external secrets or paid infrastructure.

## Required program target

Final demo-critical transactions/readbacks target the Quasar multi-program deployment:

- Escrow: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`
- Registry: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
- Reputation: `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`
- Attestation: `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`

## Phase 0 — Alignment and CI state

**Expectation:** The plan, CI, and web/demo framing are Quasar-first. Anchor CI is gone. Quasar gates are the program proof.

**BDD scenario:**

- Given a reviewer opens PR #244, when they inspect required proof gates, then the active program gates are Quasar Program Tests and Quasar readiness, not Anchor build/test.

**Current observations:**

- `.github/workflows/anchor-test.yml` has been removed.
- `Quasar Program Tests (QuasarSVM / LiteSVM)`, `quasar-readiness`, `bdd-index-guard`, `source-conformance-matrix`, and Vercel are the relevant PR gates.
- Stage-1/stage-2 audit response docs exist and regression tests cover immediate hardening.

**Retrospective:** The plan is aligned on program target but docs were split across several artifacts. This file is now the single loop plan for final recording readiness.

**Plan adjustment:** keep this file updated after each phase; every phase ends with a retrospective and next-loop adjustment.

## Phase 1 — Surfpool Quasar localnet confidence

**Expectation:** Local Surfpool proves the Quasar-native flow before any devnet/testnet signing.

**BDD scenarios:**

- Given Surfpool localnet is running, when `npm run test:surfpool:quasar-critical` runs, then it deploys local Quasar programs, aligns local declared IDs with deploy IDs, registers A/B/C locally, and runs the Quasar A→B→C demo path.
- Given local Quasar Surfpool is green, when we move to devnet rehearsal, then bugs caught locally are already fixed.

**Commands:**

```bash
npm run test:surfpool:quasar-critical
npm run check:quasar:critical-success
npm run test:bdd:index
NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar npm run build
```

**Retrospective:** complete. Surfpool found a real bug before devnet: reputation reveal failed after audit hardening because the demo-agent commitment hash still used the old `score || salt` format while Quasar now verifies `score || salt || job_id || program_id`. Patched `packages/demo-agents/src/demo.ts` and `lib/onboarding/reputation-signal.ts` to use the Quasar domain-separated commitment. Re-ran focused Quasar TS tests and the full Surfpool Quasar critical smoke. Result: PASS. Local A→B→C completed twice, including public settlement and PER-requested fail-closed/fallback boundary.

**Plan adjustment:** continue to devnet rehearsal. Add commit-hash compatibility to final proof notes; do not record until devnet uses the same patched Quasar commitment path successfully.

## Phase 2 — Devnet Quasar registration/readback and demo-agent rehearsal

**Expectation:** Devnet A/B/C registration/readback is Quasar-native and stale Anchor registrations are harmless reference state. Deregister legacy Anchor accounts only if they actively confuse the demo or block target-aware readback; do not mutate legacy state just for cleanliness.

**BDD scenarios:**

- Given `DEMO_PROGRAM_TARGET=quasar`, when the readback/inspection script runs, then it reads Quasar Registry PDAs for A/B/C and reports them present.
- Given the demo-agent script runs with `DEMO_PROGRAM_TARGET=quasar HACKATHON_DEMO_TARGET=quasar`, then the A→B→C path uses Quasar Registry/Escrow/Reputation/Attestation IDs.
- Given legacy Anchor A/B/C accounts exist, when final demo target flags are Quasar, then legacy accounts are not selected or displayed as active proof.

**Commands:**

```bash
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/check-devnet-agent-pdas.ts
DEMO_PROGRAM_TARGET=quasar HACKATHON_DEMO_TARGET=quasar DEMO_SETTLEMENT_MODE=public DEMO_STOP_AFTER_SETTLEMENT=true npm run demo --prefix packages/demo-agents
```

**Retrospective:** complete. Devnet readback confirmed legacy Anchor A/B/C still exist but Quasar Registry A/B/C are present and selected by Quasar target flags, so legacy deregistration is not needed for correctness. First devnet rehearsal failed at reputation reveal, while local Surfpool passed. Root cause: devnet Quasar Reputation was still the pre-audit deployment; local Surfpool had the audit-hardened code. Upgraded devnet Reputation program `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6` with authority `d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR`, deploy tx `24bf49dnB9YCiqS6uT21jnQHRy9RveTquffBSNjhUpeHPE663kf7PEMCMch5k4ZR9sADxYUWvVijufEN993PVzqg`. Re-ran the full devnet Quasar A→B→C demo: PASS in 6516ms, escrow lock tx `22XLto6VVbfYGZfRPvR65KNVEyztw4HAm1c7gPbWNXWpcNbqBdtNHFpAEeGL4L8T6UodT2fxan4yxYdPNb8hDzhx`, settlement tx `4bhPXA3SCDM1CQKBHMVxKFiGtfcmqnNEnTFDpEW2i85DWiE9dFr3co7h5EUL2ysqMs3ctcFmHfu8fpjefzpzz1JJ`, rating PDA `cwBzEz3p26mKU7FGWQWDkkmKY8j8NG4iPgruSkVJqKz`, attestation PDA `G2hmyNWC3N8zdqKRNgzgr7z6sN8wxJtc9YjpYmoWgzT1`.

**Plan adjustment:** continue to web-app final-demo readiness. Preserve legacy registrations as reference only; do not deregister unless UI/readback ambiguity appears.

## Phase 3 — Web-app final-demo readiness

**Expectation:** Human-triggered demo surfaces clearly show Quasar target and the identified bounty/product proof map.

**BDD scenarios:**

- Given a human opens the sample frontend, when they use the demo trigger surface, then the visible program target is Quasar and not legacy Anchor.
- Given the 30 OpenRouter specialist profiles are shown or invoked, when the demo narrates agent-to-agent payments, then x402 challenge/receipt/disclosure evidence is visible and not overclaimed as hidden paid live spend unless the live verifier is explicitly enabled.
- Given MagicBlock, Jupiter, Surfpool, and OpenRouter appear in the demo, when the judge asks what is live vs supporting evidence, then the UI/script answers with exact proof boundaries.

**Commands:**

```bash
NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar npm run build
npm run check:quasar:submission
npm run check:quasar:critical-success
```

**Retrospective:** complete for build-level readiness. `npm run check:quasar:critical-success` passed, `npm run test:bdd:index` passed, and `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar npm run build` passed. Existing Next/Turbopack warnings remain about multiple lockfiles and broad evidence-pack file tracing; they do not block the Quasar demo but should not be mistaken for new failures.

**Plan adjustment:** continue to proof-map/judge packet and final recording rehearsal. Web app is build-ready with Quasar target; still inspect the human-triggered demo surface before recording to ensure copy does not visually imply Anchor is active.

## Phase 4 — Bounty/product proof map and recording packet

**Expectation:** The final recording script and judge packet show a one-page proof map:

- Quasar: live program IDs + CI + Surfpool + devnet readback/demo-agent txs.
- Surfpool: local Quasar confidence before devnet.
- x402: payment challenge/receipt/disclosure workflow.
- OpenRouter: 30 specialist agent marketplace/profile evidence.
- Jupiter: tested cross-token/invoke lane, live swap only if separately approved/run.
- MagicBlock: fail-closed/not claimed unless live PER/TEE validation succeeds; otherwise framed as supporting/future-proof lane, not final on-chain claim.

**Retrospective:** pending after packet generation.

## Phase 5 — Final rehearsal and recording

**Expectation:** A human action starts the frontend demo, then the recording walks through Quasar on-chain proof and bounty/product proof without Anchor fallback or overclaiming.

**BDD scenarios:**

- Given final recording env vars are set to Quasar, when the demo is run, then every demo-critical Solana path uses Quasar IDs.
- Given any external paid/live product is not run, when it appears in narration, then it is labelled as supporting evidence or fail-closed rather than live settlement proof.

**Retrospective:** pending after rehearsal recording.
