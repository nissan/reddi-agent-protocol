# Reddi Receipt And Policy Decision v1

Issue: [#341](https://github.com/nissan/reddi-agent-protocol/issues/341)

This document defines the first public Reddi Agent Protocol receipt and policy primitives for OSS v0.1. Payment rails settle value; RAP records the policy, evidence, and trust metadata around paid agent work.

## Receipt Envelope

`ReddiReceipt` v1 is a protocol record, not a wallet receipt. It links the work request, specialist, payment proof reference, policy decision, evidence pointer, and attestation state.

Required fields:

- `schemaVersion`: `reddi.receipt.v1`
- `job`: stable job id and optional job type
- `source`: source id plus optional source type or URI
- `payer`: buyer/operator id and optional public payment address
- `specialist`: specialist id and optional endpoint
- `protocol`: `{ name: "Reddi Agent Protocol", version }`
- `payment`: network, asset, amount in the asset's smallest unit, and `paymentProofRef`
- `requestHash`: hash of the request payload or canonical request disclosure
- `responseHash`: hash of the specialist response or denial artifact
- `evidenceRef`: pointer to local evidence, archive record, or future evidence backend object
- `policyDecision`: `reddi.policy-decision.v1`
- `attestationStatus`: `not_requested`, `pending`, `attested`, `failed`, or `rejected`
- `createdAt`: ISO timestamp

Optional `metadata` is allowed only for non-secret annotations. Receipts must never contain wallet key material, provider credentials, bearer tokens, cookies, raw auth headers, seed phrases, mnemonics, API keys, or private customer data.

## Policy Decision

`ReddiPolicyDecision` v1 is machine-readable and designed to survive across buyer, seller, ledger, evidence, and conformance surfaces.

Required fields:

- `schemaVersion`: `reddi.policy-decision.v1`
- `allowed`: boolean allow/deny result
- `reasonCodes`: stable reason-code array
- `quotedAmount`: amount, asset, network, and optional source/specialist ids, or `null`
- `limits`: optional remaining-budget or limit summary
- `asset` and `network`: normalized policy decision context
- `approvalState`: `approved`, `denied`, or `requires_operator_approval`
- `auditNotes`: human-readable notes suitable for operator review
- `operatorNote`: optional operator note

The local budget policy evaluator from #159 maps into this public policy decision shape through `policyDecisionFromBudgetPolicyDecision`.

## Failure Semantics

Validation fails closed with structured errors:

- `payment_proof_missing`: `payment.paymentProofRef` is absent or blank.
- `unsupported_network_asset`: receipt uses an asset/network pair outside the v1 fixture allowlist.
- `malformed_receipt`: required receipt or policy fields are absent, malformed, or use the wrong schema version.
- `credential_leakage_rejected`: metadata contains credential-bearing keys or secret-shaped values.

Unsupported network/asset failures are intentional in v0.1. New rails should be added through explicit adapter work and conformance fixtures rather than accepted silently.

## Fixtures

The package exports deterministic fixtures from `reddiReceiptFixtures`:

- `happyPath`: allowed local USDC devnet dry-run receipt.
- `policyDenial`: denial receipt preserving the policy reason and audit note.

The test suite also covers missing proof reference, unsupported network/asset, malformed receipt, and credential leakage rejection.

## Claim Boundary

RAP receipts prove that a workflow recorded policy, payment-reference, evidence-reference, and trust metadata. They do not by themselves prove final settlement, mainnet execution, provider quality, or legal/compliance approval. Payment adapters and verifiers are responsible for validating settlement-specific proofs.
