# REASONS-LITE — Mastercard AP4M static compatibility contract

_Status: draft for acceptance | Owner: Firefly (planning) / RAP maintainer (acceptance) | Project: Reddi Agent Protocol | Issue: [#692](https://github.com/nissan/reddi-agent-protocol/issues/692) | Parent: [#691](https://github.com/nissan/reddi-agent-protocol/issues/691)_

This artifact specifies a future **static, fixture-only, no-network** compatibility report. It is not an implementation, an AP4M API schema, or permission to use Mastercard services.

## Outcome contract

- **Task:** define the bounded RAP contract for classifying public AP4M concepts, support states, mappings, and unknowns.
- **Goal:** a protocol architect can decide what is lossless, lossy, metadata-only, unknown, gated, or unsupported without inventing external fields or confusing payment assurance with settlement.
- **Goal behind the goal:** preserve trustworthy, rail-neutral paid-work evidence while making later AP4M adapter work reviewable and fail-closed.
- **Baseline:** public Mastercard/Cloudflare material describes the lifecycle and product claims, but no complete normative buyer, seller, voucher, redemption, or settlement API schema is publicly available.
- **Target:** every compatibility row has a named source/proof classification and mapping state; all nine proof objects remain distinct; zero public-only inputs can authorize execution or upgrade support beyond public-spec/fixture; fixture conformance covers all material refusal paths.
- **Measurement method:** deterministic mapping-table checks, closed-vocabulary schema checks, negative fixtures, source/proof coverage, and forbidden-capability guards.
- **Measurement owner:** RAP protocol architect at spec acceptance; implementation owner at later PR validation.
- **Vision hypothesis:** If we help RAP integrators with a source-bound AP4M compatibility report to solve ambiguous payment-assurance mappings, they will choose it over ad hoc AP4M field translation because it preserves local authority, exposes unknowns, and separates vouchers from settlement and work evidence.
- **Change course if:** Mastercard publishes a normative versioned schema that contradicts this model; the public product no longer uses the stated authority/voucher/deferred-redemption lifecycle; or a simpler existing RAP contract can represent all nine proof classes without losing provenance or lifecycle boundaries.
- **Evidence:**
  - **Confirmed:** the dated source assessment in [`docs/MASTERCARD-AP4M-COMPATIBILITY.md`](../../docs/MASTERCARD-AP4M-COMPATIBILITY.md#source-and-proof-register); RAP's existing buyer-authority, AP2, receipt, and support-state patterns; issue #692's accepted scope and guardrails.
  - **Assumed:** RAP-internal object names and fixture schemas are suitable implementation targets; review when implementation begins or normative AP4M material appears.
  - **Unknown:** exact AP4M API and voucher fields, credential and signature formats, revocation, guarantee terms, fees, dispute/refund rules, retention, geography, sandbox behavior, and licensing.

## R — Requirements / Definition of Done

### Required static contract

1. Publish the support-state vocabulary exactly as:
   - `mastercard_ap4m_public_spec_only`
   - `mastercard_ap4m_fixture`
   - `mastercard_ap4m_sandbox_gated`
   - `unsupported_live_mastercard_ap4m`
2. Publish the mapping-state vocabulary exactly as:
   - `lossless`
   - `lossy`
   - `metadata_only`
   - `unknown`
   - `gated`
   - `unsupported`
3. Require every mapping row to carry a source/proof classification, confidence, claim boundary, and reason.
4. Keep identity, authority, challenge, voucher, assurance, redemption, settlement, work evidence, and attestation as separate objects and proof classes.
5. Model a voucher as a bounded payment-commitment reference, never a settlement receipt. Model assurance as an assertion about that commitment, never finality.
6. Preserve local RAP buyer authority as the ceiling: external AP4M-derived material may narrow a local policy but cannot create or widen authority.
7. Treat public-source external field shapes as unknown. The static contract may name RAP-owned target fields and opaque external references; it must not present invented AP4M JSON paths as verified.
8. Define deterministic offline fixtures and conformance checks, including negative cases that prove public input cannot authorize execution, verify signatures, claim settlement, or upgrade support.
9. Keep all later implementation, sandbox, contact, credentials, signing, payment, settlement, and deployment behind separate gates.

### Definition of Done for this spec issue

- [x] Outcome, falsification criteria, Confirmed/Assumed/Unknown evidence, and measurement ownership are explicit.
- [x] Closed support-state, mapping-state, and source/proof vocabularies are defined.
- [x] Nine proof/handoff objects have non-overlapping responsibilities.
- [x] Voucher and settlement boundaries are specified without asserting external AP4M field shapes.
- [x] Offline fixture and negative conformance requirements are enumerated.
- [x] Exact later implementation surfaces and validation gates are named.
- [ ] Independent spec review accepts this contract with zero Critical/High/material gaps.
- [ ] Maintainer acceptance is recorded on #692; implementation children remain blocked until their own dependency and authority gates clear.

### Explicitly out of scope

- Implementation schemas, fixtures, tests, runtime adapters, or UI.
- Mastercard signup/contact, Early Access, credentials, keys, signature verification, or API calls.
- Wallet/RPC activity, payment, voucher issuance, redemption, settlement, custody, or transfer.
- AP4M partner/support/readiness claims, deployment, or public release.
- Defining #693's normative voucher/redemption/settlement semantics beyond the separation needed to constrain this static report.

## E — Entities / handoff objects

These are **RAP-owned compatibility objects**. They do not claim to reproduce external AP4M payloads.

| Object | Responsibility | Required RAP-owned fields/boundaries | Must not imply |
|---|---|---|---|
| `IdentityEvidenceRef` | identify the actor/provider evidence source | opaque ref/hash, subject ref, source/proof class, observed-at/freshness, verification state | authority, payment, work quality, reputation |
| `AuthorityConstraintRef` | represent externally described delegation as constraints | opaque ref/hash, principal/agent refs if sourced, scope/cap/expiry only when evidenced, local-policy decision ref | new or wider local authority |
| `PaymentChallengeRef` | reference the observed 402 challenge | opaque challenge hash/ref, provider ref, terms hash/ref, observation provenance | accepted terms, voucher issuance, settlement |
| `VoucherRef` | reference a bounded payment commitment | opaque voucher hash/ref, challenge/authority bindings when evidenced, issuer/signer refs, amount/asset/merchant/nonce/expiry only when sourced, verification state | guarantee, redemption, settled funds |
| `PaymentAssuranceRef` | record a distinct assurance claim | opaque assurance ref, issuer, scope, conditions, expiry, proof state | unconditional guarantee or settlement finality |
| `RedemptionObservation` | record aggregation/submission/redemption observations | opaque batch/ref, voucher refs, state, source/proof class, observed-at | successful settlement |
| `SettlementObservation` | record rail-specific settlement evidence | opaque rail/transaction refs, amount/asset/status only when observed, proof strength, finality state | work delivery, quality, attestation |
| `WorkEvidenceRef` | bind requested work and output evidence | work/request/output refs or hashes, evidence source, collection state | payment, settlement, correctness |
| `AttestationRef` | record an evaluator's verdict over evidence | attestor ref, subject/evidence refs, verdict, method/proof class | payment, network guarantee, objective truth |

All cross-object relationships are typed references. No object gains another object's meaning merely because references are present.

### Source/proof classification

Every compatibility row and object field uses one classification:

| Class | Meaning | Allowed effect |
|---|---|---|
| `first_party_public_claim` | dated public statement/product material, not a normative schema | concept-level mapping only; no external field-shape verification |
| `external_adjacent_public_claim` | adjacent first-party material (for example identity/request signing) | metadata/context only; never silently attributed to AP4M |
| `rap_existing_contract` | accepted RAP-owned schema or invariant | may define RAP target behavior, not external AP4M shape |
| `static_fixture_assertion` | deterministic synthetic input owned by RAP | fixture/conformance behavior only |
| `normative_external_spec` | versioned normative external definition | unavailable for AP4M at this baseline; requires citation/version before use |
| `sandbox_observation` | later approved observation of a sandbox response | gated; cannot be fabricated or inferred now |
| `live_observation` | later approved live evidence | unsupported now and never implied by lower classes |

Required proof metadata: `sourceId`, `sourceClass`, `observedOrPublishedAt`, `confidence` (`high|medium|low|unknown`), `proofStrength` (`claim_only|fixture_asserted|schema_verified|signature_verified|network_observed|unknown`), `claimBoundary`, and optional `supersedesSourceId`.

Every concept mapping is keyed `AP4M-M01` through `AP4M-M13` and is normatively bound to concrete source ids, confidence, proof strength, an explicit reason, and claim boundary in the companion [mapping classification ledger](../../docs/MASTERCARD-AP4M-COMPATIBILITY.md#normative-mapping-classification-ledger). Missing, duplicate, or unregistered mapping keys block the report; prose elsewhere cannot supply an implicit classification.

### Sandbox gate record

`mastercard_ap4m_sandbox_gated` requires a valid `reddi.mastercard-ap4m-sandbox-gate.v1` record with:

- immutable `gateRecordId` and non-secret `decisionRef`;
- `authority.kind` (`owner|delegated_operator`), non-secret `actorRef`, decision `sourceClass` (`owner_decision|delegated_authority_decision`), and matching registered `sourceId`;
- closed allowed-operation scope, explicit subjects and data classes, sandbox-only environment, and literal zero maximum value;
- RFC 3339 `decidedAt` and mandatory `expiresAt`;
- explicit revocation status plus timestamp/reference/reason when revoked; and
- literal-false non-implications for access granted, testing completed, credentials obtained, schema verified, sandbox/live support, execution/payment authorization, settlement observation, and partner status.

The exact machine-reviewable field contract is in the companion [sandbox gate-record contract](../../docs/MASTERCARD-AP4M-COMPATIBILITY.md#sandbox-gate-record-contract). Missing, malformed, expired, or revoked records fail closed. A valid record authorizes only the named future evaluation; it is not evidence of access, testing, credentials, support, or execution.

## A — Approach / key decisions

### Chosen approach

- Build a **compatibility report**, not an AP4M client or external-schema mirror.
- Use RAP-owned target objects with opaque refs for external material.
- Evaluate mapping per object/field with the closed mapping-state vocabulary.
- Fail closed when a source, mapping state, object binding, or support state is missing or inconsistent.
- Reuse `reddi.buyer-authority-policy.v1`, `reddi.receipt.v1`, AP2 fixture-only provenance, and existing #338 support-state patterns by reference; do not duplicate their semantics.

### Mapping-state rules

| State | Exact rule |
|---|---|
| `lossless` | source and RAP target meanings, units, cardinality, and lifecycle semantics match without inference; requires a normative external spec or a purely RAP-owned identity mapping |
| `lossy` | a sourced concept maps but one or more semantics/cardinality/units are dropped; list every loss |
| `metadata_only` | retained for provenance/display; cannot affect authority, execution, settlement, trust, or reputation |
| `unknown` | public evidence is insufficient to name shape or semantics; target value stays absent/null, never guessed |
| `gated` | mapping requires separately authorized sandbox/live evidence or operator decision |
| `unsupported` | deliberately rejected or outside RAP's safe contract; fail closed with a reason code |

At the present baseline, no external AP4M API field mapping may be `lossless`; concept-level RAP mappings are `lossy`, `metadata_only`, `unknown`, or `gated` unless the row maps a RAP-owned value to itself.

### Closed refusal vocabulary

The static report may emit only these reason codes, in input/source → gate → authority/binding → proof/finality → sensitive/live evaluation order:

`input_malformed`, `source_classification_missing`, `source_claim_contradictory`, `normative_schema_missing`, `public_input_support_upgrade_denied`, `fixture_support_upgrade_denied`, `sandbox_gate_missing`, `sandbox_gate_malformed`, `sandbox_gate_expired`, `sandbox_gate_revoked`, `authority_widening_denied`, `duplicate_or_replayed_reference`, `authority_or_voucher_expired`, `subject_binding_mismatch`, `spend_cap_exceeded`, `voucher_verification_unproven`, `assurance_presented_as_settlement`, `redemption_presented_as_settlement`, `non_final_settlement_presented_as_final`, `identity_proof_class_collapse`, `work_evidence_proof_class_collapse`, `unknown_field_defaulted`, `sensitive_material_rejected`, `adjacent_standard_conflated`, `live_capability_flag_rejected`, `live_ap4m_unsupported`.

The companion [reason-code table and exact fixture expectations](../../docs/MASTERCARD-AP4M-COMPATIBILITY.md#closed-reason-code-vocabulary) are normative. Unknown codes invalidate the report. Compound failures concatenate applicable codes in the documented order and de-duplicate without reordering; prose-only failure states are not conformant.

### Voucher-versus-settlement schema boundary

`VoucherRef` contains only commitment identity/bindings and observed verification state. It does not contain a settlement status, transaction signature/hash, rail finality, payout state, custody state, or balance mutation.

`SettlementObservation` contains only independently observed rail/transaction evidence and finality classification. It references one or more vouchers through an explicit reconciliation object; it does not retroactively upgrade voucher verification or assurance.

Planned `VoucherSettlementReconciliation` fields are RAP-owned: reconciliation id, voucher refs, settlement observation refs, relationship (`one_to_one|many_to_one|one_to_many|unresolved`), amount reconciliation state (`exact|partial|over|unknown`), lifecycle state (`pending|submitted|observed|reconciled|rejected|expired|reversed|refunded|unknown`), provenance, and discrepancies. External AP4M field paths remain absent until normative evidence exists.

### Alternatives rejected

- Treating public marketing names as a verified API schema: invents fields and false compatibility.
- Reusing AP2 mandates as AP4M authority/vouchers: conflates adjacent standards and proof classes.
- One generic `paymentProof`: collapses commitment, assurance, redemption, and settlement.
- Enabling a sandbox/live state from a parser success: confuses syntax with authority and evidence.
- Making Mastercard or any rail a core RAP dependency: weakens rail neutrality.

## S — Structure / exact later file plan

This issue creates only the first two documentation surfaces. A separately authorized implementation issue/PR should use this plan and update it if accepted architecture changes.

| Surface | Later expected change | Gate/owner |
|---|---|---|
| `spdd/prompt/mastercard-ap4m-compatibility.md` | canonical REASONS-LITE contract (this file) | #692 spec review |
| `docs/MASTERCARD-AP4M-COMPATIBILITY.md` | human-readable mapping, support matrix, fixture/conformance plan (this issue) | #692 spec review |
| `packages/agent-protocol/src/mastercard-ap4m-compatibility.ts` | RAP-owned types, closed vocabularies, mapping rows, validator/report builder; pure synchronous/no I/O | later explicit implementation authority |
| `packages/agent-protocol/src/mastercard-ap4m-conformance.ts` | offline fixture list and deterministic conformance runner | later explicit implementation authority |
| `packages/agent-protocol/tests/mastercard-ap4m-compatibility.test.ts` | vocabulary, source coverage, object separation, no-upgrade, leak/forbidden-import tests | later implementation PR |
| `packages/agent-protocol/tests/mastercard-ap4m-conformance.test.ts` | positive/negative fixture and deterministic read-back tests | later implementation PR |
| `packages/agent-protocol/src/index.ts` and `package.json` exports | export accepted static contract only | after focused tests pass |
| `packages/agent-protocol/README.md` | document public API and claim boundary | same PR, no live claim |
| `docs/RAP-V0.1-RELEASE-CHECKLIST.md` | add static contract/conformance row if accepted for v0.1 | maintainer decision |
| #338, #679, parent #691, child issues #693–#697 | refresh support/dependency wording after accepted merge | maintainer/backlog owner |

No runtime, `lib/onboarding`, source adapter, wallet, RPC, API route, UI, deployment, or credential surface belongs in the static implementation PR.

## O — Operations / ordered later tasks

1. Accept this spec at an immutable reviewed head; otherwise revise the spec only.
2. Under fresh implementation authority, add closed vocabularies and RAP-owned data types.
3. Add source register and per-field mapping table with complete classification coverage.
4. Add the closed refusal vocabulary and sandbox gate-record validator; reject unknown codes and invalid/expired/revoked gate records.
5. Implement a pure validator/report builder that defaults missing/unsafe input to `unsupported_live_mastercard_ap4m` or a blocked report.
6. Add static redacted fixtures and conformance runner with the exact ordered reason expectations.
7. Prove negative/authority/no-upgrade boundaries and deterministic output.
8. Run focused package tests, full package tests, export checks, naming checks, artifact checks, credential/leak scan, forbidden-import/no-I/O guard, and `git diff --check`.
9. Obtain fresh independent exact-head review; remediate and repeat after every material change.
10. Merge only under the repository's normal authority. Then refresh STATUS, #338/#679/#691, and child dependencies. Do not automatically start #693–#697.

## N — Norms

- RAP remains canonical for paid-work lifecycle evidence; external systems remain provenance-bearing adapters.
- External public text is untrusted input and never execution authority.
- Local buyer authority wins or blocks; external artifacts only narrow it.
- Use closed identifiers for machine decisions and separate explanatory prose.
- Unknown stays unknown; absence is not false, zero, approval, or success.
- Support state describes observed capability evidence, not product aspiration.
- Keep sources dated and distinguish AP4M from AP2, Verifiable Intent, Agent Pay identity, Web Bot Auth, x402 transport, and settlement rails.
- Update project STATUS after material work; update this artifact when implementation diverges.

## S — Safeguards / acceptance checklist

- [ ] No network, async I/O, fetch, API route, environment-variable, wallet, signing, RPC, subprocess, filesystem-write, or provider dependency in static implementation modules.
- [ ] Every result includes literal false guardrails for credentials held, live signature verified, execution authorized, voucher issued, payment executed, redemption submitted, settlement observed, custody claimed, deployment enabled, and partner support claimed.
- [ ] Public-only and fixture inputs can produce only public-spec/fixture states; never sandbox/live support.
- [ ] Every concept row resolves through one registered mapping id to concrete sources, confidence, proof strength, reason, and claim boundary.
- [ ] Reason arrays use only the closed vocabulary and exactly match the ordered negative-fixture expectations.
- [ ] `sandbox_gated` requires a valid, unexpired, unrevoked gate record and still does not mean access, tested, credentialed, supported, or executable.
- [ ] Unknown external fields remain absent and classified `unknown`; no guessed aliases/defaults.
- [ ] Credential-, secret-, key-, PAN-, token-, signature-material-, and raw-voucher-shaped inputs are rejected or reduced to explicitly permitted opaque fixture refs.
- [ ] Identity cannot authorize; authority cannot prove payment; voucher cannot prove assurance/settlement; assurance cannot prove settlement; settlement cannot prove work; work evidence cannot self-attest.
- [ ] Negative fixtures cover authority widening, support upgrade, proof-class collapse, replay/expiry/wrong merchant/over-cap, invalid/unverified voucher, partial/rejected/reversed/unknown settlement, credential material, and contradictory source claims.
- [ ] Later validation commands are recorded with exact outcomes and exact git head.
- [ ] Independent reviewer checks implementation against this artifact before merge.

## Delivery and value evidence

- **Implemented:** not yet evidenced; this issue produces specification only.
- **Technically verified:** not yet evidenced beyond Markdown/link/diff checks for the spec artifact.
- **Released/deployed:** not yet evidenced.
- **Validated in operator workflow:** not yet evidenced.
- **Accepted:** not yet evidenced; requires independent spec review and maintainer acceptance on #692.
- **Adopted:** not yet evidenced.
- **Beneficial against baseline:** unmeasured until a later integrator uses the report; owner is the RAP maintainer at the first implementation review.

## Prompt/code sync log

| Date | Divergence | Artifact update | Code/test update |
|---|---|---|---|
| 2026-10-23 | Initial spec; no implementation exists | Created outcome-first contract and exact later file plan | None authorized |
| 2026-10-23 | Round-1 review found unbound mapping metadata, no closed refusal vocabulary, and an underspecified sandbox gate record | Bound all concept rows through keyed metadata, added exact reason/fixture contracts, and defined the gate record | None authorized |
