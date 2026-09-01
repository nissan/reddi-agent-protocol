#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/solana-baseline-toolchain.sh [install|verify|capture|print-pins]

install    Install the pinned user-scoped RAP Solana baseline, then verify it.
verify     Probe exact expected versions without installing or changing host state.
capture    Write a version-capture artifact under artifacts/toolchain/.
print-pins Print the resolved pins from repository-owned authoritative sources.

The install mode is intentionally user-scoped and non-global: no sudo, no Docker,
no wallet/keypair creation, no Solana RPC/cluster config changes, and no mutable
installer pipes. It downloads only pinned official HTTPS assets and verifies SHA-256
where release metadata provides it.
USAGE
}

MODE="${1:-install}"
case "$MODE" in
  install|verify|capture|print-pins) ;;
  -h|--help|help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
ASSETS_JSON="$REPO_ROOT/config/toolchain/solana-baseline-assets.json"
DOWNLOAD_DIR="${RAP_BASELINE_DOWNLOAD_DIR:-$REPO_ROOT/.tmp/solana-baseline-downloads}"
SOLANA_INSTALL_DIR="${RAP_BASELINE_SOLANA_INSTALL_DIR:-$HOME/.local/share/solana/install}"
SOLANA_CONFIG="$SOLANA_INSTALL_DIR/config.yml"
SURFPOOL_ROOT="${RAP_BASELINE_SURFPOOL_ROOT:-$HOME/.local/share/surfpool/releases}"
CAPTURE_DIR="$REPO_ROOT/artifacts/toolchain"
PATH_PREFIX=""

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: required command not found: $1" >&2
    exit 1
  }
}

json_value() {
  local expr=$1
  python3 - "$ASSETS_JSON" "$expr" <<'PY'
import json, sys
path, expr = sys.argv[1:3]
with open(path, encoding='utf-8') as f:
    data = json.load(f)
cur = data
for part in expr.split('.'):
    cur = cur[part]
print(cur)
PY
}

toml_value() {
  local file=$1 expr=$2
  python3 - "$REPO_ROOT/$file" "$expr" <<'PY'
import sys, tomllib
path, expr = sys.argv[1:3]
with open(path, 'rb') as f:
    data = tomllib.load(f)
cur = data
for part in expr.split('.'):
    cur = cur[part]
if isinstance(cur, list):
    print(' '.join(str(x) for x in cur))
else:
    print(cur)
PY
}

resolve_agave_version() {
  python3 - "$REPO_ROOT" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
versions = set()
for rel in [
    '.github/workflows/anchor-program-tests.yml',
    '.github/workflows/quasar-program-tests.yml',
]:
    text = (root / rel).read_text(encoding='utf-8')
    versions.update(re.findall(r'https://release\.anza\.xyz/(v[0-9]+\.[0-9]+\.[0-9]+)/install', text))
if len(versions) != 1:
    raise SystemExit(f'expected exactly one Agave install version across CI workflows, found {sorted(versions)}')
print(next(iter(versions)))
PY
}

NODE_VERSION=$(toml_value .mise.toml tools.node)
RUST_VERSION=$(toml_value rust-toolchain.toml toolchain.channel)
RUST_COMPONENTS=$(toml_value rust-toolchain.toml toolchain.components)
ANCHOR_VERSION=$(toml_value Anchor.toml toolchain.anchor_version)
AGAVE_VERSION=$(resolve_agave_version)
SURFPOOL_VERSION=$(json_value surfpool.version)
NPM_VERSION=$(json_value node.npmBundledVersion)
RUSTUP_VERSION=$(json_value rustup.version)
RUSTUP_URL=$(json_value rustup.url)
RUSTUP_SHA256=$(json_value rustup.sha256)
AGAVE_URL_TEMPLATE=$(json_value agave.urlTemplate)
AGAVE_URL=${AGAVE_URL_TEMPLATE//\{version\}/$AGAVE_VERSION}
AGAVE_SHA256=$(python3 - "$ASSETS_JSON" "$AGAVE_VERSION" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
print(data['agave']['sha256ByVersion'][sys.argv[2]])
PY
)
SURFPOOL_URL=$(json_value surfpool.url)
SURFPOOL_SHA256=$(json_value surfpool.sha256)
AVM_GIT_URL=$(json_value anchorAvm.gitUrl)
AVM_TAG="v$ANCHOR_VERSION"
AVM_TAG_OBJECT_SHA=$(python3 - "$ASSETS_JSON" "$ANCHOR_VERSION" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
print(data['anchorAvm']['tagObjectShaByVersion'][sys.argv[2]])
PY
)
AVM_TAG_COMMIT_SHA=$(python3 - "$ASSETS_JSON" "$ANCHOR_VERSION" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)
print(data['anchorAvm']['tagCommitShaByVersion'][sys.argv[2]])
PY
)

