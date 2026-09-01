# RAP Solana workstation baseline

This repository owns a reproducible, user-scoped baseline for local Solana work. It is baseline parity only; do not use it as approval to upgrade RAP to Anchor 1.1.x/2.x, Agave 4.x, newer Rust, newer LiteSVM, or mainnet flows.

## Authoritative pins

| Tool | Pin | Source |
| --- | --- | --- |
| Node | `24.20.0` | `.mise.toml` repository-local mise selection |
| Rust | `1.89.0` with `rustfmt` and `clippy` | `rust-toolchain.toml` |
| rustfmt / clippy | `1.8.0-stable` / `0.1.89` | shipped with Rust `1.89.0`, recorded per channel in `config/toolchain/solana-baseline-assets.json` for exact probes |
| Agave/Solana CLI | `v3.1.13` | CI `release.anza.xyz` install URLs in `.github/workflows/*program-tests.yml` |
| Anchor | `1.0.0` | `Anchor.toml` |
| npm | `11.19.0` | bundled with Node `24.20.0`, recorded in `config/toolchain/solana-baseline-assets.json` for exact probes |
| rustup-init | `1.29.0` | `config/toolchain/solana-baseline-assets.json` official static Rust archive URL and SHA-256 |
| Surfpool | `v1.5.0` | `config/toolchain/solana-baseline-assets.json` GitHub release URL and SHA-256 |

Run `scripts/solana-baseline-toolchain.sh print-pins` to see the resolved pins the installer will use.

## Safe install

```bash
scripts/solana-baseline-toolchain.sh install
```

The mode is required — running the script with no argument prints usage and exits non-zero rather than installing.

The script is idempotent and constrained to user-scoped install paths. Re-running it re-uses verified downloads, discards any partial or checksum-mismatched download and retries it, and skips the AVM/Anchor rebuild when both already report the pin:

- Node is installed with `mise install node@24.20.0`; this does not replace the machine-wide/default Node, so Node 26 remains available for unrelated work.
- Rust/rustup are installed under `~/.rustup` and `~/.cargo` using a pinned `rustup-init` archive and `--no-modify-path`. `auto-self-update` is disabled only on a rustup this script installed; an existing rustup keeps its own settings.
- Solana CLI is installed under `~/.local/share/solana/install` using the pinned `agave-install-init` release asset, a config file inside that same install tree, and `--no-modify-path`. That is the shared default `agave-install` data dir, so this relinks `active_release` and the user-wide `solana` becomes v3.1.13; the installer prints what was active there first. Unlike Node, there is no repo-local selection for the Solana CLI — set `RAP_BASELINE_SOLANA_INSTALL_DIR` to keep an existing install untouched.
- AVM is installed with Cargo from the official `otter-sec/anchor` `v1.0.0` tag; Anchor `1.0.0` is selected through AVM.
- Surfpool is installed from the verified `v1.5.0` Linux release tarball under `~/.local/share/surfpool/releases/v1.5.0/bin`.
- Downloaded installer assets are cached in the git-ignored `.tmp/solana-baseline-downloads/` (override with `RAP_BASELINE_DOWNLOAD_DIR`); install roots are overridable with `RAP_BASELINE_SOLANA_INSTALL_DIR` and `RAP_BASELINE_SURFPOOL_ROOT`, which the Surfpool smoke honours too.

The script does not use sudo, Docker, wallets/keypairs, Solana config mutation, live RPC, validators, airdrops, or transactions. It backs up existing shell startup files to a timestamped directory before host changes and records before/after captures under `artifacts/toolchain/`. Installers are run with PATH mutation disabled where supported; startup files are re-inspected after each installer and both that per-installer attribution and the overall backup-to-final diff are appended to the after-install capture. The narrative record of the 2026-09-01 run, including the checks that passed and the one that failed, is manually authored in `docs/SOLANA-BASELINE-VALIDATION-2026-09-01.md`.

## Verification

```bash
scripts/solana-baseline-toolchain.sh verify
npm run check:toolchain:baseline
mise exec node@24.20.0 -- npm ci --no-audit --no-fund
```

`verify` and `capture` never install anything: both fail or record "not installed" rather than letting `mise exec` pull in a missing `node@24.20.0`, and the ambient `rustc`/`cargo` probes are skipped when they are rustup proxies that would install the `rust-toolchain.toml` channel.

For repository checks that do not require wallets, live RPC, Docker, external spend, or killing unrelated listeners, prefer:

```bash
mise exec node@24.20.0 -- npm test -- --ci --maxWorkers=2
cargo test -p escrow
```

For a safe local Surfpool-only smoke that uses dynamic ports, in-memory state, no wallets/keypairs, no source mutation, and kills only the process it started:

```bash
npm run check:toolchain:surfpool-smoke
```

The smoke resolves the Surfpool and Agave pins from `scripts/solana-baseline-toolchain.sh print-pins` and fails before starting if the `surfpool`/`solana` it resolved are not those exact builds, so the recorded summary can never label an unpinned build as baseline evidence.

Focused shell-check coverage for the exact-version matcher:

```bash
npm run test:toolchain:version-match
npm run test:toolchain:modes
```

Only run broader Surfpool lanes when their preconditions are safe in a disposable worktree and no unrelated listeners must be killed. Capture failures as evidence; do not weaken checks to make the baseline pass.

## Rollback

Print the tested rollback plan without changing the host:

```bash
scripts/rollback-solana-baseline.sh --plan
```

If rollback is actually needed, run `scripts/rollback-solana-baseline.sh --execute` and type its confirmation phrase. That single phrase is the only gate: `--execute` removes everything the printed plan lists as removed, including the mise Node runtime, the Rust toolchain, the AVM-managed Anchor, and the whole `~/.local/share/solana/install` tree — the default `agave-install` data dir, so any other Solana release already installed there goes with it.

1. Remove repository-local Node selection by ignoring/removing `.mise.toml`, or run commands outside this repository. To remove the installed runtime entirely: `mise uninstall node@24.20.0`.
2. Remove the Rust toolchain: `rustup toolchain uninstall 1.89.0`. If this setup installed rustup only for RAP and nothing else uses it, remove `~/.rustup` and `~/.cargo` after backing up anything you need.
3. Remove Solana CLI: delete `~/.local/share/solana/install` or reinstall a prior captured version with the matching `agave-install-init`.
4. Remove Anchor/AVM: `avm uninstall 1.0.0` if available, then remove the AVM Cargo binary if this setup installed it.
5. Remove Surfpool: delete `~/.local/share/surfpool/releases/v1.5.0`.
6. Restore shell startup files from the timestamped backup recorded in the capture artifact if any installer or manual PATH edit changed them.

Do not restore or inspect Solana keypair contents as part of rollback.
