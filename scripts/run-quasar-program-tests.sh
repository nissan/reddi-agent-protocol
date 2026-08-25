#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if ! command -v cargo >/dev/null 2>&1; then
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
  else
    echo "cargo not found" >&2
    exit 127
  fi
fi

# Shared library crates — not SBF programs, so they are only `cargo test`ed.
# quasar-escrow-ref holds the single canonical mirror of quasar-escrow's account
# layout; its assertions are what catch an upstream layout change before the
# consuming programs silently misread payer/payee.
libs=(
  quasar-escrow-ref
)

for lib in "${libs[@]}"; do
  manifest="experiments/${lib}/Cargo.toml"
  if [ ! -f "$manifest" ]; then
    echo "missing Quasar library manifest: $manifest" >&2
    exit 1
  fi

  echo "==> cargo test --manifest-path $manifest"
  cargo test --manifest-path "$manifest"
done

programs=(
  quasar-escrow
  quasar-escrow-per
  quasar-registry
  quasar-reputation
  quasar-attestation
)

for program in "${programs[@]}"; do
  manifest="experiments/${program}/Cargo.toml"
  if [ ! -f "$manifest" ]; then
    echo "missing Quasar program manifest: $manifest" >&2
    exit 1
  fi

  echo "==> cargo build-sbf --manifest-path $manifest"
  cargo build-sbf --manifest-path "$manifest"

  echo "==> cargo test --manifest-path $manifest"
  cargo test --manifest-path "$manifest"
done

echo "Quasar compile/test loop passed for libs: ${libs[*]}"
echo "Quasar program compile/test loop passed for: ${programs[*]}"