export PATH="$HOME/.cargo/bin:$SOLANA_INSTALL_DIR/active_release/bin:$SURFPOOL_ROOT/$SURFPOOL_VERSION/bin:$PATH"

if [ "$MODE" = print-pins ]; then
  cat <<PINS
node=$NODE_VERSION (source: .mise.toml)
npm=$NPM_VERSION (source: config/toolchain/solana-baseline-assets.json, bundled with Node)
rust=$RUST_VERSION components=[$RUST_COMPONENTS] (source: rust-toolchain.toml)
agave=$AGAVE_VERSION (source: CI release.anza.xyz install URLs)
anchor=$ANCHOR_VERSION (source: Anchor.toml; AVM tag object $AVM_TAG_OBJECT_SHA, commit $AVM_TAG_COMMIT_SHA)
rustup-init=$RUSTUP_VERSION (source: config/toolchain/solana-baseline-assets.json)
surfpool=$SURFPOOL_VERSION (source: config/toolchain/solana-baseline-assets.json)
PINS
  exit 0
fi

version_output() {
  local label=$1; shift
  printf '$ %s\n' "$label"
  "$@" 2>&1 || true
  echo
}

capture_versions() {
  local phase=${1:-manual}
  mkdir -p "$CAPTURE_DIR"
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  local out="$CAPTURE_DIR/baseline-$phase-$stamp.md"
  {
    echo "# RAP Solana baseline toolchain capture ($phase)"
    echo
    echo "Captured: $stamp"
    echo "Worktree: $REPO_ROOT"
    echo "Git HEAD: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
    echo
    echo "## Expected pins"
    echo
    "$0" print-pins
    echo
    echo "## Probed versions"
    echo
    echo '```text'
    version_output "mise --version" mise --version
    version_output "mise exec node@$NODE_VERSION -- node --version" mise exec "node@$NODE_VERSION" -- node --version
    version_output "mise exec node@$NODE_VERSION -- npm --version" mise exec "node@$NODE_VERSION" -- npm --version
    for cmd in rustup rustc cargo solana agave-install avm anchor surfpool; do
      printf '$ command -v %s\n' "$cmd"
      command -v "$cmd" || true
      "$cmd" --version 2>&1 || true
      echo
    done
    version_output "rustup run $RUST_VERSION rustfmt --version" rustup run "$RUST_VERSION" rustfmt --version
    version_output "rustup run $RUST_VERSION cargo clippy --version" rustup run "$RUST_VERSION" cargo clippy --version
    echo '```'
  } > "$out"
  echo "$out"
}

expect_exact() {
  local description=$1 expected=$2; shift 2
  local output
  if ! output=$("$@" 2>&1); then
    echo "error: $description probe failed: $output" >&2
    return 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    echo "error: $description expected '$expected' but got '$output'" >&2
    return 1
  fi
  printf 'ok: %s -> %s\n' "$description" "$output"
}

verify_versions() {
  require_cmd mise
  expect_exact node "v$NODE_VERSION" mise exec "node@$NODE_VERSION" -- node --version
  expect_exact npm "$NPM_VERSION" mise exec "node@$NODE_VERSION" -- npm --version
  expect_exact rustc "rustc $RUST_VERSION" rustc --version
  expect_exact cargo "cargo $RUST_VERSION" cargo --version
  expect_exact rustfmt "rustfmt 1.8.0-stable" rustup run "$RUST_VERSION" rustfmt --version
  expect_exact clippy "clippy 0.1.89" rustup run "$RUST_VERSION" cargo clippy --version
  expect_exact solana "solana-cli ${AGAVE_VERSION#v}" solana --version
  expect_exact avm "avm $ANCHOR_VERSION" avm --version
  expect_exact anchor "anchor-cli $ANCHOR_VERSION" anchor --version
  expect_exact surfpool "surfpool ${SURFPOOL_VERSION#v}" surfpool --version
}

if [ "$MODE" = capture ]; then
  capture_versions manual
  exit 0
fi

if [ "$MODE" = verify ]; then
  verify_versions
  exit 0
fi

backup_shell_startup() {
  local stamp=$1
  local backup_dir="$HOME/backups/reddi-agent-protocol-toolchain-baseline-$stamp"
  mkdir -p "$backup_dir"
  local copied=0
  for file in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.config/fish/config.fish"; do
    if [ -e "$file" ]; then
      cp -a "$file" "$backup_dir/$(basename "$file")"
      copied=$((copied + 1))
    fi
  done
  printf '%s\n' "$backup_dir"
}

