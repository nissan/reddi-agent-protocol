# RAP Solana baseline toolchain capture (after-install)

Produced by `scripts/solana-baseline-toolchain.sh` as of commit 02aaeb3, a superseded revision. Later review rounds changed the capture format, so re-running `capture` now emits more than this file holds: `rustfmt=`/`clippy=` pin lines, ambient `command -v node`/`npm`/`npx` probes, and a "Per-install inspection" section. The recorded versions are the host state of that run and are unaffected.

Captured: 20260901T021005Z
Worktree: /home/nissan/.treehouse/reddi-agent-protocol-276f74/5/reddi-agent-protocol
Git HEAD: 11311a407dcfb3f87a3793d3101b800374b45a91

## Expected pins

node=24.20.0 (source: .mise.toml)
npm=11.19.0 (source: config/toolchain/solana-baseline-assets.json, bundled with Node)
rust=1.89.0 components=[rustfmt clippy] (source: rust-toolchain.toml)
agave=v3.1.13 (source: CI release.anza.xyz install URLs)
anchor=1.0.0 (source: Anchor.toml; AVM tag object f17b37fd1f1fdb4b1c0de68ccb467996d3ba07f3, commit 25be6d502ec6957d34d436bc2a6170040fc64153)
rustup-init=1.29.0 (source: config/toolchain/solana-baseline-assets.json)
surfpool=v1.5.0 (source: config/toolchain/solana-baseline-assets.json)

## Probed versions

```text
$ mise --version
2026.8.14 linux-x64 (2026-08-26)
mise WARN  mise version 2026.8.16 available
mise WARN  self-update is disabled for this install, update mise the same way you installed it

$ mise exec node@24.20.0 -- node --version
v24.20.0

$ mise exec node@24.20.0 -- npm --version
11.19.0

$ command -v rustup
/home/nissan/.cargo/bin/rustup
rustup 1.29.0 (28d1352db 2026-03-05)
info: This is the version for the rustup toolchain manager, not the rustc compiler.
info: the currently active `rustc` version is `rustc 1.89.0 (29483883e 2025-08-04)`

$ command -v rustc
/home/nissan/.cargo/bin/rustc
rustc 1.89.0 (29483883e 2025-08-04)

$ command -v cargo
/home/nissan/.cargo/bin/cargo
cargo 1.89.0 (c24e10642 2025-06-23)

$ command -v solana
/home/nissan/.local/share/solana/install/active_release/bin/solana
solana-cli 3.1.13 (src:437252fc; feat:534737035, client:Agave)

$ command -v agave-install
/home/nissan/.local/share/solana/install/active_release/bin/agave-install
agave-install 3.1.13 (src:437252fc; feat:534737035, client:Agave)

$ command -v avm
/home/nissan/.cargo/bin/avm
avm 1.0.0

$ command -v anchor
/home/nissan/.cargo/bin/anchor
anchor-cli 1.0.0

$ command -v surfpool
/home/nissan/.local/share/surfpool/releases/v1.5.0/bin/surfpool
surfpool 1.5.0

$ rustup run 1.89.0 rustfmt --version
rustfmt 1.8.0-stable (29483883ee 2025-08-04)

$ rustup run 1.89.0 cargo clippy --version
clippy 0.1.89 (29483883ee 2025-08-04)

```
## Shell startup file diff inspection

Backup directory: /home/nissan/backups/reddi-agent-protocol-toolchain-baseline-20260901T021001Z

No shell startup files changed. Installers were run with no PATH mutation where supported.
