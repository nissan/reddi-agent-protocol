#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PILOT="$ROOT/pilots/anchor-v2-update-agent"
OUT="$ROOT/.tmp/anchor-v2-update-agent-pilot"
SBF_OUT="$OUT/sbf"
IDL_OUT="$OUT/idl"
TARGET_DIR="$OUT/sbf-target"

for command_name in cargo cargo-build-sbf anchor node; do
  command -v "$command_name" >/dev/null || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done

[[ "$(cargo --version)" == cargo\ 1.98.0* ]] || {
  echo "pilot requires repository-pinned cargo 1.98.0" >&2
  exit 1
}
[[ "$(cargo-build-sbf --version | head -n 1)" == "cargo-build-sbf 4.1.0" ]] || {
  echo "pilot requires repository-pinned cargo-build-sbf 4.1.0" >&2
  exit 1
}
[[ "$(anchor --version)" == "anchor-cli 1.1.2" ]] || {
  echo "pilot keeps Anchor CLI 1.1.2 authoritative" >&2
  exit 1
}

rm -rf "$OUT"
mkdir -p \
  "$SBF_OUT/alpha_update_agent-keypair.json" \
  "$SBF_OUT/stable_update_agent-keypair.json" \
  "$IDL_OUT"

# cargo-build-sbf normally creates deployment keypairs when their expected paths
# are absent. Directory sentinels make those paths already exist, so this
# compile-only pilot cannot create key material. They are checked again below.
CARGO_TARGET_DIR="$TARGET_DIR" cargo build-sbf \
  --manifest-path "$PILOT/Cargo.toml" \
  --sbf-out-dir "$SBF_OUT" \
  --arch v3 \
  --tools-version v1.54 \
  --workspace

for sentinel in alpha_update_agent-keypair.json stable_update_agent-keypair.json; do
  [[ -d "$SBF_OUT/$sentinel" ]] || {
    echo "safety failure: build replaced key-blocking sentinel $sentinel" >&2
    exit 1
  }
done
if find "$OUT" -type f -name '*keypair*.json' -print -quit | grep -q .; then
  echo "safety failure: pilot generated key material" >&2
  exit 1
fi

(
  export CARGO_TARGET_DIR="$OUT/idl-target"
  cd "$PILOT"
  anchor idl build -p stable_update_agent \
    -o "$IDL_OUT/stable.json" -t "$IDL_OUT/stable.ts" --skip-lint
  anchor idl build -p alpha_update_agent \
    -o "$IDL_OUT/alpha.json" -t "$IDL_OUT/alpha.ts" --skip-lint
)

CARGO_TARGET_DIR="$OUT/compat-target" \
  cargo test --locked \
    --manifest-path "$PILOT/Cargo.toml" \
    -p alpha-update-agent \
    generated_clients_match_the_canonical_stable_wire_contract -- --nocapture

ANCHOR_V2_PILOT_SBF_OUT_DIR="$SBF_OUT" \
  CARGO_TARGET_DIR="$OUT/runtime-target" \
  cargo test --locked \
    --manifest-path "$PILOT/runtime-harness/Cargo.toml" -- --nocapture \
    2>&1 | tee "$OUT/compute.log"

node "$PILOT/compare-evidence.mjs" \
  "$IDL_OUT/stable.json" \
  "$IDL_OUT/alpha.json" \
  "$SBF_OUT/stable_update_agent.so" \
  "$SBF_OUT/alpha_update_agent.so" \
  "$OUT/compute.log" \
  "$OUT/evidence.json"

echo "Anchor v2 update_agent pilot evidence: $OUT/evidence.json"