inspect_shell_startup_diffs() {
  local backup_dir=$1 out=$2
  {
    echo "## Shell startup file diff inspection"
    echo
    echo "Backup directory: $backup_dir"
    echo
    local any=0
    for file in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.config/fish/config.fish"; do
      [ -e "$file" ] || continue
      local base="$backup_dir/$(basename "$file")"
      [ -e "$base" ] || continue
      if ! cmp -s "$base" "$file"; then
        any=1
        echo "### Diff: $file"
        echo '```diff'
        diff -u "$base" "$file" || true
        echo '```'
      fi
    done
    if [ "$any" -eq 0 ]; then
      echo "No shell startup files changed. Installers were run with no PATH mutation where supported."
    fi
  } >> "$out"
}

download_verified() {
  local url=$1 sha256=$2 out=$3
  mkdir -p "$(dirname "$out")"
  if [ ! -f "$out" ]; then
    curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$out"
  fi
  printf '%s  %s\n' "$sha256" "$out" | sha256sum -c - >/dev/null
}

install_node() {
  require_cmd mise
  mise install "node@$NODE_VERSION"
}

install_rust() {
  mkdir -p "$DOWNLOAD_DIR"
  local rustup_init="$DOWNLOAD_DIR/rustup-init-$RUSTUP_VERSION"
  if ! command -v rustup >/dev/null 2>&1; then
    download_verified "$RUSTUP_URL" "$RUSTUP_SHA256" "$rustup_init"
    chmod +x "$rustup_init"
    "$rustup_init" -y --no-modify-path --default-toolchain none
  fi
  rustup set auto-self-update disable
  rustup toolchain install "$RUST_VERSION" --profile minimal $(for c in $RUST_COMPONENTS; do printf -- ' --component %q' "$c"; done)
}

install_agave() {
  mkdir -p "$DOWNLOAD_DIR" "$SOLANA_INSTALL_DIR"
  local init="$DOWNLOAD_DIR/agave-install-init-$AGAVE_VERSION"
  download_verified "$AGAVE_URL" "$AGAVE_SHA256" "$init"
  chmod +x "$init"
  "$init" --no-modify-path --config "$SOLANA_CONFIG" --data-dir "$SOLANA_INSTALL_DIR" "$AGAVE_VERSION"
}

install_anchor() {
  local refs
  refs=$(git ls-remote --tags "$AVM_GIT_URL" "refs/tags/$AVM_TAG" "refs/tags/$AVM_TAG^{}")
  grep -q "^$AVM_TAG_OBJECT_SHA[[:space:]]refs/tags/$AVM_TAG$" <<<"$refs" || {
    echo "error: $AVM_TAG object SHA no longer matches recorded $AVM_TAG_OBJECT_SHA" >&2
    exit 1
  }
  grep -q "^$AVM_TAG_COMMIT_SHA[[:space:]]refs/tags/$AVM_TAG\^{}$" <<<"$refs" || {
    echo "error: $AVM_TAG commit SHA no longer matches recorded $AVM_TAG_COMMIT_SHA" >&2
    exit 1
  }
  cargo install --git "$AVM_GIT_URL" avm --tag "$AVM_TAG" --locked
  avm install "$ANCHOR_VERSION"
  avm use "$ANCHOR_VERSION"
}

install_surfpool() {
  mkdir -p "$DOWNLOAD_DIR" "$SURFPOOL_ROOT/$SURFPOOL_VERSION/bin"
  local archive="$DOWNLOAD_DIR/surfpool-$SURFPOOL_VERSION-linux-x64.tar.gz"
  download_verified "$SURFPOOL_URL" "$SURFPOOL_SHA256" "$archive"
  local tmp="$DOWNLOAD_DIR/surfpool-extract-$SURFPOOL_VERSION"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  tar -xzf "$archive" -C "$tmp"
  install -m 0755 "$tmp/surfpool" "$SURFPOOL_ROOT/$SURFPOOL_VERSION/bin/surfpool"
}

main_install() {
  require_cmd python3
  require_cmd curl
  require_cmd sha256sum
  require_cmd tar
  require_cmd git
  local stamp
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  local backup_dir
  backup_dir=$(backup_shell_startup "$stamp")
  local before_capture
  before_capture=$(capture_versions "before-install")
  echo "Backed up shell startup files to $backup_dir"
  echo "Captured pre-install versions to $before_capture"

  install_node
  install_rust
  install_agave
  install_anchor
  install_surfpool

  local after_capture
  after_capture=$(capture_versions "after-install")
  inspect_shell_startup_diffs "$backup_dir" "$after_capture"
  echo "Captured post-install versions to $after_capture"
  verify_versions
}

main_install
