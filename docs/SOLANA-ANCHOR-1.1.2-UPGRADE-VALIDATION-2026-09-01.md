# Anchor 1.1.2 stable upgrade validation — 2026-09-01

Scope: upgrade the legacy Anchor reference program and RAP workstation baseline from Anchor `1.0.0` to stable Anchor `1.1.2` while keeping the merged Agave/Rust/Node/Surfpool baseline unchanged. This is not approval for Anchor 2.x/RC builds, Agave 4.x, newer Rust, mainnet activation, live signing, or custody changes.

## Release and source evidence

- Official release checked with `gh-axi release view v1.1.2 -R solana-foundation/anchor`.
- Release is stable/non-prerelease, immutable, and was published by `github-actions[bot]` at `2026-06-26T15:16:04Z`.
- Tag evidence recorded in `config/toolchain/solana-baseline-assets.json`:
  - tag object: `0984d7a19ae6cfea19d78fab228b2af016b63021`
  - peeled commit: `24035e2b0035c87e321acc1c05f97793829a87f1`
- The `1.1.2` changelog section has no `Breaking` entries.
- The Linux CLI release asset `anchor-1.1.2-x86_64-unknown-linux-gnu` is pinned by SHA-256 `fdea9979629e9416e5f5e5622ff6c11b8c691d1e559581ece368e903c0c980c1`.

## Compatibility decision

`cargo install --git ... avm --rev <v1.1.2>` was intentionally not adopted: AVM `1.1.2` pulls a dependency requiring Rust `1.91`, which would violate the repository baseline (`1.89.0`). The supported path now keeps the AVM manager pinned at `1.0.0` and selects the official verified Anchor CLI `1.1.2` binary through AVM.

That Rust-version rationale is historical to this 2026-09-01 run and has since been superseded by the Agave/Rust refresh; the manager pin and its current reason live in `docs/SOLANA-TOOLCHAIN-BASELINE.md` and `config/toolchain/solana-baseline-assets.json`.

No Agave, Rust, Node, Surfpool, LiteSVM, PER, AUDD, mainnet, or Quasar runtime upgrade is included.

## Current toolchain proof

Commands run from the isolated worktree on branch `fm/rap-anchor-stable-upgrade`:

```bash
scripts/solana-baseline-toolchain.sh verify
npm run check:toolchain:baseline
npm run test:toolchain:version-match
npm run test:toolchain:modes
npm run check:toolchain:surfpool-smoke
```

Observed pins after install/verify:

- Node `v24.20.0`, npm `11.19.0`
- Rust `1.89.0`, cargo `1.89.0`, rustfmt `1.8.0-stable`, clippy `0.1.89`
- Solana CLI `3.1.13` (Agave)
- AVM manager `1.0.0`
- Anchor CLI `1.1.2`
- Surfpool `1.5.0`

Surfpool smoke used dynamic localhost ports, `--offline`, `--no-deploy`, `--airdrop-amount 0`, `--db :memory:`, `--no-studio`, and `--no-tui`. It proved RPC readiness without wallet/keypair material, transactions, live RPC, or persisted validator state. The run wrote its summary to `artifacts/toolchain/surfpool-smoke-20260901T082929Z/summary.txt`. `artifacts/` is gitignored, so that summary is local run output rather than tracked evidence; reproduce it with `npm run check:toolchain:surfpool-smoke`. The tracked `artifacts/toolchain/baseline-*.md` captures predate this upgrade and still record Anchor `1.0.0`; the authoritative post-upgrade pins are `Anchor.toml`, `config/toolchain/solana-baseline-assets.json`, and `scripts/solana-baseline-toolchain.sh print-pins`, all of which `npm run check:toolchain:baseline` gates.

## Program and IDL proof

Commands run:

```bash
cargo build -p escrow
cargo build-sbf --manifest-path programs/escrow/Cargo.toml --sbf-out-dir target/deploy
anchor idl build -p escrow -o .tmp/anchor-1.1.2/escrow.json -t .tmp/anchor-1.1.2/escrow.ts --skip-lint
cargo fmt -- --check
cargo clippy -p escrow --all-targets -- -D warnings
cargo test -p escrow
```

Results:

- Native Rust build passed.
- SBF build passed under Agave `3.1.13`; the generated `target/deploy/escrow-keypair.json` build artifact was removed immediately and not inspected or retained.
- Anchor IDL generation passed into `.tmp/anchor-1.1.2/` only; no tracked IDL/client was changed.
- Clippy passed with `-D warnings` after boxing the LiteSVM failed-transaction error in `programs/escrow/tests/test_registry.rs` to keep the large-error lint green under the stable Anchor upgrade.
- `cargo test -p escrow` passed: 32 passing tests (30 LiteSVM integration tests plus 2 `magicblock_cpi` encoding unit tests), 1 devnet-only MagicBlock PER test ignored.

## TypeScript/package/conformance proof

Commands run:

```bash
npm test
npm run build
npm --prefix packages/per-client test -- --runInBand
npm --prefix packages/per-client run build
npm --prefix packages/agent-protocol test -- --runInBand
npm --prefix packages/agent-protocol run build
npm --prefix packages/x402-solana test -- --runInBand
npm --prefix packages/x402-solana run build
npm run check:package:artifacts
npm run check:oss-release-smoke
npm run check:conformance:public
```

Results:

- Root Jest passed: 125 suites / 597 tests.
- Root Next build passed with existing Turbopack/bigint warnings only.
- `@reddi/per-client` tests and TypeScript build passed.
- `@reddi/agent-protocol` tests passed: 83 suites / 586 tests; build passed.
- `@reddi/x402-solana` tests passed: 4 suites / 57 tests; build passed.
- Package artifact, OSS release smoke, and public conformance checks passed without publishing or live payment activity.

## Solana/AUDD/readiness proof

Commands run:

```bash
npm run check:rap:naming
npm run test:bdd:index
npm run check:quasar:submission
node ./scripts/check-quasar-boundary-guard.mjs --changed
npm run check:solana:audit-appendix
npm run check:solana:audit-handoff
npm run check:submission:claim-boundaries
npm run check:economic-demo:live-payment-gate
npm run check:copy:paid-workflow
```

Results:

- RAP naming, BDD index, Quasar submission, changed-file boundary guard, audit appendix, audit handoff, submission claim boundaries, live-payment gate, and paid-workflow copy-boundary checks passed.
- `check:economic-demo:live-payment-gate` remained intentionally blocked by default and emitted blockers for missing explicit confirmation/asset/network/spend-cap/payer/recipient, preserving no-live-spend semantics.
- The default full-repo `check:quasar:boundary-guard` currently flags pre-existing protected-package guardrail/source strings unrelated to this Anchor upgrade; the changed-file guard scanned zero protected package/read-model files because this upgrade did not alter that lane.
- Broad root `npm run lint` still fails on pre-existing repository-wide lint debt unrelated to this upgrade; changed JavaScript/TypeScript files were checked with ESLint and had no errors.

## Boundaries preserved

- AUDD remains payment-plan/proof metadata only; no custody, settlement-finality, or live payment claim was added.
- Mainnet and live payment paths remain blocked unless a separately approved live-readiness/signing path supplies the required operator inputs.
- PER delegation remains TypeScript/client-side; the Anchor 1.1.2 upgrade does not adopt or requalify MagicBlock Rust SDK ownership.
- Quasar remains the final demo target; the Anchor program remains a legacy/reference regression lane.
- Installs remain user-scoped and rollback remains documented in `docs/SOLANA-TOOLCHAIN-BASELINE.md` and `scripts/rollback-solana-baseline.sh`.
