<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Reddi Agent Protocol agent memory

## Repository shape

This is a mixed monorepo: a Next.js web app at the root, Solana programs under `programs/escrow/`, and independent TypeScript packages under `packages/`. The root `package.json` is named `web`; it is not a workspace root. Each `packages/*` package has its own install/build/test lifecycle.

- `app/`, `components/`, `lib/`, `providers/`, `public/` — Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui + Solana wallet adapter.
- `programs/escrow/` — legacy Anchor reference implementation. The recorded Quasar devnet program set in `config/quasar/deployments.json` is blocked (`submissionReady: false`); Anchor remains historical/reference regression evidence only.
- `packages/per-client` — MagicBlock PER delegation client; PER architecture remains TypeScript/client-side unless a separate SDK compatibility qualification says otherwise.
- `packages/agent-protocol`, `packages/x402-solana`, `packages/demo-agents`, `packages/rap-mcp-bridge`, `packages/eliza-plugin-x402`, `packages/sendai-x402`, `packages/openrouter-specialists`, `packages/testing-specialists` — package surfaces with separate package managers/scripts.
- `scripts/` — smoke/evidence/readiness scripts; inspect scripts before running anything with devnet/live/surfpool/evidence in the name.
- `artifacts/` — generated evidence packs; do not hand-edit.

## Solana toolchain baseline

Use `docs/SOLANA-TOOLCHAIN-BASELINE.md` and `scripts/solana-baseline-toolchain.sh` for the pinned user-scoped RAP Solana baseline. Keep Node repo-local through `.mise.toml`; do not replace the machine-wide Node used outside this repository. Anchor CLI is pinned to 1.1.2, selected through the AVM 1.0.0 manager because AVM 1.1.2 itself requires newer Rust than the baseline. Prefer `npm run check:toolchain:surfpool-smoke` for a safe dynamic-port Surfpool smoke; inspect broader Surfpool/devnet scripts before running because some use fixed ports, keypair paths, live RPC, or generated artifacts.

Common safe baseline checks:

```bash
scripts/solana-baseline-toolchain.sh verify
npm run check:toolchain:baseline
npm run test:toolchain:version-match
npm run test:toolchain:modes
```

Legacy Anchor reference checks from the repo root:

```bash
cargo build-sbf --manifest-path programs/escrow/Cargo.toml --sbf-out-dir target/deploy
cargo test -p escrow
anchor idl build -p escrow --skip-lint -o .tmp/escrow-idl.json -t .tmp/escrow-idl.ts
```

`cargo build-sbf` may create generated files under `target/deploy/`; do not read, preserve, or commit generated keypair material.

## Common app/package commands

```bash
npm run dev
npm run build
npm test -- --ci --maxWorkers=2
npx jest lib/__tests__/jupiter-client.test.ts
npx jest -t "registers an agent"
npm run test:e2e
npm run test:e2e -- e2e/onboarding.spec.ts
npm run test:e2e:ui
```

Jest is configured in `jest.config.js` and covers `lib/**` tests plus any `__tests__` directory under `packages/demo-agents/src`; the root `package.json` exposes `npm test` (aliasing `jest`), which is what CI runs.

Playwright starts its own dev server and owns the port/wallet-mock env it needs; read `playwright.config.ts` before changing e2e setup, and set `PLAYWRIGHT_BASE_URL` to run against an already-running target instead. `packages/demo-agents` has its own devnet lifecycle (`fund`, `register`, `deregister`, `demo`) that spends devnet SOL — read the package before running any of it.

The repo has many smoke/evidence/readiness commands. Do not run destructive or live-spend-capable scripts speculatively. Prefer dry-run/plan variants where they exist, for example `plan:economic-demo:devnet-usdc-sender`.

## Network profile resolution

Runtime network comes from `lib/config/network.ts` and `config/networks/<profile>.json`.

