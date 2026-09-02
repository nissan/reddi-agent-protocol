# RAP Assurance public claim boundary

This repository's public and contributor-facing claims should use this boundary unless a later audited release note supersedes it.

## Central message

> Payments prove transfer; RAP Assurance proves paid work.

RAP Assurance (Reddi Agent Protocol Assurance) is an open, integration-first receipt and conformance layer for paid MCP/API and agent work. It binds work terms, buyer policy, payment-proof references, evidence references, attestation outcomes, replay metadata, and reputation inputs so builders can verify what happened around a paid workflow.

## What the current repository can claim

- Local/offline SDK and package primitives for receipt envelopes, policy decisions, payment-reference handling, evidence binding, replay fixtures, and conformance checks.
- x402/Solana helpers that parse, gate, and verify explicit proof material; the AUDD/SPL path is currently proof/payment-plan/read-only observation metadata unless a separately approved live rail lands.
- A local-first MCP bridge and demos that disclose dry-run, Surfpool/local, or recorded devnet boundaries before any spend or invocation claim.
- Source-level Solana/Quasar/Anchor reference material and tests, with the recorded Quasar devnet deployment blocked by `config/quasar/deployments.json` and no mainnet readiness claim.

## What public copy must not claim yet

- Do not claim RAP Assurance is a broad agent marketplace, app store, generic agent runtime, hosted runtime, wallet/action toolkit, payment facilitator, custody product, or escrow provider.
- Production readiness, mainnet readiness, live AUDD/Solana settlement, unreviewed deployment, legal/compliance approval, or security audit completion.
- Protocol transaction take-rate or collected treasury fees. The 0.05% / 5 bps figure is planned/product-fixture economics only.
- That payment evidence proves work quality, trust, reputation, settlement finality, or dispute outcome by itself.
- That hosted Reddi/Redditech services are required for the OSS core or are live production services unless a separately approved release says so.

## Executable checks

The boundary is enforced in two halves that share one pattern list (`lib/public-claims/public-claim-boundary-terms.ts`):

| Surface | Check |
|---|---|
| Owned prose and package metadata (README/docs/`package.json`) | `npm run check:claims:public` (`.github/workflows/public-claim-boundary.yml`) |
| Rendered app copy and document metadata | `e2e/public-claim-boundary.spec.ts` (blocking Playwright funnel lane) |

`e2e/home.spec.ts` runs in the same lane but is a separate literal-copy regression spec: it asserts the central message renders in the hero and footer, and does not consume the shared pattern list.

The static gate carries a negative control: `node scripts/check-public-claim-boundaries.mjs --negative-control` injects every forbidden claim's affirmative example and must exit 1, so a gate that has stopped catching overclaims fails CI.

## Evidence artifacts that are not committed

`artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md` does not exist in this repository and was deliberately not created during the RAP Assurance claim remediation. `latest` is a generated convenience symlink produced by a local prep run; only the timestamped run directories under `artifacts/economic-demo-submission-prep/` are committed.

The truthful resolution is to cite the newest committed timestamped run, not to author a stand-in file. Docs that reference the `latest` path are labelled as pointing at a generated artifact, and `scripts/check-submission-claim-boundaries.mjs` resolves the newest committed run instead of requiring the symlink. Do not fabricate the missing file to make a guard pass.

## Preferred positioning

Describe RAP Assurance as complementary to payment and agent-discovery standards/products such as x402, MPP/Stripe-style machine payments, AP2, MCP Registry, A2A, AGNTCY/OASF, Pay.sh/PayAI, and Solana/AUDD adapters. Those systems can prove or route payment and discovery; RAP Assurance records the paid-work lifecycle around them.
