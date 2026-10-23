# Mastercard AP4M compatibility — static contract

**Status:** draft specification for issue [#692](https://github.com/nissan/reddi-agent-protocol/issues/692)

**Normative RAP planning artifact:** [`spdd/prompt/mastercard-ap4m-compatibility.md`](../spdd/prompt/mastercard-ap4m-compatibility.md)

**Boundary:** static/public-source and synthetic-fixture classification only. No AP4M signup, credentials, API, voucher issuance, signature verification, payment, redemption, settlement, deployment, or support claim.

## Decision

RAP should represent AP4M as an external payment-assurance compatibility target while keeping RAP rail-neutral and authoritative for paid-work lifecycle evidence. The static contract describes what can be said from dated public sources, what can be exercised with synthetic fixtures, and what remains unknown or gated.

The central invariant is:

> A voucher-shaped commitment may be verified and may have a separately sourced assurance claim, but neither fact is an observation of redeemed or settled funds. Payment evidence does not prove that work was performed correctly; work evidence and attestation remain separate.

## Source and proof register

The source identifiers below classify claims; they do not verify external JSON fields.

| Source ID | Source | Date | Class | What it supports | What it does not support |
|---|---|---:|---|---|---|
| `MC-X-2026-10-20` | [Mastercard X announcement](https://x.com/Mastercard/status/2112590919509663796) | 2026-10-20 | `first_party_public_claim` | product announcement and AP4M positioning | API/voucher schema, live support |
| `MC-DEMO-2026-10-20` | [Mastercard “AP4M in action” article](https://www.mastercard.com/us/en/news-and-trends/press/2026/october/Mastercard-Agent-Pay-for-Machines-in-action.html) | 2026-10-20 | `first_party_public_claim` | x402, multi-provider demonstration, bounded budget, deferred settlement narrative | reproducible benchmark, normative payloads, general availability |
| `MC-PRODUCT-AP4M` | [Mastercard AP4M product page](https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay/agent-pay-for-machines.html) | observed 2026-10-21 | `first_party_public_claim` | Discover/Authorize/Execute/Settle stages; voucher/payment-assurance concepts | stable API, guarantee terms, field names |
| `MC-EARLY-ACCESS-AP4M` | [Mastercard AP4M Early Access page](https://www.mastercard.com/global/en/business/payments/consumer-payments/next-gen-payments/digital-asset-solutions/cloudflare-connect-2026.html) | observed 2026-10-21 | `first_party_public_claim` | pilot/sandbox/toolkit availability claims | access granted, sandbox behavior, credentials, schema |
| `MC-LAUNCH-2026-06-10` | [Mastercard AP4M launch release](https://www.mastercard.com/us/en/news-and-trends/press/2026/june/mastercard-launches-agent-pay-for-machines.html) | 2026-06-10 | `first_party_public_claim` | product lifecycle and ecosystem context | normative protocol schema |
| `CF-AGENT-COMMERCE` | [Cloudflare agentic-commerce article](https://blog.cloudflare.com/secure-agentic-commerce/) | observed 2026-10-21 | `external_adjacent_public_claim` | adjacent HTTP signature/key directory/nonce concepts | proof those shapes are AP4M voucher fields |
| `RAP-AP2-V1` | [`AP2-MANDATE-INGESTION-SPEC-2026-07-06.md`](./AP2-MANDATE-INGESTION-SPEC-2026-07-06.md) | 2026-07-06 | `rap_existing_contract` | fixture-only authority/provenance and local-policy ceiling pattern | identity between AP2 and AP4M |
| `RAP-RECEIPT-V1` | [`RAP-RECEIPT-POLICY-V1.md`](./RAP-RECEIPT-POLICY-V1.md) | current repo | `rap_existing_contract` | rail-neutral receipt/claim boundaries | external AP4M settlement truth |
| `RAP-FIXTURE-AP4M` | future synthetic AP4M fixture corpus | not implemented | `static_fixture_assertion` | deterministic compatibility/conformance only | live signatures, APIs, assurance, settlement |

Source URLs and the evidence assessment are preserved in the workspace research report that created #691/#692. This repository document intentionally avoids copying unverified external payload examples into a protocol contract.

## Closed vocabularies

### Support state

| State | Meaning | Permitted claims | Required blockers |
|---|---|---|---|
| `mastercard_ap4m_public_spec_only` | concept supported only by dated public claims | concept-level compatibility and explicit unknowns | execution, signing, credentials, voucher issuance, assurance verification, redemption, settlement all false |
| `mastercard_ap4m_fixture` | deterministic RAP-owned synthetic fixture passes static conformance | parser/mapping behavior for the fixture | no external-schema, crypto, sandbox, or live claim |
| `mastercard_ap4m_sandbox_gated` | a separately approved future sandbox lane may be evaluated | gate status and prerequisites only | not equivalent to access, tested, supported, or live; operator approval and data boundary required |
| `unsupported_live_mastercard_ap4m` | live behavior is absent, unsafe, contradictory, or prohibited | explicit refusal and reasons | all live effects false |

Support states only move on new evidence. Public text cannot yield `fixture`; a fixture cannot yield `sandbox_gated` without an external operator-gate record; none of these states represents live support.

### Mapping state

| State | Use |
|---|---|
| `lossless` | exact semantic/unit/cardinality match proven by a normative source; not available for external AP4M fields at this baseline |
| `lossy` | concept maps with enumerated semantic loss |
| `metadata_only` | provenance/display only; excluded from authority and execution decisions |
| `unknown` | insufficient evidence; value remains absent rather than guessed |
| `gated` | requires separately authorized sandbox/live evidence or decision |
| `unsupported` | rejected or deliberately outside the contract |

## Static concept mapping

This maps **concepts to RAP-owned targets**, not external field paths.

| Mapping ID | AP4M public concept | RAP target | Mapping | Loss/unknown boundary |
|---|---|---|---|---|
| `AP4M-M01` | provider discovery | `IdentityEvidenceRef` plus source-adapter provenance | `lossy` | directory schema, freshness, verification and identifiers unknown |
| `AP4M-M02` | Agent Principal / delegated rules | `AuthorityConstraintRef` then local buyer-policy intersection | `lossy` | external credential/schema and revocation unknown; never widens local authority |
| `AP4M-M03` | HTTP 402 challenge | `PaymentChallengeRef` | `lossy` | exact headers/body/terms schema unknown |
| `AP4M-M04` | signed payment voucher | `VoucherRef` | `lossy` | exact format, signer, algorithm, canonicalization and verification API unknown |
| `AP4M-M05` | payment guarantee/assurance | `PaymentAssuranceRef` | `lossy` | issuer obligations, exclusions, expiry and dispute terms unknown |
| `AP4M-M06` | voucher aggregation/redemption | `RedemptionObservation` | `lossy` | batch schema, submission states, idempotency and rejection codes unknown |
| `AP4M-M07` | multi-rail settlement | `SettlementObservation` plus reconciliation | `lossy` | rail APIs, finality rules, fees, partial/reversal semantics unknown |
| `AP4M-M08` | service delivery after voucher acceptance | `WorkEvidenceRef` | `metadata_only` until evidence exists | product claim is not proof of a particular delivery |
| `AP4M-M09` | work judgment/accountability | `AttestationRef` | `unknown` as an AP4M feature; RAP-owned separately | must not be inferred from payment assurance |
| `AP4M-M10` | HTTP signature/key directory/nonce | optional identity profile, not core AP4M voucher | `metadata_only` | adjacency is not schema identity; #695 owns future profile |
| `AP4M-M11` | AP2 / Verifiable Intent relationship | authority provenance reference only | `unknown` | no interchangeability or common field shape claimed |
| `AP4M-M12` | Early Access buyer/seller APIs | future adapter surfaces | `gated` | exact schemas, terms, credentials and behavior unknown |
| `AP4M-M13` | live voucher/payment/settlement execution | none | `unsupported` | requires later approvals, contracts, implementation, and proof |

### Normative mapping classification ledger

The mapping table and this ledger are one contract keyed by `mappingId`. An implementation must reject a missing, duplicate, or unregistered key. `reason` is an explicit classification rationale, not a support-state upgrade.

| Mapping ID | Exact source IDs | Confidence | Proof strength | Reason | Claim boundary |
|---|---|---|---|---|---|
| `AP4M-M01` | `MC-PRODUCT-AP4M`, `MC-EARLY-ACCESS-AP4M` | `medium` | `claim_only` | Public material describes discovery but publishes no directory contract. | Discovery metadata cannot prove identity, trust, authority, payment, or support. |
| `AP4M-M02` | `MC-DEMO-2026-10-20`, `MC-PRODUCT-AP4M`, `RAP-AP2-V1` | `medium` | `claim_only` | Agent Principal controls map conceptually to constraints; RAP's local policy remains the only enforceable ceiling. | External material may narrow, never create or widen, local authority. |
| `AP4M-M03` | `MC-DEMO-2026-10-20`, `MC-LAUNCH-2026-06-10` | `high` | `claim_only` | First-party material names HTTP 402, but no normative header/body schema is published. | A challenge observation is not acceptance, authority, voucher issuance, or payment. |
| `AP4M-M04` | `MC-DEMO-2026-10-20`, `MC-PRODUCT-AP4M`, `MC-LAUNCH-2026-06-10` | `high` | `claim_only` | Signed vouchers are a stated concept; format and verification contract remain unknown. | A voucher reference is not assurance, redemption, settlement, or custody proof. |
| `AP4M-M05` | `MC-DEMO-2026-10-20`, `MC-PRODUCT-AP4M`, `MC-LAUNCH-2026-06-10` | `medium` | `claim_only` | Payment assurance/guarantee is stated without public enforceability or condition schema. | Assurance is recorded separately and never means settled funds. |
| `AP4M-M06` | `MC-DEMO-2026-10-20`, `MC-PRODUCT-AP4M` | `medium` | `claim_only` | Deferred/batched redemption is described only at product-concept level. | Submitted/aggregated/redeemed labels never synthesize settlement observation. |
| `AP4M-M07` | `MC-DEMO-2026-10-20`, `MC-PRODUCT-AP4M`, `RAP-RECEIPT-V1` | `medium` | `claim_only` | Multi-rail settlement is claimed publicly; rail-specific finality evidence is unavailable. | Settlement requires independent rail evidence and proves neither work nor attestation. |
| `AP4M-M08` | `MC-DEMO-2026-10-20`, `RAP-RECEIPT-V1` | `medium` | `claim_only` | Public material describes service delivery after acceptance; no particular delivery is evidenced. | Retained as provenance only until RAP work evidence independently exists. |
| `AP4M-M09` | `RAP-RECEIPT-V1` | `high` | `schema_verified` | Attestation is RAP-owned and no reviewed AP4M source establishes an equivalent. | No AP4M feature, payment artifact, or work evidence is promoted to attestation. |
| `AP4M-M10` | `CF-AGENT-COMMERCE` | `medium` | `claim_only` | HTTP-signature identity material is adjacent, not a verified AP4M voucher schema. | Metadata only; cannot establish AP4M identity, authority, voucher validity, or support. |
| `AP4M-M11` | `RAP-AP2-V1`, `MC-PRODUCT-AP4M` | `low` | `claim_only` | Public context suggests adjacency but publishes no normative equivalence. | AP2, Verifiable Intent, AP4M, Agent Pay identity, and Web Bot Auth remain distinct. |
| `AP4M-M12` | `MC-EARLY-ACCESS-AP4M` | `medium` | `claim_only` | APIs/toolkit/sandbox are advertised but their contracts and access state are unknown. | A valid gate record permits only the named future evaluation; it does not prove access, testing, credentials, support, or execution. |
| `AP4M-M13` | `MC-EARLY-ACCESS-AP4M`, `RAP-RECEIPT-V1` | `high` | `claim_only` | Baseline evidence is public/pilot only and this work has no live authority or observation. | Live issuance, execution, redemption, settlement, custody, deployment, and support claims are refused. |

## Object and lifecycle boundaries

The nine objects and their fields are defined in the [REASONS-LITE entity table](../spdd/prompt/mastercard-ap4m-compatibility.md#e--entities--handoff-objects). Implementations must preserve these non-equivalences:

1. identity ≠ delegated authority;
2. authority ≠ challenge acceptance;
3. challenge ≠ voucher;
4. voucher verification ≠ payment assurance;
5. assurance ≠ redemption;
6. redemption ≠ settlement;
7. settlement ≠ work evidence;
8. work evidence ≠ attestation;
9. attestation ≠ payment or settlement.

### Voucher and settlement boundary

A `VoucherRef` is a non-secret reference to a commitment and its observed verification state. It may reference a challenge and authority decision. It cannot carry or synthesize settlement finality.

A `SettlementObservation` is independently sourced rail evidence. A separate `VoucherSettlementReconciliation` relates voucher refs to settlement observations, records partial/over/unknown amounts and discrepancies, and supports one-to-one, many-to-one, one-to-many, or unresolved cardinality.

The contract must keep these lifecycle labels distinct:

`challenge_received → authority_checked → voucher_issued → voucher_verified → service_delivered → voucher_aggregated? → redemption_submitted → settlement_observed → settlement_reconciled`

Terminal/exception observations are `rejected`, `expired`, `reversed`, `refunded`, and `unknown`. A later observation appends/supersedes with provenance; it does not rewrite historical evidence.

## Required static report shape

The future `reddi.mastercard-ap4m-compatibility.v1` report should contain only RAP-owned fields:

- report id/schema version, subject/workflow ref, generated-at supplied by caller;
- source register with source/proof classifications;
- support state and exact reason codes;
- per-concept/per-field mapping rows with mapping state, confidence, source ids, target object/path, losses, unknowns, and claim boundary;
- the nine optional object refs/observations, each separately validated;
- reconciliation rows that never synthesize settlement;
- warnings/blockers and all-false no-live guardrails;
- deterministic fixture id when the input is synthetic.

The implementation must export two reviewable machine-readable tables:

- `AP4M_FIELD_PROVENANCE`: one row per RAP target field with target object/path, source ids, source/proof classification, mapping state, confidence, losses/unknowns, and claim boundary. A row names an external path only after a normative versioned source verifies it.
- `AP4M_UNSUPPORTED_SURFACES`: one row per deliberately blocked/omitted/excluded surface with behavior and reason. The minimum rows are live signature/key verification, credentials and key material, raw voucher payload retention, card/PAN/instrument data, live API calls, authority widening, voucher issuance, assurance verification, redemption submission, custody, settlement-finality claims, wallet/RPC/provider activity, cross-rail unit conversion, production support/partnership claims, and receipt binding of secret/raw external contents.

Unknown external AP4M values are absent/null plus an `unknown` mapping row. They are never populated from naming similarity, adjacent standards, examples, defaults, or marketing prose.

## Sandbox gate-record contract

`mastercard_ap4m_sandbox_gated` is valid only when the compatibility input carries one machine-reviewable `reddi.mastercard-ap4m-sandbox-gate.v1` record. The record is an authorization **reference**, not proof that access or activity exists.

| Field | Exact contract |
|---|---|
| `schemaVersion` | literal `reddi.mastercard-ap4m-sandbox-gate.v1` |
| `gateRecordId` | non-empty immutable local identifier |
| `decisionRef` | non-secret reference to the recorded operator decision; raw messages/tokens are excluded |
| `authority.kind` | closed value `owner` or `delegated_operator` |
| `authority.actorRef` | non-secret local actor reference |
| `authority.sourceClass` | closed value `owner_decision` or `delegated_authority_decision` |
| `authority.sourceId` | registered decision/evidence source identifier matching `sourceClass`; public AP4M sources are not valid authorization sources |
| `scope.allowedOperations` | non-empty subset of `schema_diff`, `static_fixture_refresh`, `sandbox_metadata_probe`, `sandbox_zero_value_conformance` |
| `scope.subjects` | explicit AP4M surface identifiers covered by the decision |
| `scope.dataClasses` | required explicit permitted-data array; an empty array means no data use |
| `scope.maxValue` | literal `0`; this gate cannot authorize value transfer |
| `scope.environments` | literal subset containing only `sandbox` |
| `decidedAt` | RFC 3339 timestamp supplied by the decision record |
| `expiresAt` | required RFC 3339 timestamp later than `decidedAt`; no perpetual gate |
| `revocation.status` | closed value `not_revoked` or `revoked` |
| `revocation.revokedAt` | required RFC 3339 timestamp when revoked; otherwise `null` |
| `revocation.decisionRef` | required revocation reference when revoked; otherwise `null` |
| `revocation.reason` | required non-empty reason when revoked; otherwise `null` |
| `nonImplications` | all literal false: `accessGranted`, `testingCompleted`, `credentialsObtained`, `schemaVerified`, `sandboxSupported`, `liveSupported`, `executionAuthorized`, `paymentAuthorized`, `settlementObserved`, `partnerStatusClaimed` |

Validation is fail-closed at a caller-supplied evaluation time. A missing/malformed record, unregistered decision source, empty/out-of-vocabulary scope, non-sandbox environment, non-zero value, expired record, or revoked record cannot produce `mastercard_ap4m_sandbox_gated`. The exact expected reason codes are below. Even a valid record permits only its named future operation; signup/contact, credential acquisition/storage, live calls, payment, settlement, deployment, and support/partnership claims remain separate gates.

## Closed reason-code vocabulary

Every refusal or negative fixture emits an ordered, de-duplicated array from this closed vocabulary. Unknown reason identifiers make the report invalid. Order is evaluation order: input/source → gate → authority/binding → proof-class/finality → sensitive/live boundary.

| Reason code | Exact trigger |
|---|---|
| `input_malformed` | required report/fixture structure is missing or malformed |
| `source_classification_missing` | a mapping/object cites no registered source/proof classification |
| `source_claim_contradictory` | sources conflict and no dated supersession resolves them |
| `normative_schema_missing` | an external AP4M field/path is asserted as verified without a normative versioned source |
| `public_input_support_upgrade_denied` | public-claim input requests fixture, sandbox, or live support |
| `fixture_support_upgrade_denied` | synthetic fixture input requests sandbox or live support |
| `sandbox_gate_missing` | sandbox-gated state is requested without a gate record |
| `sandbox_gate_malformed` | gate record violates its closed shape, authority/source, scope, environment, zero-value, or non-implication rules |
| `sandbox_gate_expired` | evaluation time is at/after `expiresAt` |
| `sandbox_gate_revoked` | gate record carries `revoked` status |
| `authority_widening_denied` | external constraints add/increase a cap, subject, merchant, rail, expiry, or reduce approval requirements relative to local policy |
| `duplicate_or_replayed_reference` | nonce/reference is duplicated or replayed within the fixture/report subject |
| `authority_or_voucher_expired` | authority or voucher expiry is at/before evaluation time |
| `subject_binding_mismatch` | merchant, challenge, authority, voucher, work, workflow, or subject refs do not match |
| `spend_cap_exceeded` | requested/committed fixture amount exceeds the effective local cap |
| `voucher_verification_unproven` | voucher is marked verified without allowed proof (fixture assertion only in this lane) |
| `assurance_presented_as_settlement` | assurance/guarantee is used as settlement evidence or finality |
| `redemption_presented_as_settlement` | aggregation/submission/redemption state is used as settlement evidence or finality |
| `non_final_settlement_presented_as_final` | partial/rejected/reversed/refunded/unknown observation is presented as full/final |
| `identity_proof_class_collapse` | identity evidence is used as authority, payment, work-quality, reputation, or support proof |
| `work_evidence_proof_class_collapse` | work evidence is used as attestation, payment, assurance, or settlement proof |
| `unknown_field_defaulted` | an unknown external value is guessed, aliased, defaulted, or coerced |
| `sensitive_material_rejected` | credential, secret, key, PAN, token, signature bytes, or raw voucher material appears outside an explicitly allowed opaque synthetic ref |
| `adjacent_standard_conflated` | AP2, Verifiable Intent, Agent Pay identity, Web Bot Auth, or another adjacent shape is asserted as normative AP4M |
| `live_capability_flag_rejected` | a public/static input sets execution, signing, payment, redemption, settlement, custody, deployment, or partner-support capability true |
| `live_ap4m_unsupported` | any live AP4M operation/support claim is requested at this evidence baseline |

### Support-state refusal mapping

| Requested/input condition | Resulting state | Ordered reason codes |
|---|---|---|
| public-only → fixture/sandbox/live | `unsupported_live_mastercard_ap4m` | [`public_input_support_upgrade_denied`] plus [`live_ap4m_unsupported`] when live was requested |
| fixture → sandbox/live | `unsupported_live_mastercard_ap4m` | [`fixture_support_upgrade_denied`] plus [`live_ap4m_unsupported`] when live was requested |
| sandbox requested; record absent | `unsupported_live_mastercard_ap4m` | [`sandbox_gate_missing`] |
| sandbox record structurally/authority/scope invalid | `unsupported_live_mastercard_ap4m` | [`sandbox_gate_malformed`] |
| sandbox record expired | `unsupported_live_mastercard_ap4m` | [`sandbox_gate_expired`] |
| sandbox record revoked | `unsupported_live_mastercard_ap4m` | [`sandbox_gate_revoked`] |
| any input requests live execution/support | `unsupported_live_mastercard_ap4m` | [`live_ap4m_unsupported`] (after any earlier applicable code) |

## Offline fixture and conformance contract

All fixtures are synthetic, redacted, deterministic, and carry `static_fixture_assertion`. They contain no real credentials, keys, PANs, tokens, wallet addresses, signatures, voucher bytes, merchant data, or transaction identifiers.

### Required fixture set

Positive/static classification:

1. public-concepts-only → `mastercard_ap4m_public_spec_only`;
2. bounded challenge/authority/voucher-shaped synthetic fixture → `mastercard_ap4m_fixture`, with verification `fixture_asserted` only;
3. many vouchers to one unresolved settlement observation;
4. partial reconciliation with explicit discrepancy;
5. settlement unknown after voucher verification.

Fail-closed/negative:

6. public claim attempts support upgrade to fixture/sandbox/live;
7. fixture attempts to set execution/signing/payment/redemption/settlement flags true;
8. external authority widens local spend cap, merchant allowlist, expiry, rail, or approval mode;
9. replayed nonce or duplicate voucher reference;
10. expired authority/voucher;
11. wrong merchant/challenge/workflow binding;
12. over-budget amount;
13. invalid or unverified voucher presented as verified;
14. assurance presented as settlement;
15. redemption submitted presented as settlement;
16. partial/rejected/reversed/refunded settlement presented as full/final;
17. identity presented as authority/payment/reputation;
18. work evidence presented as attestation or payment proof;
19. contradictory/missing source classification;
20. unknown field silently defaulted or guessed;
21. credential/key/PAN/token/signature/raw-voucher material supplied;
22. adjacent AP2/Web Bot Auth field presented as normative AP4M shape;
23. malformed report/fixture structure.

### Exact negative-fixture expectations

| Fixture ID | Negative condition | Expected ordered reason codes |
|---|---|---|
| `AP4M-N01` | public claim upgrades to fixture | [`public_input_support_upgrade_denied`] |
| `AP4M-N02` | public claim upgrades to sandbox | [`public_input_support_upgrade_denied`, `sandbox_gate_missing`] |
| `AP4M-N03` | public claim upgrades to live | [`public_input_support_upgrade_denied`, `live_ap4m_unsupported`] |
| `AP4M-N04` | fixture upgrades to sandbox | [`fixture_support_upgrade_denied`, `sandbox_gate_missing`] |
| `AP4M-N05` | fixture upgrades to live | [`fixture_support_upgrade_denied`, `live_ap4m_unsupported`] |
| `AP4M-N06` | sandbox gate malformed/out-of-scope/non-zero/non-sandbox | [`sandbox_gate_malformed`] |
| `AP4M-N07` | sandbox gate expired | [`sandbox_gate_expired`] |
| `AP4M-N08` | sandbox gate revoked | [`sandbox_gate_revoked`] |
| `AP4M-N09` | fixture sets any live capability flag true | [`live_capability_flag_rejected`, `live_ap4m_unsupported`] |
| `AP4M-N10` | external authority widens local authority | [`authority_widening_denied`] |
| `AP4M-N11` | replayed nonce or duplicate voucher reference | [`duplicate_or_replayed_reference`] |
| `AP4M-N12` | expired authority or voucher | [`authority_or_voucher_expired`] |
| `AP4M-N13` | wrong merchant/challenge/workflow/object binding | [`subject_binding_mismatch`] |
| `AP4M-N14` | amount exceeds effective local cap | [`spend_cap_exceeded`] |
| `AP4M-N15` | unverified voucher presented as verified | [`voucher_verification_unproven`] |
| `AP4M-N16` | assurance presented as settlement | [`assurance_presented_as_settlement`] |
| `AP4M-N17` | redemption presented as settlement | [`redemption_presented_as_settlement`] |
| `AP4M-N18` | partial/rejected/reversed/refunded/unknown presented as final | [`non_final_settlement_presented_as_final`] |
| `AP4M-N19` | identity presented as authority/payment/reputation/support | [`identity_proof_class_collapse`] |
| `AP4M-N20` | work evidence presented as attestation/payment/settlement | [`work_evidence_proof_class_collapse`] |
| `AP4M-N21` | source classification missing | [`source_classification_missing`] |
| `AP4M-N22` | contradictory sources without supersession | [`source_claim_contradictory`] |
| `AP4M-N23` | unknown external field silently defaulted/guessed | [`unknown_field_defaulted`] |
| `AP4M-N24` | sensitive/raw external material supplied | [`sensitive_material_rejected`] |
| `AP4M-N25` | adjacent-standard field asserted as AP4M | [`adjacent_standard_conflated`, `normative_schema_missing`] |
| `AP4M-N26` | invented AP4M field/path asserted as verified | [`normative_schema_missing`] |
| `AP4M-N27` | required report/fixture structure malformed | [`input_malformed`] |

For compound fixtures, concatenate applicable codes in the global evaluation order and de-duplicate without reordering. No implementation may substitute prose-only failures for these identifiers.

### Conformance assertions

- closed vocabularies reject unknown identifiers;
- every mapping row references a registered source and valid RAP target;
- public-source inputs cannot exceed `mastercard_ap4m_public_spec_only`;
- static fixture inputs cannot exceed `mastercard_ap4m_fixture`;
- local policy composition is intersection-only and fails closed;
- each proof object validates independently and cross-object references match subject/workflow;
- voucher/assurance/redemption states never set settlement evidence;
- settlement evidence never sets work or attestation verdicts;
- output is deterministic, input-pure, JSON-serializable, and secret-free;
- blocked reports contain no authorizing/executable handoff object;
- guardrails stay literal false for every live capability.

## Later implementation and gates

The exact future file plan and ordered operations are in [REASONS-LITE](../spdd/prompt/mastercard-ap4m-compatibility.md#s--structure--exact-later-file-plan). This document grants no implementation authority.

Before a future implementation can merge:

1. #692's spec is independently accepted;
2. implementation authority is explicit and isolated to the static package surfaces;
3. focused and full package tests pass offline;
4. export, naming, artifact, diff, leak, forbidden-import, and no-I/O guards pass;
5. exact-head independent QA reports zero Critical/High/material gaps;
6. maintainer merge authority is separate;
7. #338/#679/#691 and child dependencies are refreshed after merge without auto-starting #693–#697.

## Change-course triggers and unresolved questions

Re-open this contract if a normative AP4M schema reveals a different lifecycle or collapses/separates objects differently. Do not silently retrofit.

Residual questions that remain **Unknown**, not blockers for a static spec:

- What are the exact buyer/seller API versions and payloads?
- What voucher format, signing algorithm, canonicalization, key discovery, revocation, and replay rules apply?
- What makes assurance enforceable, conditional, expired, disputed, or revoked?
- How are vouchers aggregated, redeemed idempotently, partially rejected, reversed, or refunded?
- How are multi-rail settlement finality, fees, FX, and reconciliation represented?
- What data, retention, geography, licensing, and commercial terms apply?
- How do AP4M, Verifiable Intent, AP2, Agent Pay identity, and Web Bot Auth relate normatively?

Those questions route to later gated work. Their absence must never be hidden by synthetic fields.
