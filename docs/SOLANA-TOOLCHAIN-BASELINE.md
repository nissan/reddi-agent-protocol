# RAP Solana workstation baseline

This repository owns a reproducible, user-scoped baseline for local Solana work. It is baseline parity only; do not use it as approval to upgrade RAP to Anchor 2.x/RC builds, unpinned Agave/Rust beyond the versions below, newer LiteSVM, or mainnet flows.

## Authoritative pins

| Tool | Pin | Source |
| --- | --- | --- |
| Node | `24.20.0` | `.mise.toml` repository-local mise selection |
| Rust | `1.98.0` with `rustfmt` and `clippy` | `rust-toolchain.toml`; official Rust dist manifest `channel-rust-1.98.0.toml` was HTTP 200 on 2026-09-02 |
| rustfmt / clippy | `1.9.0-stable` / `0.1.98` | shipped with Rust `1.98.0`, recorded per channel in `config/toolchain/solana-baseline-assets.json` for exact probes |
| Agave/Solana CLI | `v4.2.2` | CI `release.anza.xyz` install URLs in every workflow `npm run check:toolchain:baseline` scans: the Anchor/Quasar program-test workflows and the Surfpool acceptance and critical SDK lanes; `gh-axi release view v4.2.2 -R anza-xyz/agave` reported a stable, non-prerelease release and Linux installer digest `sha256:78b6bc178609de93fba8d2175f2e44be409fe13fd8510cad0206c3f0433523fd` |
| `cargo-build-sbf` / `cargo-test-sbf` | `4.1.0` / `4.0.0` | recorded per Agave version in `config/toolchain/solana-baseline-assets.json`. Since Agave 4 these are no longer agave workspace members: `scripts/cargo-build-sbf-version.sh` at tag `v4.2.2` pins exactly these crates.io versions and the release installer `cargo install`s them, so `cargo build-sbf` moves with the Agave pin rather than with this repository |
| SBF platform-tools | `v1.54` | `DEFAULT_PLATFORM_TOOLS_VERSION` in `cargo-build-sbf` `4.1.0`, recorded in `config/toolchain/solana-baseline-assets.json`. `cargo build-sbf` downloads it on demand from `anza-xyz/platform-tools`; this repository neither mirrors nor checksums it, so it is a recorded pin, not a verified asset. Its default output arch is `v0` (SBPFv0) |
| AVM manager | `1.0.0` | `config/toolchain/solana-baseline-assets.json`; official `solana-foundation/anchor` tag `v1.0.0` (`f17b37fd1f1fdb4b1c0de68ccb467996d3ba07f3` → `25be6d502ec6957d34d436bc2a6170040fc64153`) |
| Anchor CLI | `1.1.2` | `Anchor.toml`; official stable `solana-foundation/anchor` tag `v1.1.2` (`0984d7a19ae6cfea19d78fab228b2af016b63021` → `24035e2b0035c87e321acc1c05f97793829a87f1`) and Linux release asset SHA-256 `fdea9979629e9416e5f5e5622ff6c11b8c691d1e559581ece368e903c0c980c1` |
| `anchor-lang` crate | same version as the Anchor CLI pin | `programs/escrow/Cargo.toml` requirement and the `Cargo.lock` resolution, both cross-checked against `Anchor.toml` by `npm run check:toolchain:baseline` so the program cannot compile against a different Anchor minor than the CLI that generates its IDL |
| npm | `11.19.0` | bundled with Node `24.20.0`, recorded in `config/toolchain/solana-baseline-assets.json` for exact probes |
| rustup-init | `1.29.0` | `config/toolchain/solana-baseline-assets.json` official static Rust archive URL and SHA-256 |
| Surfpool | `v1.5.0` | `config/toolchain/solana-baseline-assets.json` GitHub release URL and SHA-256; the `@solana/surfpool` SDK the critical lanes run in-process is pinned to the same `1.5.0` in `package.json`/`package-lock.json` and cross-checked by `npm run check:toolchain:baseline` |

Run `scripts/solana-baseline-toolchain.sh print-pins` to see the resolved pins the installer will use.

## Agave 4 runtime compatibility is unresolved

The Agave pin above covers the CLI and the SBF build path only. It is not evidence that the programs execute correctly under an Agave 4 runtime, and nothing in this repository establishes that today:

