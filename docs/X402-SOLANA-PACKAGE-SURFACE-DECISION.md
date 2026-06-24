# `@reddi/x402-solana` Package Surface Decision

Issue: [#518](https://github.com/nissan/reddi-agent-protocol/issues/518)

Status: v0.1 OSS candidate, not yet a public/published package claim.

The `@reddi/x402-solana` package exists at `packages/x402-solana` and remains the Solana/x402 rail primitive underneath RAP. It is not published on npm at the time of this decision, and it must not be described as generally installable or production-ready until #512 proves a clean-checkout release smoke and a later package-publication gate approves publication.

## Current Inventory

- Package path: `packages/x402-solana`
- Package name: `@reddi/x402-solana`
- Version: `0.1.0`
- Main export: `dist/index.js`
- Type export: `dist/index.d.ts`
- Source exports:
  - `types`
  - `nonce`
  - `payment`
  - `middleware`
  - `jupiter`
  - `client`
  - `budget-policy`
- Tests:
  - `tests/payment.test.ts`
  - `tests/client.test.ts`
  - `tests/budget-policy.test.ts`

## Surface Classification

### v0.1 public candidate

These APIs are candidates for #512 clean-checkout OSS smoke if package tests, build, README claim boundaries, and package dry-run checks pass:

- Header and challenge parsing: `parseX402Header`, `buildX402Challenge`, `challengeFromX402RequestHeader`.
- Nonce replay protection: in-memory nonce helpers and `MemoryNonceReplayStore`.
- Demo-only receipt verification: `DemoPaymentVerifier`, `verifyDemoPaymentReceipt`.
- Local buyer preflight: `evaluateBudgetPolicy`, `assetNetworkKey`, budget policy types.
- Pure validation helpers: `isValidSolanaPublicKey`, `isValidPaymentAddress`, USDC amount/cap parsing helpers.

### Gated devnet candidate

These APIs stay gated and must not be presented as default OSS success criteria:

- `prepareDevnetUsdcPayment`
- `executeDevnetUsdcPayment`
- `createSolanaDevnetUsdcPaymentClient`
- `SolanaReceiptVerifier` with `allowRealPayment: true`

They require explicit approval records, endpoint allowlists, spend caps, wallet scope, receipt verification, and the #502/#515 approval-record validator before any fresh devnet or live execution issue can proceed.

### Internal or demo-only until further review

- Express middleware examples are docs-only until a clean no-spend seller/buyer example proves the integration path without implying payment execution.
- Jupiter helpers remain auxiliary; they are not a default v0.1 release claim unless #512 includes a no-network validation path.
- Dist artifacts are generated outputs and must match source before package release smoke claims success.

## Relationship To RAP Surfaces

`@reddi/x402-solana` is not the whole RAP product surface. It owns Solana/x402 rail primitives. Product-level policy, receipts, evidence, attestations, reputation previews, and rail-neutral proof chains are increasingly represented in `@reddi/agent-protocol`.

Current relationship:

- `@reddi/x402-solana`: x402/Solana parsing, local budget preflight, demo receipts, gated devnet USDC client helpers.
- `@reddi/agent-protocol`: RAP receipts, policy/evidence/trust metadata, rail-neutral receipt candidates, proof-chain fixtures.
- `@reddi/rap-mcp-bridge`: consumes `@reddi/x402-solana` for x402 specialist-call preparation/execution/verification flows behind devnet approval gates.

## Claim Boundaries

Allowed claims:

- Repo-local package candidate for Solana/x402 rail primitives.
- Mock-friendly tests and demo-only receipt verification exist.
- Local budget preflight can run before any payment authorization.
- Devnet USDC payment helpers exist but are gated and not default release behavior.

Forbidden claims until separately proven:

- Published npm package.
- Production-ready settlement.
- Mainnet support.
- Custody or escrow finality.
- Default live payment.
- Default Pay.sh activation.
- Hosted marketplace publication.
- Trust or reputation mutation.
- Wallet/RPC/provider calls during clean-checkout OSS smoke.

## Release Smoke Requirements For #512

If #512 includes `@reddi/x402-solana`, it should verify:

- `npm --prefix packages/x402-solana test -- --runInBand`
- `npm --prefix packages/x402-solana run build`
- Package export/import smoke from a clean checkout.
- README/package metadata scan for npm/publication, live payment, custody, mainnet, or settlement-finality overclaims.
- `npm pack --dry-run` or equivalent package artifact inspection.

It should not require wallet material, RPC, Pay.sh, hosted Reddi, live providers, marketplace publication, trust/reputation mutation, mainnet, or paid calls.

## Decision

Keep `@reddi/x402-solana` alive as a v0.1 OSS candidate, but do not publish or market it as a public package until #512 and a later package-publication gate prove the release artifact and claim boundaries.
