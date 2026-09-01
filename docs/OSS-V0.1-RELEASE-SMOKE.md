# OSS v0.1 Release Smoke

Issue: [#512](https://github.com/nissan/reddi-agent-protocol/issues/512)

Status: no-publish, no-live-payment smoke gate.

This runbook defines the clean-checkout command for the current OSS v0.1 package candidate set. It proves local package tests, import surfaces, no-spend examples, source/trust protocol inputs, and package artifact boundaries without publishing packages or calling hosted services, wallets, RPC endpoints, providers, Pay.sh, marketplaces, trust systems, or mainnet.

## Package Scope

Included:

- `@reddi/agent-protocol`
- `@reddi/x402-solana`

Excluded from v0.1 smoke:

- `@reddi/sendai-x402`
- `@reddi/eliza-plugin-x402`

The SendAI and Eliza adapters are deferred experimental repo-local packages per [x402 Adapter Retention Decision](./X402-ADAPTER-RETENTION-DECISION-2026-06-24.md). Both manifests are marked `"private": true` with a deferred description, and this smoke enforces that. They must not appear in public v0.1 release claims, npm publication plans, or supported integration matrices unless a later promotion issue adds package metadata, README docs, stable smoke tests, and claim-boundary review.

## Clean-Checkout Command

From a fresh checkout after installing dependencies:

```bash
npm run check:oss-release-smoke
```

The script runs:

- `@reddi/agent-protocol` tests.
- `@reddi/agent-protocol` ARD no-spend example.
- `@reddi/agent-protocol` import smoke for root, receipt, policy, provider-trust, source-diagnostics, discovery-source, and proof-chain surfaces.
- `@reddi/x402-solana` tests.
- `@reddi/x402-solana` build.
- `@reddi/x402-solana` import smoke for root, budget-policy, client, Jupiter, middleware, nonce, and payment surfaces.
- Package `npm pack --dry-run --json` inspection from each package directory.
- RAP naming guard.
- Claim-boundary scan for stale x402 package comments and adapter-retention scope. The scan also
  covers the top-level product/readiness surfaces (`README.md`, `SECURITY.md`, `DEPLOY.md`,
  `docs/NETWORK-PROFILES.md`, `packages/agent-protocol/README.md`).
- Deferred-adapter manifest check: `packages/sendai-x402` and `packages/eliza-plugin-x402` must keep
  their names in the excluded set, set `"private": true`, and describe themselves as
  experimental/deferred.

## Artifact Rules

The package dry-run fails if a candidate package includes:

- `node_modules/`, `.next/`, `coverage/`, `artifacts/`, `ingests/`, `research/`, `programs/`, `third_party/`, app UI files, or config files.
- `.env` files, wallet/keypair files, private-key shaped paths, logs, or tarballs.
- Missing `package.json`, `README.md`, or `dist/` output.

`npm pack --dry-run` must be executed with the package directory as the working directory. In this repo, `npm --prefix packages/<pkg> pack --dry-run` can accidentally inspect the root app package instead of the target package.

## Success Boundary

Passing this smoke means:

- The current local package candidate set can build, test, import, and produce bounded dry-run package contents from a clean checkout.
- `@reddi/agent-protocol` no-spend ARD/RAP examples work locally.
- `@reddi/x402-solana` remains a repo-local OSS candidate with explicit x402/Solana package boundaries.

Passing this smoke does not mean:

- Any package was published to npm.
- Hosted marketplace/facilitator paths are ready.
- Pay.sh is activated.
- A wallet, RPC endpoint, provider, marketplace, trust/reputation system, mainnet, custody flow, or settlement-finality path was exercised.

## Next Gate

After this smoke is stable, #521 can add a no-publish package-readiness dry-run for the wider RAP package set. Real publication still requires a separate approved issue and explicit operator approval.
