# Reddi Agent Protocol OSS v0.1 Package Plan

Issue: [#356](https://github.com/nissan/reddi-agent-protocol/issues/356)

This plan defines the first public npm package boundary for Reddi Agent Protocol v0.1. It is a planning artifact only: no package manifest, source exports, release credentials, payment rails, hosted services, or live provider calls are changed by this document.

## Package Identity

- npm name: `@reddi/agent-protocol`
- local package path: `packages/agent-protocol`
- first public version: `0.1.0`
- license: inherit the repo license for the package README and npm metadata
- Node runtime: Node.js 20+, matching newer package surfaces such as `@reddi/rap-mcp-bridge`
- module plan: publish explicit ESM with TypeScript declarations unless implementation constraints require a CommonJS compatibility subpath
- package contents: `dist`, `README.md`, `LICENSE`, and a small `fixtures` bundle only; exclude tests, local artifacts, logs, credentials, and generated proof outputs

The existing `@reddi/x402-solana` package remains the Solana x402 payment rail. `@reddi/agent-protocol` should be the protocol/devtool package above that rail: receipts, policy, buyer/seller interfaces, fixtures, and conformance helpers.

## Export Surface

Use stable subpath exports from day one so consumers can import only the surface they need.

```json
{
  "name": "@reddi/agent-protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./receipts": {
      "types": "./dist/receipts/index.d.ts",
      "import": "./dist/receipts/index.js"
    },
    "./policy": {
      "types": "./dist/policy/index.d.ts",
      "import": "./dist/policy/index.js"
    },
    "./buyer": {
      "types": "./dist/buyer/index.d.ts",
      "import": "./dist/buyer/index.js"
    },
    "./seller": {
      "types": "./dist/seller/index.d.ts",
      "import": "./dist/seller/index.js"
    },
    "./fixtures": {
      "types": "./dist/fixtures/index.d.ts",
      "import": "./dist/fixtures/index.js"
    },
    "./conformance": {
      "types": "./dist/conformance/index.d.ts",
      "import": "./dist/conformance/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ]
}
```

Planned exported surfaces:

- `@reddi/agent-protocol`: top-level stable types and convenience helpers.
- `@reddi/agent-protocol/receipts`: receipt schema, receipt validation, evidence hash helpers, and claim-boundary metadata.
- `@reddi/agent-protocol/policy`: local budget policy evaluator, policy decision types, denial reasons, and dry-run policy planning.
- `@reddi/agent-protocol/buyer`: buyer client primitives for quote preview, policy evaluation, request construction, receipt verification, and disclosure export.
- `@reddi/agent-protocol/seller`: seller middleware primitives for challenge construction, policy/receipt attachment, and local request verification.
- `@reddi/agent-protocol/fixtures`: deterministic no-secret fixtures for receipts, policies, buyer requests, seller responses, and conformance examples.
- `@reddi/agent-protocol/conformance`: fixture runner and helper assertions that external SDKs/adapters can use without hosted Reddi services.

Do not export app internals, Next.js route handlers, local `@/` aliases, private proof artifacts, or direct hosted-service clients from v0.1.

## Build And Test Flow

The package should validate locally from a clean checkout without secrets or network dependencies beyond normal package installation.

Expected package scripts:

```json
{
  "scripts": {
    "clean": "rm -rf dist",
    "build": "tsc -p tsconfig.json",
    "test": "npm run build && node --test dist/tests/*.test.js",
    "test:fixtures": "npm run build && node scripts/check-fixtures.mjs",
    "test:conformance": "npm run build && node scripts/run-conformance-fixtures.mjs",
    "release:dry-run": "npm run clean && npm run build && npm test && npm run test:fixtures && npm run test:conformance && npm pack --dry-run"
  }
}
```

Minimum release gate:

1. Install package dependencies from a clean checkout.
2. Run `npm run build`.
3. Run unit tests for receipt schema, policy evaluator, buyer client, seller middleware, fixtures, and conformance helpers.
4. Run conformance fixtures with no env vars set.
5. Run root naming/claim-boundary checks that apply to public docs, such as `npm run check:rap:naming`.
6. Run `npm pack --dry-run` in `packages/agent-protocol` and inspect the included files.
7. Run `git diff --check`.

No v0.1 release gate may require a Solana keypair, npm token, OpenRouter key, Pay.sh login, Circle login, hosted Reddi service, devnet airdrop, mainnet payment, or paid provider call.

## Release Flow

Pre-release checklist:

1. Confirm #341 and #342 have landed or explicitly revise this plan to match their final public APIs.
2. Confirm `package.json` has `name`, `version`, `description`, `license`, `repository`, `homepage`, `bugs`, `exports`, `files`, `engines`, `sideEffects`, and `publishConfig.access`.
3. Confirm package README covers install, local quickstart, exported surfaces, examples, claim boundaries, and no-secret/no-live-payment validation.
4. Confirm `CHANGELOG.md` or a package changelog section includes the `0.1.0` public API summary.
5. Run build, tests, fixture checks, conformance checks, README examples, `npm pack --dry-run`, and `git diff --check`.
6. Inspect the tarball file list for secrets, local logs, `.env*`, private artifacts, `node_modules`, generated screenshots/videos, and unrelated app output.
7. Only after the local dry run passes, perform an authenticated `npm publish --dry-run --access public` using a separately approved npm token.
8. Real publish requires explicit human approval after dry-run evidence is recorded.
9. Tag only after publish succeeds and the package can be installed from npm in a fresh temp project.

Rollback notes:

- npm packages cannot be reliably "rolled back" after public publication. Prefer publishing a patch version that deprecates or fixes the bad release.
- If a bad release is discovered before adoption, deprecate the version with a clear message and publish the next patch.
- Never reuse a published version number.
- Keep v0.1 APIs small so patch fixes do not require broad compatibility promises.

## Semantic Versioning

Before `1.0.0`, semver still applies, but consumers should treat minor versions as potentially breaking unless release notes say otherwise.

- Patch: bug fixes, stricter validation with the same accepted schema, fixture corrections, docs fixes, and non-breaking helper additions.
- Minor: new exported helpers, new fixture groups, new conformance checks, new policy denial reasons, or changed defaults that are backwards compatible.
- Breaking pre-1.0 change: removing exports, renaming types, changing receipt/policy schema semantics, changing buyer/seller middleware behavior, or changing fixture meaning. Publish as a minor before `1.0.0`, with explicit migration notes.

The v0.1 package should clearly label receipt and policy schemas as the initial public baseline, not final protocol law.

## Package README Requirements

The package README must be written for a developer installing the npm package, not for a website visitor.

Required sections:

- What `@reddi/agent-protocol` is and how it differs from `@reddi/x402-solana`, `@reddi/rap-mcp-bridge`, and hosted Reddi services.
- Install command.
- Local quickstart that uses fixtures and performs no live payment.
- Receipt validation example.
- Policy evaluator example with an allow/deny decision.
- Buyer client example that constructs or verifies a dry-run request.
- Seller middleware example that attaches a payment challenge or receipt boundary without invoking a paid provider by default.
- Conformance fixture runner example for adapter authors.
- Claim boundaries: local-first, no mainnet claim, no hosted-service requirement, no paid provider call, and no secret requirement for the default quickstart.
- Security notes: keep keys in the consuming app environment, never in package fixtures, and require explicit opt-in for live payment execution.
- Versioning and support policy for the pre-1.0 API.

## Guardrails

The v0.1 package must be safe to install, test, and inspect in public.

- No secrets in repo, npm tarball, fixtures, examples, or docs.
- No `.env` files, wallet keypairs, npm tokens, provider API keys, hosted Reddi credentials, or private customer data.
- No default live payment, mainnet, devnet spend, wallet funding, hosted Reddi dependency, paid provider invocation, or remote specialist call.
- Any future live payment path must require explicit consumer code, explicit env configuration, bounded spend policy, receipt capture, and separate documentation.
- Hosted Reddi APIs may be documented as optional future integrations, but v0.1 conformance must run locally without them.
- Examples must prefer deterministic fixtures and mock transports.
- Package publication credentials stay outside the repo and require a separate approval gate before real publish.
- README and npm metadata must not claim production payment support unless backed by the release validation evidence.

## Open Implementation Dependencies

- #341 should define the final public receipt and policy primitives that this package exports.
- #342 should define the local SDK/middleware developer surface that maps into `buyer` and `seller` exports.
- #159 should inform budget policy evaluator behavior before it is frozen into public examples.
- #353 should provide the public quickstart/conformance shape that the package README can reuse.

Until those dependencies land, this plan should guide package shape and release gates without forcing premature implementation.
