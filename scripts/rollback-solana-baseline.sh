#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
ASSETS_JSON="$ROOT_DIR/config/toolchain/solana-baseline-assets.json"

json_value() {
  python3 - "$ASSETS_JSON" "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
cur = data
for part in sys.argv[2].split('.'):
    cur = cur[part]
print(cur)
PY
}

toml_value() {
  python3 - "$ROOT_DIR/$1" "$2" <<'PY'
import sys, tomllib
with open(sys.argv[1], 'rb') as f:
    data = tomllib.load(f)
cur = data
for part in sys.argv[2].split('.'):
    cur = cur[part]
print(cur)
PY
}

NODE_VERSION=$(toml_value .mise.toml tools.node)
RUST_VERSION=$(toml_value rust-toolchain.toml toolchain.channel)
ANCHOR_VERSION=$(toml_value Anchor.toml toolchain.anchor_version)
SURFPOOL_VERSION=$(json_value surfpool.version)
SOLANA_INSTALL_DIR="${RAP_BASELINE_SOLANA_INSTALL_DIR:-$HOME/.local/share/solana/install}"
SURFPOOL_DIR="${RAP_BASELINE_SURFPOOL_ROOT:-$HOME/.local/share/surfpool/releases}/$SURFPOOL_VERSION"

MODE="${1:---plan}"
if [ "$MODE" != "--plan" ] && [ "$MODE" != "--execute" ]; then
  echo "Usage: scripts/rollback-solana-baseline.sh [--plan|--execute]" >&2
  exit 2
fi

plan() {
  cat <<PLAN
Rollback plan for the RAP baseline (user-scoped only):
- Node: keep Node 26 available; optionally remove repository pin install with: mise uninstall node@$NODE_VERSION
- Rust: remove pinned repo toolchain with: rustup toolchain uninstall $RUST_VERSION
- Solana CLI: remove install tree: $SOLANA_INSTALL_DIR
- Anchor/AVM: remove Anchor $ANCHOR_VERSION with AVM if available; remove ~/.cargo/bin/avm and ~/.cargo/bin/anchor only if no other work uses them.
- Surfpool: remove install tree: $SURFPOOL_DIR
- Shell startup files: restore manually from the timestamped backup recorded in artifacts/toolchain/*.md only if a diff inspection says they changed. Do not inspect or restore keypair contents.
PLAN
}

plan

if [ "$MODE" = "--plan" ]; then
  exit 0
fi

read -r -p "Type RAP BASELINE ROLLBACK to remove the user-scoped baseline installs: " answer
if [ "$answer" != "RAP BASELINE ROLLBACK" ]; then
  echo "rollback cancelled" >&2
  exit 1
fi

command -v mise >/dev/null 2>&1 && mise uninstall "node@$NODE_VERSION" || true
if command -v rustup >/dev/null 2>&1; then
  rustup toolchain uninstall "$RUST_VERSION" || true
fi
if command -v avm >/dev/null 2>&1; then
  avm uninstall "$ANCHOR_VERSION" || true
fi
rm -rf "$SOLANA_INSTALL_DIR" "$SURFPOOL_DIR"
echo "rollback complete for user-scoped baseline paths; review shell startup backups manually if needed"
