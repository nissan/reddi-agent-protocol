# Changelog — @reddi/agent-protocol

All notable changes to this package are documented here. Dates are AEST.

## Unreleased

### Added

- Public AUDD rail config and identity validator for deterministic fixtures, generated local test mints, explicitly blocked/unverified devnet, and gated mainnet. Official Solana mainnet AUDD mint/token-program/decimals provenance is recorded, while mainnet stays disabled by default.
- Rail-neutral canonical payment job/agreement/intent/observation/refund records and deterministic canonical SHA-256 ID helpers, with environment and grant-eligibility labels that reject fixture/devnet evidence as eligible volume.
- AUDD x402 v2 SVM `exact` bridge helpers layered onto the existing `reddi.audd-payment-plan.v1` plan for deliberate legacy compatibility. Models can create draft intents only; non-fixture spend still requires policy and operator approval.
- Optional receipt/evidence binding for confirmed non-live payment observations, preserving no-wallet/no-RPC guardrails and rejecting fixture/devnet observations marked grant eligible or observations that do not exactly match the AUDD plan.

## 0.1.0 — 2026-07-06

First release-candidate cut of the public RAP (Reddi Agent Protocol) primitives package. Everything below runs locally on deterministic fixtures — see Boundaries.

### Added

Module areas (each area maps to one or more declared subpath exports; the full export map lives in `package.json` and every target is verified by the exports guard, `npm run check:exports` — do not treat any list here as exhaustive):

- **Receipts and policy** — receipt envelope validation, policy decisions, buyer-authority policy, and seller wrapper configuration for paid-agent-work workflows.
- **Discovery and catalog ingestion** — AI Catalog ingestion, discovery source candidates, provider trust records, and the static agent-stack fixture corpora. Static ingestion is metadata transformation only: publication stays disabled, payment activation stays disabled, provider trust stays unverified, and imported content stays untrusted until later operator and readiness gates pass.
- **Evidence and proof surfaces** — EvidenceArchive, receipt–evidence binding, rail-neutral payment receipts and the rail-neutral proof-chain fixture, Pay.sh sandbox evidence (fixture refs only), source-aware diagnostics, and the source/trust conformance matrix.
- **Attestation and reputation** — attestation/reputation primitives, off-chain reputation preview (projection only — it does not mutate reputation state), reputation credential export, and the hosted attestation claim shape (fails closed as `publication_gate_pending` without operator approval and publication-gate metadata).
- **Quasar registry compatibility** — metadata-only compatibility surface; no custody or program-execution claims.
- **Buyer client and seller middleware** — local buyer/seller flow helpers, including the buyer–seller dry-run example.
- **AUDD/Solana payment plans** — preflight-only planning helpers. These do not contact Airwallex, invoke providers, call wallets/RPC endpoints, transfer SPL tokens, activate Pay.sh, or settle funds.
- **Framework templates** — the framework template contract, framework-template conformance suite and fixtures, and the LangGraph, ADK, and Strands RAP templates.
- **Interop exports (external-standard status noted below)** — ERC-8004 export + conformance, AP2 mandate ingestion + conformance, Airwallex hosted-checkout rail + webhook receipt normalization, OKF adapter/conformance/instruction-safety, and MPP/Tempo receipt shapes.
- **Onboarding** — onboarding-analyser handoff and onboarding state machine surfaces.
- **Runnable no-spend examples** — `examples/ard-no-spend-demo.mjs`, `examples/buyer-seller-dry-run.mjs`, and the `examples/ard-no-spend-ai-catalog.json` fixture, shipped in the package tarball.

### Draft / unverified labels (honest status)

- The RAP-side ERC-8004 mapping and the RAP-side AP2 adapter contract are promoted specs (#562/#563), but **ERC-8004 and AP2 are external draft standards** — external-standard field references carry inline `(unverified — <standard> draft)` tags in the source and type docs, and promotion of the RAP-side contract does not upgrade confidence in the external drafts.
- The **Airwallex hosted-checkout rail surface is DRAFT v1** (`AIRWALLEX_HOSTED_CHECKOUT_RAIL_DRAFT = true`): draft/unverified external-rail shapes, with the fiat asset kept in a draft namespace outside the frozen buyer-authority asset union.

### Quickstart and conformance

```bash
# ARD No-Spend Quickstart (Discover -> Decide -> Prove on fixtures)
npm run example:ard:no-spend

# Consolidated public conformance suite (from the repo root: npm run check:conformance:public)
npm run conformance

# Full local release gate
npm run release:dry-run
```

### Boundaries

All v0.1.0 surfaces are local-first and fail closed: **no spend, no custody, no live settlement**. The package does not require or perform live payments, does not hold or move funds, and makes no settlement-finality claims. It runs without hosted Reddi infrastructure, ARD registry access, wallet keys, RPC calls, SPL transfers, paid provider calls, secrets, marketplace publication, or trust/reputation mutation. Discovery relevance is never trust, budget, payment, or publication approval. These boundaries are consistent with the README and are enforced mechanically by the claim-boundary scan in `npm run check:oss-release-smoke`.
