# Quasar Final Demo Eligibility Matrix — 2026-05-06

> **DATED campaign matrix — superseded 2026-10-02.** The classifications, recommendations, and commands below record the May 2026 campaign; they are not current eligibility or operating guidance. Quasar is frozen and the recorded deployment is blocked. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

## Goal

Move the Colosseum Frontier submission from legacy Anchor-compiled program evidence to Quasar-compiled Solana program evidence, while visibly using the identified ecosystem/bounty products: MagicBlock, x402, Jupiter, OpenRouter specialist agents, Surfpool, and supporting integrations such as Torque/ElizaOS/SendAI where the evidence exists.

## Classification rules

- `quasar-live-ready`: executed or read against the Quasar devnet program `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`.
- `quasar-local-compatible`: Quasar-compatible construction/read/decode/readiness proven locally, but not yet signed on devnet.
- `ecosystem-supporting-evidence`: supports the demo/product stack but is not direct Quasar program proof.
- `legacy-reference-only`: Anchor-era evidence retained only as historical/reference proof.

## Matrix

| Demo/evidence surface | Current classification | What it proves | Gap before final recording | Required framing |
| --- | --- | --- | --- | --- |
| Quasar program target/readiness guard | `quasar-local-compatible` | App/runtime selects Quasar devnet program; guard blocks stale Anchor proof | Register/read back demo agents on Quasar devnet for stronger live proof | “Quasar is the hackathon target; readiness guard passes for scoped proof.” |
| `/register` Quasar transaction builder | `quasar-local-compatible` | Registration instruction construction no longer uses Anchor encoding in Quasar mode | Approval-gated signed devnet registration | “Ready to register against Quasar; live txs require approval.” |
| Demo-agent A/B/C registration | `quasar-local-compatible` → target `quasar-live-ready` after approval | A/B/C can be registered under Quasar program | A/B/C currently absent under Quasar; legacy Anchor A/B/C exist | “Next signed step is Quasar registration; legacy Anchor is reference only.” |
| Quasar AgentAccount read/decode | `quasar-local-compatible` | Web/read paths use Quasar account discriminator/layout in Quasar mode | Needs live Quasar PDA readback after registration | “Decode path is Quasar-compatible; readback becomes proof after registration.” |
| Reputation commit/reveal + attestation confirm/dispute builders | `quasar-local-compatible` | Demo-critical reputation/attestation transaction construction routes to Quasar helpers | Live signed execution not yet approved | “Quasar-compatible builders exist; live tx proof pending approval.” |
| Full `packages/demo-agents/src/demo.ts` A→B→C/PER script | `legacy-reference-only` | Historical full-flow escrow/PER/Jupiter/reputation/attestation shape | Not eligible as Quasar proof; fails closed in Quasar mode | “Reference only; not final Quasar proof.” |
| MagicBlock PER happy path/fallback evidence | `ecosystem-supporting-evidence` | MagicBlock PER client/fallback story and prior proof | Quasar-native live PER not yet approved/proven | “MagicBlock is part of the stack; Quasar-native PER is approval-gated unless Track B is run.” |
| x402/OpenRouter 30 specialist workflow | `ecosystem-supporting-evidence` | Real fail-closed x402 challenges, controlled demo-paid completions, agent marketplace/delegation | Real receipt verifier/signing path not enabled unless separately approved | “Economic workflow proof; settlement status is controlled-demo unless real verifier is run.” |
| Jupiter SOL→USDC/cross-token settlement evidence | `ecosystem-supporting-evidence` | Cross-token settlement logic and tested Jupiter invoke lane | Live production swap not claimed unless approved/run | “Jupiter integration evidence; do not overclaim live swap.” |
| Surfpool Quasar critical smoke | `quasar-local-compatible` | Local Surfpool deploys and exercises Quasar escrow/registry/reputation/attestation before devnet rehearsal | Re-run before final recording after audit/CI changes | “Local Quasar confidence before devnet; catches program-ID/deploy mismatches early.” |
| Torque retention/leaderboard | `ecosystem-supporting-evidence` | Supporting retention/engagement layer | Needs final script mention only if relevant | “Supporting ecosystem layer.” |
| ElizaOS/SendAI integrations | `ecosystem-supporting-evidence` | Framework distribution/integration proof | No final on-chain proof role | “Framework integration proof, not Quasar proof.” |

## Recording readiness requirements

Before recording the final hackathon demo:

1. Show Quasar program ID first everywhere: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`.
2. Do not show legacy Anchor program `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD` as the active hackathon proof.
3. Prefer approval-gated Quasar A/B/C devnet registration and readback before recording.
4. If MagicBlock PER is shown without live Quasar PER validation, narrate it as ecosystem-supporting evidence and future/approval-gated Quasar PER parity.
5. If x402 paid completions are shown, distinguish unpaid challenges, controlled demo receipts, and real settlement.
6. If Jupiter is shown, tie it to the tested invoke/cross-token evidence and avoid claiming live swap unless separately run.
7. Add a proof-map slide/panel: Quasar proof, MagicBlock proof, x402 proof, Jupiter proof, OpenRouter proof, Surfpool proof.

## Recommendation

The plan should now be Quasar-first, not scoped-proof-first:

1. Keep PR #244 as the Quasar compatibility/readiness foundation.
2. Get explicit approval for Quasar devnet A/B/C registration.
3. Make the web app and judge packet show Quasar live readback as the primary on-chain proof.
4. Use MagicBlock/x402/Jupiter/OpenRouter/Surfpool as clearly labeled supporting ecosystem proofs unless a stronger approval-gated live validation lane is executed.

## Phase 14 update — Quasar Registry devnet proof promoted from planned to complete

Status: complete after Nissan approval.

- Demo agents A/B/C are registered under the Quasar Registry program `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`.
- Evidence artifact: `artifacts/quasar-devnet-registration/20260505T211525Z/SUMMARY.md`.
- The final demo plan must present Quasar as a multi-program deployment, not as a single `VYCb...` program:
  - Escrow: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`
  - Registry: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
  - Reputation: `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`
  - Attestation: `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`
- Scoped proof fallback remains available, but final-demo registry proof is now live Quasar devnet proof.
- Live MagicBlock PER/TEE execution is still not claimed by this update.

## Critical Success Factor Reset — 2026-05-06

Nissan clarified that scoped Quasar proof is not enough. The final demo is ready only when every demo-critical on-chain path is fully Quasar-native.

Changes to eligibility:

- `legacy-reference-only` is allowed only for historical comparison, never as final demo proof.
- The full A→B→C demo-agent flow is no longer allowed to be excluded as “not demo-critical” if it remains part of the submission story.
- MagicBlock PER cannot be kicked down the line if it is claimed in the final demo. It must be validated on the Quasar-native path, or removed from final on-chain claims.
- `submissionReady=true` is disabled until the critical success gate passes.

New hard gate:

```bash
npm run check:quasar:critical-success
```

Resolved 2026-05-06: `packages/demo-agents/src/demo.ts` now runs a Quasar-native full-flow demo across Quasar escrow, reputation, and attestation, with MagicBlock PER/TEE explicitly fail-closed/not claimed unless separately live-validated.
