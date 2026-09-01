# Quasar-Backed Reputation Instruction Fixture Gate — `reddi.quasar-reputation-intent.v1` (#443)

**Status: v1 fixture/intent gate (parent epics #394 / #388).**
Module: `packages/agent-protocol/src/quasar-reputation-intent.ts` · Tests: `packages/agent-protocol/tests/quasar-reputation-intent.test.ts` · Subpath export: `@reddi/agent-protocol/quasar-reputation-intent`.

A **deterministic, fixture-level** mapping from eligible reputation/attestation records to Quasar
**commit / reveal / confirm / dispute** INTENT records. Every output is a plain data record with
`instructionBuilt: false` and `signable: false` — this module never builds a transaction, never
touches a wallet or RPC, never deploys or upgrades a program, never executes a payment, and never
mutates reputation state. It is the gate `docs/QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md`
anticipates for #443 ("fixture-only Quasar-backed intent gates without signing/RPC") and the
prerequisite `lib/manager/marketplace-listings.ts` names before any UI can show a backed state.

## Sources (all local, all validated before mapping)

- `reddi.receipt-evidence-binding.v1` (#393, required) — the receipt/evidence/payment/attestation
  record set being mapped.
- `reddi.quasar-registry-compatibility.v1` (#390, required) — the compatibility report for the same
  listing/profile. Missing, malformed, mismatched, or itself-blocked reports fail the whole plan
  closed.
- `reddi.offchain-reputation-preview.v1` (#394, optional cross-check) — when supplied it must be
  `preview_ready` and match the binding evidence field-for-field, else the plan blocks.
- The #442 hosted attestation claim contract (`reddi.hosted-attestation-claim.v1`) and the #565/#569
  portable credential remain upstream evidence vocabulary; they are consumed by reference through
  the binding/preview, never re-verified or re-published here.

## Intent lanes (compact Quasar fields only — #390 field split)

Lane targets mirror the parity ports under `experiments/quasar-reputation` and
`experiments/quasar-attestation`; `config/quasar/deployments.json` is referenced as a repo-relative
pointer, never as a deployment claim by this module.

| Lane | Program lane | Discriminator | Compact fields carried | Eligibility |
|---|---|---|---|---|
| `commit` | `quasar-reputation` | 1 | `jobIdRef`, `role: 'consumer'`, commitment described by contract (`sha256(score‖salt‖escrow_address‖program_id)`) and explicitly `not_computed` | valid reputation event draft present |
| `reveal` | `quasar-reputation` | 2 | `jobIdRef`, `score` (draft rubric score 0–100 scaled to the program's 1–10 range) | same as commit |
| `confirm` | `quasar-attestation` | 2 | `jobIdRef` | receipt `attested` + attestation verdict `passed` |
| `dispute` | `quasar-attestation` | 3 | `jobIdRef` | receipt `rejected` + attestation verdict `disputed` |

The on-chain field/account names, PDA seeds, and commitment contract mirrored in
`QUASAR_REPUTATION_INTENT_COMPATIBILITY` describe the **current repository sources** only; the same
constant records that the deployment referenced by `deploymentsRef` is pre-job-binding and unusable
(see `docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`).

Everything a real instruction would additionally need — u128 job-id encoding, salt generation, the
commitment hash, party public keys, account addresses — is **named, not fabricated**, in each
record's `deferredToInstructionBuilder` list. Rich RAP/ARD metadata (evidence, attestation, preview,
payment proof, listing metadata) never appears inline: intent records point at it by id in
`offchainRefs`, per the on-chain/off-chain split in `reddi.quasar-registry-compatibility.v1` and
`docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md` §3.3.

## Fail-closed gates (structured reason codes)

Any of these blocks the whole plan (`status: 'blocked'`, `intents: []`, no eligible lanes):

| Gate | Reason code(s) |
|---|---|
| #390 compatibility mapping missing / wrong schema | `missing_quasar_compatibility` |
| Compatibility report itself blocked | `quasar_compatibility_blocked` |
| Compatibility report for a different listing/profile | `compatibility_subject_mismatch` |
| Unsafe guardrails on binding, preview, or compatibility report | `unsafe_live_guardrail` |
| Policy denied / payment preflight failed | `policy_denied`, `payment_preflight_denied` |
| Payment proof missing or preflight↔receipt mismatch | `missing_payment_proof` |
| Evidence summary incomplete or unlinked | `missing_evidence` |
| Attestation absent | `missing_attestation` |
| Non-final receipt states (`pending`, `not_requested`) | `non_final_state_excluded` |
| Failure-final receipts (`failed`) | `failure_final_excluded` |
| Rejected receipts without a consumer dispute (failed/refunded verdicts) | `attestation_state_excluded` |
| Malformed binding / source metadata / intent envelope | `malformed_binding`, `malformed_source_metadata`, `missing_source_ref`, `missing_intent_id`, `malformed_intent` |
| Supplied preview not ready or not matching the binding | `preview_not_ready`, `preview_mismatch` |

Pre-flight, the standalone `evaluateQuasarReputationIntentSourceEligibility(source)` follows the
#562/#589 `evaluateErc8004SourceEligibility` precedent: **probe-only rail-neutral receipts never
qualify** (`probe_only_receipt_excluded`), rail-neutral binding candidates must bridge into
`reddi.receipt.v1` via the proof chain first (`rail_neutral_bridge_required`), and unsupported
networks are rejected (`unsupported_network_asset`).

A missing reputation event draft does not block the plan; it makes the commit/reveal lanes
ineligible (`missing_reputation_draft`) while a passed attestation can still map to `confirm`.

## Boundaries recap (hard rule)

Intent/fixture records **only** — never transaction builders, never senders. No wallet signing, no
RPC, no program deploy, no live payment, no reputation mutation, no hosted-registry write, no
marketplace publication, no buyer-facing claim (`buyerFacingClaimAllowed: false` on every plan).
Enforced three ways:

1. every plan carries all-false guardrails and every record carries `instructionBuilt: false` /
   `signable: false`;
2. the test suite includes a forbidden-import/forbidden-term source guard (no chain-client stacks,
   no network/process/fs surface, no async, guardrails never declared true) in the #575/#584 style;
3. `npm run check:quasar:boundary-guard` (#508/#517) covers the module as a protected
   package/read-model path.

**Instruction builders are explicitly out of scope.** Building, encoding, or dispatching actual
Quasar instructions — including salt/commitment generation and account resolution — is a separate
issue that must satisfy the #441 Surfpool/devnet promotion checklist before any devnet or live
Solana action is approved. This gate feeds #395 only as a labelled fixture/read-model until such
live gates exist.

Related: #443 (this gate), #390 (compatibility mapping), #393 (receipt-evidence binding), #394
(off-chain preview vocabulary), #441 (promotion checklist), #442 (hosted attestation claim), #562 /
PR #589 (export-conformance gate precedent), #452 / PR #591 (lane boundaries doc).
