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

| AP4M public concept | RAP target | Mapping | Source/proof | Loss/unknown boundary |
|---|---|---|---|---|
| provider discovery | `IdentityEvidenceRef` plus source-adapter provenance | `lossy` | first-party public claim | directory schema, freshness, verification and identifiers unknown |
| Agent Principal / delegated rules | `AuthorityConstraintRef` then local buyer-policy intersection | `lossy` | first-party public claim + RAP existing contract | external credential/schema and revocation unknown; never widens local authority |
| HTTP 402 challenge | `PaymentChallengeRef` | `lossy` | first-party public claim | exact headers/body/terms schema unknown |
| signed payment voucher | `VoucherRef` | `lossy` | first-party public claim | exact format, signer, algorithm, canonicalization and verification API unknown |
| payment guarantee/assurance | `PaymentAssuranceRef` | `lossy` | first-party public claim | issuer obligations, exclusions, expiry and dispute terms unknown |
| voucher aggregation/redemption | `RedemptionObservation` | `lossy` | first-party public claim | batch schema, submission states, idempotency and rejection codes unknown |
| multi-rail settlement | `SettlementObservation` plus reconciliation | `lossy` | first-party public claim | rail APIs, finality rules, fees, partial/reversal semantics unknown |
| service delivery after voucher acceptance | `WorkEvidenceRef` | `metadata_only` until evidence exists | first-party public claim + RAP existing contract | product claim is not proof of a particular delivery |
| work judgment/accountability | `AttestationRef` | `unknown` as an AP4M feature; RAP-owned separately | RAP existing contract | must not be inferred from payment assurance |
| HTTP signature/key directory/nonce | optional identity profile, not core AP4M voucher | `metadata_only` | adjacent public claim | adjacency is not schema identity; #695 owns future profile |
| AP2 / Verifiable Intent relationship | authority provenance reference only | `unknown` | adjacent/public context | no interchangeability or common field shape claimed |
| Early Access buyer/seller APIs | future adapter surfaces | `gated` | first-party public claim | exact schemas, terms, credentials and behavior unknown |
| live voucher/payment/settlement execution | none | `unsupported` | current evidence baseline | requires later approvals, contracts, implementation, and proof |

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
22. adjacent AP2/Web Bot Auth field presented as normative AP4M shape.

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
