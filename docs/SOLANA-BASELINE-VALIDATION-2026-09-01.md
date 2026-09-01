# RAP baseline validation evidence

Manually authored record of the 2026-09-01 baseline install run; no script emits this file. The machine-generated version captures it references live under `artifacts/toolchain/`.

Date: 2026-09-01
Worktree: `~/.treehouse/reddi-agent-protocol-276f74/5/reddi-agent-protocol`
Branch: `fm/rap-toolchain-baseline`

## Host changes made

- Installed Node `24.20.0` through mise; default `node --version` outside repo remains `v26.7.0`.
- Installed user-scoped rustup/Rust `1.89.0` with `rustfmt` and `clippy` under `~/.rustup`/`~/.cargo`; set rustup auto-self-update to disabled after the install.
- Initially installed user-scoped Agave/Solana CLI `v3.1.13` under shared default `~/.local/share/solana/install`; later review tightened the reproducible default to the baseline-owned `~/.local/share/solana/reddi-agent-protocol-baseline/install` directory so future installs do not relink the shared default unless explicitly overridden.
- Installed AVM `1.0.0` and selected Anchor CLI `1.0.0` under user Cargo/AVM paths.
- Installed Surfpool `v1.5.0` under `~/.local/share/surfpool/releases/v1.5.0/bin`.
- Shell startup backups: `~/backups/reddi-agent-protocol-toolchain-baseline-20260901T015341Z`, `~/backups/reddi-agent-protocol-toolchain-baseline-20260901T015716Z`, `~/backups/reddi-agent-protocol-toolchain-baseline-20260901T020113Z`, `~/backups/reddi-agent-protocol-toolchain-baseline-20260901T021001Z`, `~/backups/reddi-agent-protocol-toolchain-baseline-20260901T042905Z`, `~/backups/reddi-agent-protocol-toolchain-baseline-20260901T043007Z`.
- Final startup-file diff inspection: no shell startup files changed. Per-installer startup-diff attribution is present in `artifacts/toolchain/baseline-after-install-20260901T043009Z.md` for the later idempotent install; it is the current script-generated install evidence.

## Version captures

- Manually captured preinstall record: `docs/SOLANA-BASELINE-PREINSTALL-MANUAL-2026-09-01.md`
- Superseded after install: `artifacts/toolchain/baseline-after-install-20260901T021005Z.md`
- Current script-generated before install: `artifacts/toolchain/baseline-before-install-20260901T043007Z.md`
- Current script-generated after install: `artifacts/toolchain/baseline-after-install-20260901T043009Z.md`
- Current non-installing capture after the Surfpool smoke path fix: `artifacts/toolchain/baseline-manual-20260901T043231Z.md`

## Verification run

Passed initially against the script as of commit 02aaeb3, then rerun after the review fixes tightened `verify`, pin checks, capture redaction, Agave's default install path, and rollback wording:

- `scripts/solana-baseline-toolchain.sh verify`
- `npm run check:toolchain:baseline`
- `mise exec node@24.20.0 -- npm ci --no-audit --no-fund`
- `mise exec node@24.20.0 -- npm test -- --ci --maxWorkers=2` — 125 suites / 597 tests passed.
- `cargo build-sbf --manifest-path programs/escrow/Cargo.toml` completed, but generated `target/deploy/escrow-keypair.json`; the generated keypair was removed without reading contents, and this build command should not be treated as a safe no-keypair baseline check when `target/deploy` is clean.
- `cargo test -p escrow` — 33 tests passed, 1 devnet-only ignored, rerun after removing the generated `target/deploy/escrow-keypair.json`.
- `npm run check:toolchain:surfpool-smoke` — started Surfpool offline on dynamic localhost ports, verified `solana cluster-version`, and killed only the process started by the smoke.
- `scripts/rollback-solana-baseline.sh --plan` — printed the user-scoped rollback procedure without changing the host.

Captured failure (not weakened):

- `mise exec node@24.20.0 -- npm run lint` failed with existing ESLint errors unrelated to this baseline setup, including `app/tour/page.tsx`, `jest.config.js`, generated `dist` files, and multiple existing `no-explicit-any` / `no-require-imports` findings.

Not run:

- Existing broad Surfpool lanes such as `npm run test:surfpool:critical`, because they use fixed ports, may kill listeners on those ports, and depend on configured keypair paths. The new baseline smoke covers Surfpool process startup without those unsafe side effects.
