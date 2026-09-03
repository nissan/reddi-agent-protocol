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
| First-party rendered copy on 17 gated routes | `e2e/public-claim-boundary.spec.ts` (blocking Playwright funnel lane) |

The DOM half gates exactly these 17 routes: `/`, `/adl`, `/agents`, `/customize`, `/dogfood`, `/economic-demo/public-proof`, `/faq`, `/feedback`, `/judge-replication`, `/mcp-bridge-demo`, `/playbook`, `/spec`, `/start`, `/testers`, `/tour`, `/updates`, `/whitepaper`. On each it scans the rendered DOM with every `data-claim-scope="external"` subtree removed. That marker is scoped to the individual fields a card renders from text this repository did not author — a specialist's `name`, `model`, and task types, which come from a devnet registrant; a candidate's `name`, `description`, tags, and resource/media type, which come from an imported catalog. It is never applied to a whole card, so the repository's own card copy (render-state banners, source/trust/readiness badges, `Resource`/`Media type` labels, the specialist card's repository-authored resource/media defaults, `Attested`/`Unverified`, the downstream-dependency line) stays inside the scan. Two controls in the same spec prove both directions: injected text inside an external subtree is not scanned while the identical text in first-party copy is, and the real `MarketplaceCandidateCard` on `/agents` — fixture-backed, so its absence is a breakage rather than a quiet run — is checked to drop its imported fields and keep its owned copy.

`app/` has 45 page routes. The 28 that are not DOM-gated are covered by review rather than by this gate, for these reasons:

| Not gated | Routes |
|---|---|
| Copy sits behind a wallet connection or multi-step flow state | `/register`, `/planner`, `/onboarding`, `/onboarding/intake`, `/attestation`, `/consumer`, `/dashboard`, `/economic-demo`, `/economic-demo/z-picture-demo` |
| Body depends on a live network or API read, so a gate here would put RPC/route latency on a blocking lane | `/leaderboard`, `/runs`, `/audit`, `/demo`, `/circle-x402`, `/orchestrator`, `/specialist`, `/setup`, `/manager`, `/economic-demo/z-picture-proof`, `/economic-demo/z-picture-onchain-proof` |
| Primary body is a third-party, imported, or user-entered record this repository does not author | `/agents/[wallet]`, `/agents/candidates/[id]`, `/manager/discovery`, `/manager/listings`, `/onboarding/profile-editor`, `/onboarding/readiness-gate` |
| Known pattern false positive: enumerates the contract-only flags it declares false, which the shared list reads as an unqualified AUDD claim | `/economic-demo/paid-workflow` |
| Redirect only; renders no copy of its own | `/features` |

`/leaderboard` was gated earlier and was removed: it is `force-dynamic` over a devnet `getProgramAccounts` call that carries no `AbortSignal`, so gating it made a live RPC a blocking-lane dependency.

`e2e/home.spec.ts` runs in the same lane but is a separate literal-copy regression spec: it asserts the central message renders in the hero and footer, and does not consume the shared pattern list.

The static gate carries a negative control: `node scripts/check-public-claim-boundaries.mjs --negative-control` injects every forbidden claim's affirmative example and must exit 1, so a gate that has stopped catching overclaims fails CI.

## Evidence artifacts that are not committed

`artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md` does not exist in this repository and was deliberately not created during the RAP Assurance claim remediation. `latest` is a generated convenience symlink produced by a local prep run; only the timestamped run directories under `artifacts/economic-demo-submission-prep/` are committed.

The truthful resolution is to cite the newest committed timestamped run, not to author a stand-in file. Docs that reference the `latest` path are labelled as pointing at a generated artifact, and `scripts/check-submission-claim-boundaries.mjs` resolves the newest committed run instead of requiring the symlink. Do not fabricate the missing file to make a guard pass.

## Preferred positioning

Describe RAP Assurance as complementary to payment and agent-discovery standards/products such as x402, MPP/Stripe-style machine payments, AP2, MCP Registry, A2A, AGNTCY/OASF, Pay.sh/PayAI, and Solana/AUDD adapters. Those systems can prove or route payment and discovery; RAP Assurance records the paid-work lifecycle around them.