- `programs/escrow` tests run in-process on `litesvm 0.10.0`, which `Cargo.lock` resolves to the Agave `3.1.12` SVM crates (`solana-program-runtime`, `solana-bpf-loader-program`, `agave-syscalls`) and `solana-sbpf 0.13.1`.
- The `Legacy Anchor escrow tests (LiteSVM)` and Quasar program-test lanes install Agave `v4.2.2`, build `escrow.so` with `cargo-build-sbf 4.1.0` / platform-tools `v1.54`, then execute that artifact on the Agave 3.1 in-process runtime. They pass because the build defaults to SBPFv0, which stays loadable under `solana-sbpf 0.13.1` — not because an Agave 4 runtime accepted it.
- Loader, feature-set, or syscall behaviour that differs between Agave 3.1 and 4.2 is therefore invisible to every lane here.

Do not cite a passing program-test lane, or this baseline, as Agave 4.2 runtime compatibility, deployment readiness, or submission readiness. `config/toolchain/solana-baseline-assets.json` records the split as `programRuntime.agaveMajorCompatibility: "unresolved"`, and `npm run check:toolchain:baseline` recomputes that status from the actual `Cargo.lock` resolution against the CI Agave pin, so it fails if the recorded status stops matching reality in either direction. Aligning LiteSVM/Mollusk with the Agave CLI pin is a separate workstream needing its own qualification; do not bump `litesvm` as part of this baseline.

## Safe install

```bash
scripts/solana-baseline-toolchain.sh install
```

The mode is required — running the script with no argument prints usage and exits non-zero rather than installing.

The script is idempotent and constrained to user-scoped install paths. Re-running it re-uses verified downloads, discards any partial or checksum-mismatched download and retries it, and skips both the AVM build and the Anchor CLI download when AVM and Anchor already report their pins:

- Node is installed with `mise install node@24.20.0`; this does not replace the machine-wide/default Node, so Node 26 remains available for unrelated work.
- Rust/rustup are installed under `~/.rustup` and `~/.cargo` using a pinned `rustup-init` archive and `--no-modify-path`. `auto-self-update` is disabled only on a rustup this script installed; an existing rustup keeps its own settings.
- Solana CLI is installed under the baseline-owned `~/.local/share/solana/reddi-agent-protocol-baseline/install` directory using the pinned `agave-install-init` release asset, a config file inside that same install tree, and `--no-modify-path`. The shared default `~/.local/share/solana/install` tree is left untouched by default. If you explicitly set `RAP_BASELINE_SOLANA_INSTALL_DIR=~/.local/share/solana/install`, the installer warns that this relinks the shared `active_release` and may change the user-wide `solana`.
- AVM manager stays on the verified official `solana-foundation/anchor` `v1.0.0` source tag while the installer selects the official Anchor CLI `1.1.2` release binary. The installer verifies both the AVM manager tag and the Anchor `v1.1.2` tag, downloads the official `anchor-1.1.2-x86_64-unknown-linux-gnu` release binary with SHA-256 verification, installs it under `${AVM_HOME:-$HOME/.avm}/bin/anchor-1.1.2`, and selects it through AVM. Do not substitute Anchor 2.0 RC tags, unrecorded AVM sources, unqualified AVM-manager changes, or unverified release assets.
- Surfpool is installed from the verified `v1.5.0` Linux release tarball under `~/.local/share/surfpool/releases/v1.5.0/bin`.
- Downloaded installer assets are cached in the git-ignored `.tmp/solana-baseline-downloads/` (override with `RAP_BASELINE_DOWNLOAD_DIR`); install roots are overridable with `RAP_BASELINE_SOLANA_INSTALL_DIR` and `RAP_BASELINE_SURFPOOL_ROOT`, which the Surfpool smoke honours too.

The script does not use sudo, Docker, wallets/keypairs, Solana config mutation, live RPC, validators, airdrops, or transactions. It backs up existing shell startup files to a timestamped directory before host changes and records before/after captures under `artifacts/toolchain/`. Installers are run with PATH mutation disabled where supported; startup files are re-inspected after each installer and both that per-installer attribution and the overall backup-to-final diff are appended to the after-install capture. The narrative record of the 2026-09-01 run, including the checks that passed and the one that failed, is manually authored in `docs/SOLANA-BASELINE-VALIDATION-2026-09-01.md`.

## Verification

```bash
scripts/solana-baseline-toolchain.sh verify
npm run check:toolchain:baseline
mise exec node@24.20.0 -- npm ci --no-audit --no-fund
```

