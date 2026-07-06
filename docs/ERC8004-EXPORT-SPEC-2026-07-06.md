# RAP → ERC-8004 Export Spec — `reddi.erc8004-export.v1` (#562)

**Status: v1 spec (promoted from the PR #570 DRAFT by issue #562).**
Module: `packages/agent-protocol/src/erc8004-export.ts` · Conformance: `packages/agent-protocol/src/erc8004-export-conformance.ts` (`reddi.erc8004-export-conformance.v1`) · Tests: `packages/agent-protocol/tests/erc8004-export*.test.ts`.

A **one-way, offline** projection from Reddi Agent Protocol (RAP) records into ERC-8004 "Trustless Agents" registry payload shapes an EVM operator *could* submit. This package never submits anything: no chain access, no RPC, no signer, no minting, no live signature verification, anywhere.

## Scope and positioning

- **Sources (all local, all validated before export):**
  - `reddi.receipt.v1` (required) — identity + validation material,
  - `reddi.attestation.v1` (optional) — reputation material,
  - `reddi.reputation-credential.v1` (#565, optional) — portable signed credential, **composed by reference** (see below).
- **Targets:** the three ERC-8004 registries the standard names — **Identity**, **Reputation**, **Validation** — as payload *shapes*, not transactions.
- **Standard-neutral positioning:** RAP receipts are Solana-native; this export exists so RAP evidence is not Solana-siloed. The export emits a CAIP-10-style Solana back-reference so an EVM-side reader can locate the Solana-native agent. Nothing about RAP semantics changes; ERC-8004 is one export target among possible others.
- **External-standard provenance:** ERC-8004 is an external draft standard. Every ERC-8004-side field name in the module is an interface-level reference tagged `(unverified — ERC-8004 draft standard)`, and every emitted bundle carries `externalStandard: { fieldShapesVerified: false, deploymentClaim: false }`. Promotion of the RAP-side spec does **not** upgrade confidence in the external draft.

## One-way boundary (hard rule)

RAP → ERC-8004 **only**. Nothing in this package reads, imports, or trusts ERC-8004 registry state (identity, feedback, or validation entries) back into RAP routing, reputation, or trust decisions. Every bundle asserts `guardrails.trustImported: false`, and the gap is documented fail-closed in `ERC8004_UNSUPPORTED_FIELDS` (`behavior: 'blocked'`). Any future ERC-8004 → RAP trust import requires a separate, operator-approved issue with its own trust review.

## Chains (documentation only — no deployment claim)

The #562 issue text names Ethereum, Base, Polygon, Monad, and BNB Chain as chains where ERC-8004 registries live. These are recorded in `ERC8004_DOCUMENTED_CHAINS` with `deploymentClaim: false` and `verified: false` on every row (Monad's CAIP-2 id is left `null` — unconfirmed offline). This spec claims **no deployment on any chain** and never checks one; `targetChainHint` is an operator-supplied CAIP-2 `eip155:*` fixture placeholder, validated for shape only and rejected fail-closed (`unsupported_chain_hint`) otherwise.

## Registry mappings (per-field provenance)

Machine-readable source of truth: `ERC8004_EXPORT_FIELD_PROVENANCE` (each row: registry, field, source path, `rap-native` vs `erc8004-draft-interface` confidence, lossy note). Summary:

### Identity Registry (registration file + `setMetadata`-style key/values; never minted)

| Field | Source | Notes |
|---|---|---|
| `caipAgentRef` | operator option | `null` unless the operator already holds an EVM registration; RAP cannot derive a tokenId locally |
| `registrationFile.name` | receipt `$.specialist.id` | rap-native |
| `registrationFile.endpoint` | receipt `$.specialist.endpoint` | rap-native |
| `registrationFile.solanaAgentRef` | derived `$.payment.network` + `$.specialist.id` | CAIP-10-style pointer, not a validated CAIP-10 account id |
| `registrationFile.protocol` | receipt `$.protocol` | rap-native |
| `metadata[]` | derived `reddi.*` keys | key vocabulary is exporter-defined; upstream `setMetadata` vocabulary unverified |

### Reputation Registry (one attestation → one `giveFeedback(...)`-style arg set)

| Field | Source | Notes |
|---|---|---|
| `value` + `valueDecimals` | attestation `$.confidence` | lossy: clamped 0..100 integer, fixed-point decimals=2 |
| `tag1` | attestation `$.verdict` | always `passed` in v1 (see exclusions) |
| `tag2` | attestation `$.rubric.dimensions[0].id`, fallback receipt `$.job.type` | lossy: only the first rubric dimension |
| `endpointURI` | receipt `$.specialist.endpoint` | |
| `payloadURI` / `payloadHash` | attestation `$.evidenceRef` / `$.evidenceHash` | URI + hash **only** — raw evidence payloads never export |
| `credentialRef` | `reddi.reputation-credential.v1` | composition, see below |

### Validation Registry (optional; flagged `experimental: true`)

Emitted only on `includeValidation: true`, always with reason code `validation_registry_experimental` (upstream flags this registry as under active update). Maps receipt `$.requestHash` / `$.responseHash` / `$.evidenceRef` plus the normalized attestation score.

## Composition with `reddi.reputation-credential.v1` (#565 / PR #569)

The portable reputation credential **composes, it is not duplicated**. When a credential is supplied:

1. it is verified fully **offline** (`verifyReputationCredential` — ed25519 over the canonical body); failure → blocked `reputation_credential_invalid`;
2. its subject must equal the receipt specialist → else blocked `reputation_credential_subject_mismatch`;
3. its evidence hashes must include the attestation's evidence hash → else blocked `reputation_credential_evidence_mismatch`;
4. only then does the reputation payload gain a `credentialRef` — credential id, subject, score, evidence hashes, and the proof envelope (public key, canonicalization) **without the signature**. The credential itself travels separately and remains independently verifiable offline.

## Exclusion rules (fail-closed; what never exports)

Source vocabulary marks these non-final/unproven — none of them ever produce an ERC-8004 entry:

| Excluded source state | Reason code | Behavior |
|---|---|---|
| Rail-neutral `probe_only` receipts (#580/#588 cap, e.g. Airwallex webhook receipts) | `probe_only_receipt_excluded` | blocked; also caught if the rail-neutral object is passed to the exporter directly |
| Rail-neutral `receipt_binding_candidate` receipts | `rail_neutral_bridge_required` | blocked; must bridge into `reddi.receipt.v1` via the rail-neutral proof chain first |
| Rail-neutral `unsupported_receipt_v1_network` receipts | `unsupported_network_asset` | blocked |
| Receipts without a payment proof ref (dry-run / unproven) | `payment_proof_missing_excluded` | blocked |
| Receipts with `attestationStatus: failed \| rejected` (failure-final) | `non_final_receipt_excluded` | blocked, even if a passed attestation is supplied |
| Receipts with `attestationStatus: pending \| not_requested` + supplied attestation | `attestation_state_excluded` | attestation excluded; identity `metadata_only` at most |
| Attestations not `verdict: passed` + `workStatus: completed` (failed/disputed/refunded) | `attestation_state_excluded` | excluded; negative-feedback export is out of v1 scope |
| Attestations whose `receiptId` does not reference the receipt | `attestation_receipt_mismatch` | excluded |
| Non-`eip155:*` chain hints | `unsupported_chain_hint` | blocked |
| Credential-shaped material anywhere in input or output | `credential_leakage_rejected` | blocked |
| Any `submit` / `broadcast` / `sign` request | `onchain_write_not_permitted` | blocked before any payload is built |

The eligibility gate is exported standalone as `evaluateErc8004SourceEligibility(source)` for pre-flight checks.

## Unsupported / lossy surface (documented fail-closed)

`ERC8004_UNSUPPORTED_FIELDS` records every ERC-8004 surface RAP cannot or will not populate, with an explicit behavior (`null` / `omitted` / `blocked` / `excluded`): on-chain agentId/minting, EVM feedback authorization/signatures, registry write lifecycle (revoke/append), negative feedback, full multi-dimension rubrics, raw evidence payloads, registry contract addresses, and ERC-8004 trust import into RAP.

## Conformance (no-live round-trip proof)

`reddi.erc8004-export-conformance.v1` proves the #562 round-trip deterministically and offline:

- `verifyErc8004ExportAgainstSource(bundle, source)` — recomputes every exported field from the RAP source and compares (identity from receipt; reputation value/tags/evidence from attestation; validation from receipt hashes; credentialRef re-verified offline against the supplied credential; guardrails all-false; no invented top-level fields; chain hints CAIP-2-shaped placeholders with no deployment claim). Any tampering with either side fails a named check. Blocked bundles never round-trip.
- `listErc8004ConformanceFixtures()` / `runErc8004ConformanceSuite()` — an executable fixture set covering the full export round-trip, metadata-only export, and every exclusion lane above (probe-only, bridge-required, dry-run-without-proof, failure-final receipt, pending receipt, disputed attestation, mismatched attestation, bad chain hint).

## Boundaries recap

No chain access, no RPC, no live calls, no EVM writes, no signer, no minting, no live signature verification, no raw-evidence export, no trust import. Pure synchronous functions over local records and static fixtures — enforced by tests (offline-only source guards, guardrail assertions, leak scans).

Related: #562 (this spec), PR #570 (DRAFT export), #565 / PR #569 (portable reputation credential), #580 / PR #588 (probe-only cap), #338 (rail-neutrality epic; revoked/contested receipt-state gap).
