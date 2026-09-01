# x402 Adapter Retention Decision

Issue: [#519](https://github.com/nissan/reddi-agent-protocol/issues/519)

Date: 2026-06-24

Status: accepted for OSS v0.1 planning. Implementation is unchanged; package metadata was
subsequently updated (2026-08-31) so both manifests carry `"private": true` and a deferred
description, which `scripts/check-oss-release-smoke.mjs` now enforces.

This decision covers the repo-local framework adapters:

- `@reddi/sendai-x402` in `packages/sendai-x402`
- `@reddi/eliza-plugin-x402` in `packages/eliza-plugin-x402`

It does not change `@reddi/x402-solana`, `@reddi/rap-mcp-bridge`, source adapters, hosted services, payment programs, or marketplace state.

## Decision

Both framework adapters are deferred from the public OSS v0.1 supported package set and should be labeled experimental before any broader developer-facing distribution.

| Package | v0.1 decision | Rationale |
| --- | --- | --- |
| `@reddi/sendai-x402` | Defer post-v0.1; keep as experimental repo-local adapter | It has useful mocked unit coverage for client and earn-side flows, but it still wraps stubbed escrow behavior, has no README, has no npm publication metadata, and does not prove SendAI runtime integration in a clean consumer app. |
| `@reddi/eliza-plugin-x402` | Defer post-v0.1; keep as experimental repo-local adapter | It has mocked action tests and a broader Eliza action surface, including an opt-in private swap action, but it has no README, no marketplace/package publication readiness evidence, no live Eliza runtime smoke, and still depends on stubbed escrow behavior from the x402 rail. |

Neither package should be included in a public v0.1 release claim, npm publish plan, marketplace listing, or supported integration matrix until the acceptance gates below pass from a clean checkout.

## Inventory

### `@reddi/sendai-x402`

Manifest: `packages/sendai-x402/package.json`

- Name/version: `@reddi/sendai-x402@0.1.0`
- Description: Experimental repo-local SendAI x402 adapter; not part of the public v0.1 package set.
- Publication flag: `"private": true` (enforced by `scripts/check-oss-release-smoke.mjs`)
- Entry points: `dist/index.js`, `dist/index.d.ts`
- Scripts: `clean`, `build`, `test`
- Runtime dependencies: `@reddi/x402-solana` via `file:../x402-solana`, `@solana/web3.js`
- Peer dependency: `@sendai/agent-kit >=0.1.0`
- Dev dependencies: Jest, ts-jest, TypeScript, Node/Jest types
- README/docs: none found in the package directory

Source surface:

- `src/middleware.ts` exports `x402Fetch`, a fetch wrapper that handles `402` responses with `X-Payment-Request`, calls `sendPayment` through `@reddi/x402-solana`, and retries with `X-Payment-Proof`.
- `src/earn.ts` exports `x402EarnHandler`, a service wrapper that returns `402` without proof and releases a deterministic mock escrow string after a successful service response.
- `src/wallet.ts` loads a keypair from the environment.
- `src/index.ts` re-exports the middleware, earn handler, and wallet helper.

Tests:

- `tests/middleware.test.ts` mocks network/payment behavior and covers pass-through `200`, `402` retry with proof, and insufficient-funds propagation.
- `tests/earn.test.ts` mocks Solana I/O and covers missing proof, successful service execution, and non-`200` service response behavior.

### `@reddi/eliza-plugin-x402`

Manifest: `packages/eliza-plugin-x402/package.json`

- Name/version: `@reddi/eliza-plugin-x402@0.1.0`
- Description: Experimental repo-local ElizaOS x402 adapter; not part of the public v0.1 package set.
- Publication flag: `"private": true` (enforced by `scripts/check-oss-release-smoke.mjs`)
- Entry points: `dist/index.js`, `dist/index.d.ts`
- Scripts: `clean`, `build`, `test`
- Runtime dependencies: `@reddi/x402-solana` via `file:../x402-solana`, `@elizaos/core`, `@solana/web3.js`, `tweetnacl`
- Dev dependencies: Jest, ts-jest, TypeScript, Node/Jest types
- README/docs: none found in the package directory

Source surface:

- `src/index.ts` exports an Eliza plugin with `x402_pay`, `x402_earn`, and `x402_private_swap` actions.
- `src/actions/pay.ts` locks escrow from an x402 payment request or fallback request.
- `src/actions/earn.ts` returns a `402` payment request when no proof is present and releases escrow after proof validation.
- `src/actions/privateSwap.ts` is feature-flagged by `X402_ENABLE_VANISH_PRIVATE_SWAP` and calls a Vanish Core client when enabled.
- `src/utils/escrow.ts` wraps `@reddi/x402-solana` helper imports and returns deterministic mock lock/release results where full on-chain behavior is not wired.
- `src/utils/wallet.ts` and `src/utils/vanish.ts` load environment-backed wallet/provider configuration.

Tests:

- `tests/pay.test.ts` mocks wallet and escrow helpers and covers happy path, insufficient funds, and fallback request handling.
- `tests/earn.test.ts` mocks wallet and escrow helpers and covers valid proof, missing proof, and escrow owner mismatch.
- `tests/privateSwap.test.ts` mocks Vanish Core and covers disabled-by-default behavior plus the enabled mocked happy path.

## Relationship To Core x402 Packages

`@reddi/x402-solana` remains the lower-level Solana x402 rail package. These adapters currently sit above it and translate package-specific framework actions or middleware into x402 challenge/proof flows. Their tests mock Solana, escrow, network, and provider behavior, so their current evidence is adapter-shape evidence rather than live payment or settlement evidence.

`@reddi/rap-mcp-bridge` remains the stronger post-v0.1 x402 proof/smoke consumer because it has a clearer bridge package boundary, runbooks, smoke scripts, and docs around x402 specialist calls. For OSS v0.1 planning, the bridge can consume or demonstrate x402 boundaries without implying the SendAI or Eliza adapters are supported public SDKs.

If either framework adapter is revived later, it should depend on the stable public surface of `@reddi/x402-solana` or a future higher-level agent protocol package rather than copying settlement claims into adapter docs.

## Required Changes Before Public Inclusion

Before either adapter moves from experimental/deferred to a v0.1 or later public candidate:

1. Add package README content that labels the adapter experimental until all release gates pass.
2. Done (2026-08-31): both manifests set `private: true` and describe themselves as deferred experimental adapters, preventing accidental public support signaling until an approved publish plan exists.
3. Replace or explicitly label mock escrow helpers so developers cannot confuse deterministic test values with Solana settlement.
4. Add clean-checkout installation, build, test, and pack dry-run evidence.
5. Add a minimal host-framework smoke:
   - SendAI: a minimal `@sendai/agent-kit` consumer fixture proving the middleware can be installed and invoked without live payment.
   - Eliza: a minimal Eliza runtime fixture proving the plugin can load, register actions, and execute mocked action flows without provider calls.
6. Document claim boundaries in the package README and examples.
7. Keep live payment examples behind explicit opt-in flags, separate spend policy, and human-approved credentials.

## #512 Acceptance Guidance

For #512 clean-checkout OSS v0.1 release smoke, these packages should be excluded unless a later issue explicitly promotes them.

If either package is included later, #512 should require:

- `npm install` or equivalent package install from a clean checkout with no secrets.
- `npm run build` in the adapter package.
- `npm test` in the adapter package with all Solana, wallet, network, and provider calls mocked.
- A framework host smoke as described above.
- `npm pack --dry-run` inspection showing no secrets, `.env` files, local logs, generated proof artifacts, wallet keypairs, or unrelated app output.
- README examples that run locally with deterministic fixtures or mocks.
- Root naming/claim-boundary checks that apply to public docs, including `npm run check:rap:naming` when RAP naming appears.
- `git diff --check`.

The #512 gate should fail any adapter release claim that requires a Solana keypair, funded wallet, RPC endpoint, provider credential, hosted Reddi service, marketplace mutation, or live payment.

## Explicit Non-Claims

This decision introduces no npm publish, live payment, wallet/RPC/provider call, hosted write, marketplace publication, trust/reputation mutation, mainnet usage, custody flow, or settlement-finality claim.

The package tests and examples reviewed here are mocked or local-only evidence. They do not prove production payment enforcement, on-chain escrow completion, provider privacy, framework marketplace readiness, or end-user settlement guarantees.

## Follow-Up Work

- Keep the experimental/private package metadata in step with `excludedPackages` in `scripts/check-oss-release-smoke.mjs` if either adapter is renamed or promoted.
- Add package READMEs only if a future issue wants these adapters visible to developers before support promotion.
- Revisit the decision after `@reddi/x402-solana` has a stable public release surface and `@reddi/rap-mcp-bridge` release smoke is finalized.