- Profile value: `devnet` default, `mainnet`, or `local-surfpool` (aliases: `local`, `localnet`, `surfpool`). `resolveNetworkProfileName()` consults three keys in order — `NETWORK_PROFILE` (the only true runtime selector; never inlined into a bundle), then `NEXT_PUBLIC_BUILD_NETWORK_PROFILE` (emitted by `next.config.ts` from the build-time profile — the browser's source of truth, never set by hand), then `NEXT_PUBLIC_NETWORK_PROFILE` (a build-time selector frozen into both bundles whenever it is present in the build env). See `docs/NETWORK-PROFILES.md` for why setting only `NEXT_PUBLIC_NETWORK_PROFILE` at runtime does not switch the profile.
- `NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar` selects the Quasar target: refused on `mainnet`; refused on `local-surfpool` unless four distinct valid local program ids are supplied; on `devnet` it resolves for disclosure only, and `assertProgramTargetUsable()` refuses it because the recorded deployment is not submission-ready.
- `NEXT_PUBLIC_RPC_ENDPOINT` overrides RPC; `NEXT_PUBLIC_ESCROW_PROGRAM_ID` / `NEXT_PUBLIC_REGISTRY_PROGRAM_ID` / `NEXT_PUBLIC_REPUTATION_PROGRAM_ID` / `NEXT_PUBLIC_ATTESTATION_PROGRAM_ID` override program ids, but are ignored on devnet — both the legacy-Anchor and Quasar targets — unless the build was made with `ALLOW_UNSAFE_ESCROW_OVERRIDE=true`, mirrored by `next.config.ts` into `NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE`; the browser must not accept a runtime public unsafe-override flag. Rejected overrides keep the registered id, mark the profile not submission-ready, and record `knownGaps` without exposing the supplied value; malformed values are rejected before `lib/program.ts` constructs any `PublicKey`.

When debugging wrong program id or wrong RPC, check these env vars before changing code.

## On-chain program boundaries

The legacy Anchor implementation in `programs/escrow/` contains escrow, registry, reputation commit/reveal, attestation, and MagicBlock PER state-tracking instructions. PDA seeds and Anchor discriminators are mirrored in `lib/program.ts`; if you change a seed or instruction name, update both Rust constants and TypeScript mirrors.

Quasar is experimental. Program ids are in `config/quasar/deployments.json`, and the recorded devnet deployment is blocked: it predates the job-binding rework and no longer matches the in-repo client, so every Quasar request outside `local-surfpool` is refused before instruction building, signer access, or RPC. Current-source Quasar is exercised only by the local Surfpool lane — see `docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`. The legacy Anchor id is historical comparison only. MagicBlock PER/TEE live execution is not part of any Quasar claim. See `DEPLOY.md` before any deployment, and never deploy or change upgrade authority without explicit approval.

The `77rkRQxe…UZXmX` program id still quoted in some older `declare_id!` macros, `Anchor.toml` entries, and runbooks (including `packages/demo-agents/DEPLOY.md`) is pre-cutover doc rot; it is deployed nowhere. Ignore it.

## Protocol economics and claim boundaries

The **planned** protocol fee is 0.05% per transaction, modelled as settlement-only (zero on failure). This is a
product/fixture model, not implemented behaviour: no deployed on-chain release path collects a protocol treasury fee
today — the only on-chain economic constant is `AGENT_REGISTRATION_FEE` (the 0.01 SOL registration burn). Describe the
0.05% figure as planned or fixture semantics, never as an implemented fee. Older 16.7% / 83.3% figures are stale doc
rot.

Preserve the hard boundaries enforced by package/readiness checks: AUDD is payment-plan/proof metadata only, not custody or settled escrow; mainnet/live payment paths are gated; package/source conformance must remain no-spend/offline unless a task explicitly authorizes otherwise.

## Repository conventions

`STATUS.md` is a rolling log, not a source of truth about current code state; the newest entry is at the top and older entries describe intermediate states.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
