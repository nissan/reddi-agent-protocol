# RAP Solana baseline toolchain capture (after-install)

Captured: 20260901T043009Z
Worktree: <local worktree path redacted>
Git HEAD: 1c7434dc3ff75422fdd8a474ca9c564d83a8f219

## Expected pins

node=24.20.0 (source: .mise.toml)
npm=11.19.0 (source: config/toolchain/solana-baseline-assets.json, bundled with Node)
rust=1.89.0 components=[rustfmt clippy] (source: rust-toolchain.toml)
rustfmt=1.8.0-stable (source: config/toolchain/solana-baseline-assets.json, shipped with Rust 1.89.0)
clippy=0.1.89 (source: config/toolchain/solana-baseline-assets.json, shipped with Rust 1.89.0)
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

$ command -v node
~/.local/share/mise/installs/node/26.7.0/bin/node
v26.7.0

$ command -v npm
~/.local/share/mise/installs/node/26.7.0/bin/npm
11.19.0

$ command -v npx
~/.local/share/mise/installs/node/26.7.0/bin/npx
11.19.0

$ command -v rustup
~/.cargo/bin/rustup
rustup 1.29.0 (28d1352db 2026-03-05)
info: This is the version for the rustup toolchain manager, not the rustc compiler.
info: the currently active `rustc` version is `rustc 1.89.0 (29483883e 2025-08-04)`

$ command -v rustc
~/.cargo/bin/rustc
rustc 1.89.0 (29483883e 2025-08-04)

$ command -v cargo
~/.cargo/bin/cargo
cargo 1.89.0 (c24e10642 2025-06-23)

$ command -v solana
~/.local/share/solana/reddi-agent-protocol-baseline/install/active_release/bin/solana
solana-cli 3.1.13 (src:437252fc; feat:534737035, client:Agave)

$ command -v agave-install
~/.local/share/solana/reddi-agent-protocol-baseline/install/active_release/bin/agave-install
agave-install 3.1.13 (src:437252fc; feat:534737035, client:Agave)

$ command -v avm
~/.cargo/bin/avm
avm 1.0.0

$ command -v anchor
~/.cargo/bin/anchor
anchor-cli 1.0.0

$ command -v surfpool
~/.local/share/surfpool/releases/v1.5.0/bin/surfpool
surfpool 1.5.0

$ rustup run 1.89.0 rustfmt --version
rustfmt 1.8.0-stable (29483883ee 2025-08-04)

$ rustup run 1.89.0 cargo clippy --version
clippy 0.1.89 (29483883ee 2025-08-04)

```
## Shell startup file diff inspection

Backup directory: ~/backups/reddi-agent-protocol-toolchain-baseline-20260901T043007Z

### Per-install inspection

No shell startup file changed after any individual installer.

No shell startup files changed. Installers were run with no PATH mutation where supported.
