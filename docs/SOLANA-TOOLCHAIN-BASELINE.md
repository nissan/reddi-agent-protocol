# RAP Solana workstation baseline

This repository owns a reproducible, user-scoped baseline for local Solana work. It is baseline parity only; do not use it as approval to upgrade RAP to Anchor 1.1.x/2.x, Agave 4.x, newer Rust, newer LiteSVM, or mainnet flows.

## Authoritative pins

| Tool | Pin | Source |
| --- | --- | --- |
| Node | `24.20.0` | `.mise.toml` repository-local mise selection |
| Rust | `1.89.0` with `rustfmt` and `clippy` | `rust-toolchain.toml` |
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

The script is idempotent and constrained to user-scoped install paths:

- Node is installed with `mise install node@24.20.0`; this does not replace the machine-wide/default Node, so Node 26 remains available for unrelated work.
- Rust/rustup are installed under `~/.rustup` and `~/.cargo` using a pinned `rustup-init` archive and `--no-modify-path`.
- Solana CLI is installed under `~/.local/share/solana/install` using the pinned `agave-install-init` release asset, a config file inside that same install tree, and `--no-modify-path`.
- AVM is installed with Cargo from the official `otter-sec/anchor` `v1.0.0` tag; Anchor `1.0.0` is selected through AVM.
- Surfpool is installed from the verified `v1.5.0` Linux release tarball under `~/.local/share/surfpool/releases/v1.5.0/bin`.

The script does not use sudo, Docker, wallets/keypairs, Solana config mutation, live RPC, validators, airdrops, or transactions. It backs up existing shell startup files to a timestamped directory before host changes and records before/after captures under `artifacts/toolchain/`. Installers are run with PATH mutation disabled where supported; any startup-file diffs are appended to the after-install capture.

## Verification

```bash
scripts/solana-baseline-toolchain.sh verify
npm run check:toolchain:baseline
mise exec node@24.20.0 -- npm ci --no-audit --no-fund
```

For repository checks that do not require wallets, live RPC, Docker, external spend, or killing unrelated listeners, prefer:

```bash
mise exec node@24.20.0 -- npm test -- --ci --maxWorkers=2
cargo test -p escrow
```

For a safe local Surfpool-only smoke that uses dynamic ports, in-memory state, no wallets/keypairs, no source mutation, and kills only the process it started:

```bash
npm run check:toolchain:surfpool-smoke
```

Only run broader Surfpool lanes when their preconditions are safe in a disposable worktree and no unrelated listeners must be killed. Capture failures as evidence; do not weaken checks to make the baseline pass.

## Rollback

Print the tested rollback plan without changing the host:

```bash
scripts/rollback-solana-baseline.sh --plan
```

If rollback is actually needed, run `scripts/rollback-solana-baseline.sh --execute` and type its confirmation phrase.

1. Remove repository-local Node selection by ignoring/removing `.mise.toml`, or run commands outside this repository. To remove the installed runtime entirely: `mise uninstall node@24.20.0`.
2. Remove the Rust toolchain: `rustup toolchain uninstall 1.89.0`. If this setup installed rustup only for RAP and nothing else uses it, remove `~/.rustup` and `~/.cargo` after backing up anything you need.
3. Remove Solana CLI: delete `~/.local/share/solana/install` or reinstall a prior captured version with the matching `agave-install-init`.
4. Remove Anchor/AVM: `avm uninstall 1.0.0` if available, then remove the AVM Cargo binary if this setup installed it.
5. Remove Surfpool: delete `~/.local/share/surfpool/releases/v1.5.0`.
6. Restore shell startup files from the timestamped backup recorded in the capture artifact if any installer or manual PATH edit changed them.

Do not restore or inspect Solana keypair contents as part of rollback.