`verify` and `capture` never install anything: both fail or record "not installed" rather than letting `mise exec` pull in a missing `node@24.20.0`, and the ambient `rustc`/`cargo` probes are skipped when they are rustup proxies that would install the `rust-toolchain.toml` channel. Anchor `1.1.2` upgrade evidence is recorded in `docs/SOLANA-ANCHOR-1.1.2-UPGRADE-VALIDATION-2026-09-01.md`.

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

For the critical demo-program lanes, use the SDK-managed local Surfnet lifecycle documented in `docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`:

```bash
npm run test:surfpool:sdk-lifecycle
npm run test:surfpool:critical
npm run test:surfpool:quasar-critical
```

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

If rollback is actually needed, run `scripts/rollback-solana-baseline.sh --execute` and type its confirmation phrase. That single phrase is the only gate: `--execute` removes everything the printed plan lists as removed, including the mise Node runtime, the Rust toolchain, the AVM-managed Anchor, and the configured Solana install tree. The default Solana tree is baseline-owned; if you override `RAP_BASELINE_SOLANA_INSTALL_DIR` to the shared `~/.local/share/solana/install` tree, rollback destroys that shared tree and any other Solana releases in it.

1. Remove repository-local Node selection by ignoring/removing `.mise.toml`, or run commands outside this repository. To remove the installed runtime entirely: `mise uninstall node@24.20.0`.
2. Remove the Rust toolchain: `rustup toolchain uninstall 1.98.0`. If this setup installed rustup only for RAP and nothing else uses it, remove `~/.rustup` and `~/.cargo` after backing up anything you need. To roll the repository back to an earlier Rust baseline, check out the whole toolchain lane (`rust-toolchain.toml`, `config/toolchain/solana-baseline-assets.json`, and `scripts/check-solana-baseline-pins.mjs`) at the pre-upgrade commit: the pins and the assets file must move together. `assets.rust.rustfmtVersionByChannel`/`clippyVersionByChannel` are keyed by channel and only carry the current one, so reverting `rust-toolchain.toml` alone makes `scripts/solana-baseline-toolchain.sh` abort in *every* mode — including `print-pins`, which resolves before mode dispatch, so `verify`, `capture`, `install`, and `npm run check:toolchain:baseline` all fail with a missing-entry error rather than a rollback hint.
3. Remove Solana CLI: delete `~/.local/share/solana/reddi-agent-protocol-baseline/install` (or the explicit `RAP_BASELINE_SOLANA_INSTALL_DIR` you chose) or reinstall a prior captured version with the matching `agave-install-init`. To roll the repository back to an earlier Agave baseline, check out the whole toolchain lane (all four workflow `release.anza.xyz` install URLs, `config/toolchain/solana-baseline-assets.json`, and `scripts/check-solana-baseline-pins.mjs`) at the pre-upgrade commit, for the same reason: `assets.agave.sha256ByVersion` and `assets.sbf.*` are keyed by Agave version and only carry the current one, so reverting the workflow URLs alone aborts the script in every mode.
4. Remove Anchor/AVM: delete the selected CLI binary with `rm -f "${AVM_HOME:-$HOME/.avm}/bin/anchor-1.1.2"` and clear `${AVM_HOME:-$HOME/.avm}/.version` if it still names `1.1.2`, then remove the AVM Cargo binary if this setup installed it. `avm uninstall 1.1.2` cannot do this on its own: AVM refuses to remove the version it currently has selected, which after `install` is always the pinned one. To roll back specifically to the previous merged Anchor baseline, check out the pre-upgrade commit for the whole toolchain lane (`Anchor.toml`, `programs/escrow/Cargo.toml`, `Cargo.lock`, `config/toolchain/solana-baseline-assets.json`, and `scripts/solana-baseline-toolchain.sh`) before reinstalling `1.0.0` through the same verified AVM path. The installer and its assets file must move together: the current script reads keys (`anchorAvm.managerVersion`, `anchorCli.*`) that the pre-upgrade assets file does not define, and the pre-upgrade script cannot select an Anchor CLI release binary.
5. Remove Surfpool: delete `~/.local/share/surfpool/releases/v1.5.0`.
6. Restore shell startup files from the timestamped backup recorded in the capture artifact if any installer or manual PATH edit changed them.

Do not restore or inspect Solana keypair contents as part of rollback.
