# AP2 Mandate Ingestion Spec — `reddi.ap2-mandate-ingestion.v1` (#563)

**Status: v1 adapter contract (promoted from the PR #571 DRAFT by issue #563).**
Module: `packages/agent-protocol/src/ap2-mandate-ingestion.ts` · Conformance: `packages/agent-protocol/src/ap2-mandate-conformance.ts` (`reddi.ap2-mandate-conformance.v1`) · Tests: `packages/agent-protocol/tests/ap2-mandate-*.test.ts`.

A **pure, no-network, fixture-only** adapter that ingests a signed Google AP2 (Agent Payments Protocol) mandate fixture into the RAP buyer-authority policy gate and references it from the receipt — with **zero settlement-finality claim by construction**. Under rail-neutrality epic #338.

## Scope and positioning

- **AP2 is a trust/authorization layer, NOT a settlement rail.** A mandate is ingested exclusively as a buyer-authority policy *input*; nothing about it ever asserts payment execution, custody, or settlement.
- **Sources:** a static, signed AP2 Checkout/Payment mandate fixture (Cart + Payment vocabulary; Sept-2025 launch names plus the v0.2 Open/Closed staging read from ap2-protocol.org, both unverified).
- **Targets:** `reddi.buyer-authority-policy.v1` constraint composition (the local policy is the ceiling) and a non-secret `mandateRef` bindable to `reddi.receipt.v1` metadata.
- **External-standard provenance:** AP2 — and its FIDO / Visa TAP / Mastercard Verifiable Intent governance context — is an external draft standard. Every AP2-side field name keeps its inline `(DRAFT/unverified — <standard>)` tag, and every result carries `AP2_EXTERNAL_STANDARD: { fieldShapesVerified: false, signatureVerification: 'fixture-asserted', governanceLineageVerified: false, settlementRail: false }`. Promotion of the RAP-side contract does **not** upgrade confidence in the external draft. The `AP2_RAIL_SUPPORT_STATE_MATRIX` rows likewise stay `draft: true` / `confidence: 'low'` — they describe the external vocabulary.

## Signature and key boundary (hard rule)

**Signature verification is FIXTURE-ASSERTED only.** There is no cryptographic verification of any Visa / Mastercard / FIDO / VDC material anywhere in this package, and no key handling:

- The VDC signature is a single OPAQUE blob at `vdc.signatureB64`; it is stripped before hashing and scanning, is never verified against any key, and never appears in any output (test-enforced leak scans).
- Signature-, JWS-, or proof-shaped material anywhere **outside** that one opaque slot fails closed (`signature_material_rejected`) — a mandate smuggling scheme-level signature fields is rejected, and so is a mandate *ref* smuggling them at receipt-binding time.
- Guardrails assert `vdcSignatureVerifiedLive: false` and `keyMaterialHeld: false` on every result. The envelope format itself (JWT vs SD-JWT vs LD-Proof) is unverified upstream.

## Ingestion (`ingestAp2Mandate(mandate, now)`)

Fail-closed lanes, each with a reason code:

| Input state | Reason code | Support state |
|---|---|---|
| Malformed / missing VDC envelope | `mandate_malformed` | probe-only |
| Mandate type outside the supported vocabulary | `unsupported_mandate_type` | probe-only (never coerced) |
| Credential-, key-, or PAN-shaped material | `mandate_contains_credentials` | `unsupported_live_ap2_settlement` |
| Signature material outside the opaque VDC slot | `signature_material_rejected` | `unsupported_live_ap2_settlement` |
| Settlement-finality claim (field-shaped or textual) | `settlement_finality_claim_rejected` | `unsupported_live_ap2_settlement` |
| Custody claim | `custody_claim_rejected` | `unsupported_live_ap2_settlement` |
| Open / intent / cart-less mandate | `probe_only_no_cart_binding` | probe-only (derives nothing) |
| Expired mandate | `mandate_expired` | probe-only |
| Mandate amount over its own budget cap | `mandate_over_cap` | probe-only |
| Currency outside the AUDD/USDC/SOL fixture rails | `unsupported_currency_rail` | probe-only |
| Amount precision beyond the fixture unit space (2 decimals) | `mandate_malformed` | probe-only (no silent rounding) |

A successful ingestion (`ap2_mandate_ingested`) yields derived constraints plus a `mandateRef` (`sha256` over the canonicalized, signature-stripped mandate). Machine-readable per-field provenance: `AP2_MANDATE_FIELD_PROVENANCE` (each row: target, AP2 source path, `rap-native` vs `ap2-draft-interface` confidence, lossy note). Notable lossy rule: decimal AP2 fixture amounts (≤2 decimals) are normalized **losslessly** into integer *ap2-fixture-centiunits* so the BigInt-based buyer-authority gate can compare them — within-lane only, never a cross-rail unit conversion.

## Policy-gate composition (`composeAp2MandateWithLocalPolicy(localPolicy, ingestion)`)

**FAIL-CLOSED INVARIANT: the local policy always wins or the composition blocks — a mandate must never widen local authority.**

| Dimension | Rule |
|---|---|
| Currency | must already be in the local policy → else blocked (`mandate_currency_not_permitted_locally`); composed policy narrows to the mandate currency |
| Merchant | mandate merchant refs must already be in the local seller allowlist → else blocked (`mandate_merchant_not_allowlisted_locally`); composed allowlist is the intersection |
| Spend cap | local policy MUST carry a per-request cap for the mandate currency on the `ap2-authorization-fixture` lane — a missing local cap never becomes unlimited authority (`local_cap_missing_for_mandate_currency`). Composed cap = MIN(local, mandate); a wider or incomparable mandate cap is recorded (`mandate_cap_wider_than_local_cap`) and the local cap wins |
| Expiry | earlier of local and mandate expiry; a later mandate expiry is recorded (`mandate_expiry_later_than_local`) and ignored |
| Operator approval | escalates when the mandate was human-not-present (`operator_approval_escalated`); never de-escalates |
| Everything else | mode, receipt/evidence requirements, refund/failure policy, and support-state constraints are carried **verbatim** from the local policy — a mandate cannot touch them |

Probe-only or rejected ingestions never compose (`mandate_not_authorizing`); invalid local policies block (`local_policy_invalid`); and the composed policy must itself pass `validateBuyerAuthorityPolicy` (`composed_policy_invalid` otherwise). The composed policy is enforceable by the real `evaluateBuyerAuthorityPolicy` gate — conformance fixtures prove a request one centi-unit above the composed cap is denied with `spend_cap_exceeded`.

## Receipt referencing (`bindMandateToReceipt(receipt, ref)`)

Approved receipts carry a **non-secret** mandate reference only: hash + type + support-state (+ human-present flag), `vdcVerification: 'fixture-asserted'`, `settlementFinalityClaimed: false`. Never mandate contents, cart items, or signature material. Fail-closed:

- `probe_only_ref_not_bindable` — a probe-only mandate authorized nothing; binding it would misrepresent authorization provenance (probe-only/dry-run semantics respected).
- `rejected_mandate_ref_not_bindable` — a rejected mandate ref never binds.
- `signature_material_rejected` — refs with unexpected signature-shaped keys/values never bind.
- `mandate_ref_malformed` — unknown keys, bad hash shape, or claim flags.
- `receipt_invalid_after_binding` — the bound receipt must still pass `validateReddiReceipt`.

## Unsupported / out-of-scope surface (documented fail-closed)

`AP2_UNSUPPORTED_FIELDS` records every AP2/scheme surface RAP cannot or will not handle, with an explicit behavior (`blocked` / `omitted` / `excluded`): live VDC verification, FIDO/Visa/Mastercard key material, card instruments and PANs, settlement finality and custody, cross-unit conversion, mandate lifecycle (revocation/supersession — routes to #338), widening local authority, mandate contents on receipts, and open-mandate spend authorization.

## Conformance (no-live round-trip proof)

`reddi.ap2-mandate-conformance.v1` proves the #563 round-trip deterministically and offline:

- `verifyAp2IngestionAgainstMandate(result, mandate)` — recomputes every derived field and the mandate hash from the mandate source and compares (external-standard honesty, guardrails, currency/cap/merchant/expiry/approval recomputation, signature-leak scan). **Tampering with either side — e.g. a cart total edited after ingestion — fails the named `mandate_hash_recomputes` check.** Non-authorizing results never round-trip.
- `listAp2ConformanceFixtures()` / `runAp2MandateConformanceSuite()` — 20 deterministic, self-checking fixtures: valid ingestion round-trip, tampered payload, expired, over-cap, unsupported currency, unsupported mandate type, signature material, settlement claim, PAN leak, probe-only; six composition cases proving the never-widen invariant numerically and via the real policy gate; four binding cases proving the fail-closed receipt-reference contract.

## Boundaries recap

No live calls, no network, no wallet, no RPC, no key handling, no cryptographic signature verification, no custody, no settlement finality, no live payment — pure synchronous functions over static fixtures, test-enforced (offline-only source guards, no-async guards, unverified-tag guards, leak scans). AP2 field shapes remain unverified against any live implementation.

Related: #563 (this spec), PR #571 (DRAFT adapter), #338 (rail-neutrality epic; support-state vocabulary + mandate-lifecycle gap), #562 / PR #589 (promotion pattern mirrored), #549 (`reddi.buyer-authority-policy.v1`).
