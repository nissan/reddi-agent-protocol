#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/solana-baseline-toolchain.sh <install|verify|capture|print-pins>

The mode is required: only 'install' changes host state, and it must be asked for
explicitly.

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

MODE="${1:-}"
case "$MODE" in
  install|verify|capture|print-pins) ;;
  -h|--help|help) usage; exit 0 ;;
  "")
    usage >&2
    echo "error: no mode given; pass one explicitly (install changes host state)" >&2
    exit 2
    ;;
  *) usage >&2; exit 2 ;;
esac

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SELF="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)
cd "$REPO_ROOT"
# shellcheck source=lib/solana-baseline-version-match.sh
. "$SCRIPT_DIR/lib/solana-baseline-version-match.sh"
ASSETS_JSON="$REPO_ROOT/config/toolchain/solana-baseline-assets.json"
DOWNLOAD_DIR="${RAP_BASELINE_DOWNLOAD_DIR:-$REPO_ROOT/.tmp/solana-baseline-downloads}"
SHARED_SOLANA_INSTALL_DIR="$HOME/.local/share/solana/install"
SOLANA_INSTALL_DIR="${RAP_BASELINE_SOLANA_INSTALL_DIR:-$HOME/.local/share/solana/reddi-agent-protocol-baseline/install}"
SOLANA_CONFIG="$SOLANA_INSTALL_DIR/config.yml"
SURFPOOL_ROOT="${RAP_BASELINE_SURFPOOL_ROOT:-$HOME/.local/share/surfpool/releases}"
AVM_BIN_DIR="${AVM_HOME:-$HOME/.avm}/bin"
CAPTURE_DIR="$REPO_ROOT/artifacts/toolchain"
STARTUP_FILES=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.config/fish/config.fish")
STEP_SNAPSHOT=""
STEP_LOG=""
export RUSTUP_AUTO_INSTALL=0
export MISE_AUTO_INSTALL=false
export MISE_NOT_FOUND_AUTO_INSTALL=false

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

json_keyed_value() {
  local expr=$1 key=$2
  python3 - "$ASSETS_JSON" "$expr" "$key" <<'PY'
import json, sys
path, expr, key = sys.argv[1:4]
with open(path, encoding='utf-8') as f:
    data = json.load(f)
cur = data
for part in expr.split('.'):
    cur = cur[part]
if key not in cur:
    raise SystemExit(f'error: {path} has no {expr} entry for {key!r}')
print(cur[key])
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
    '.github/workflows/surfpool-acceptance-manual.yml',
    '.github/workflows/surfpool-quasar-critical-sdk.yml',
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
AGAVE_SHA256=$(json_keyed_value agave.sha256ByVersion "$AGAVE_VERSION")
CARGO_BUILD_SBF_VERSION=$(json_keyed_value sbf.cargoBuildSbfVersionByAgaveVersion "$AGAVE_VERSION")
PLATFORM_TOOLS_VERSION=$(json_keyed_value sbf.platformToolsVersionByCargoBuildSbfVersion "$CARGO_BUILD_SBF_VERSION")
SBF_BIN_DIR="$SOLANA_INSTALL_DIR/active_release/bin"
RUSTFMT_VERSION=$(json_keyed_value rust.rustfmtVersionByChannel "$RUST_VERSION")
CLIPPY_VERSION=$(json_keyed_value rust.clippyVersionByChannel "$RUST_VERSION")
SURFPOOL_URL=$(json_value surfpool.url)
SURFPOOL_SHA256=$(json_value surfpool.sha256)
AVM_GIT_URL=$(json_value anchorAvm.gitUrl)
AVM_MANAGER_VERSION=$(json_value anchorAvm.managerVersion)
AVM_TAG="v$AVM_MANAGER_VERSION"
AVM_TAG_OBJECT_SHA=$(json_keyed_value anchorAvm.tagObjectShaByVersion "$AVM_MANAGER_VERSION")
AVM_TAG_COMMIT_SHA=$(json_keyed_value anchorAvm.tagCommitShaByVersion "$AVM_MANAGER_VERSION")
ANCHOR_TAG="v$ANCHOR_VERSION"
ANCHOR_TAG_OBJECT_SHA=$(json_keyed_value anchorAvm.tagObjectShaByVersion "$ANCHOR_VERSION")
ANCHOR_TAG_COMMIT_SHA=$(json_keyed_value anchorAvm.tagCommitShaByVersion "$ANCHOR_VERSION")
ANCHOR_CLI_URL_TEMPLATE=$(json_value anchorCli.urlTemplate)
ANCHOR_CLI_URL=${ANCHOR_CLI_URL_TEMPLATE//\{version\}/$ANCHOR_VERSION}
ANCHOR_CLI_PLATFORM=$(json_value anchorCli.platform)
ANCHOR_CLI_ASSET_NAME_TEMPLATE=$(json_value anchorCli.assetNameTemplate)
ANCHOR_CLI_ASSET_NAME=${ANCHOR_CLI_ASSET_NAME_TEMPLATE//\{version\}/$ANCHOR_VERSION}
ANCHOR_CLI_SHA256=$(json_keyed_value anchorCli.sha256ByVersion "$ANCHOR_VERSION")

case "$ANCHOR_CLI_ASSET_NAME" in
  *"$ANCHOR_CLI_PLATFORM") ;;
  *)
    echo "error: recorded anchorCli.assetNameTemplate does not target anchorCli.platform $ANCHOR_CLI_PLATFORM" >&2
    exit 1
    ;;
esac
if [ "${ANCHOR_CLI_URL##*/}" != "$ANCHOR_CLI_ASSET_NAME" ]; then
  echo "error: recorded anchorCli.urlTemplate and anchorCli.assetNameTemplate disagree on the release asset name" >&2
  exit 1
fi

export PATH="$HOME/.cargo/bin:$SOLANA_INSTALL_DIR/active_release/bin:$SURFPOOL_ROOT/$SURFPOOL_VERSION/bin:$PATH"

if [ "$MODE" = print-pins ]; then
  cat <<PINS
node=$NODE_VERSION (source: .mise.toml)
npm=$NPM_VERSION (source: config/toolchain/solana-baseline-assets.json, bundled with Node)
rust=$RUST_VERSION components=[$RUST_COMPONENTS] (source: rust-toolchain.toml)
rustfmt=$RUSTFMT_VERSION (source: config/toolchain/solana-baseline-assets.json, shipped with Rust $RUST_VERSION)
clippy=$CLIPPY_VERSION (source: config/toolchain/solana-baseline-assets.json, shipped with Rust $RUST_VERSION)
agave=$AGAVE_VERSION (source: CI release.anza.xyz install URLs)
cargo-build-sbf=$CARGO_BUILD_SBF_VERSION (source: config/toolchain/solana-baseline-assets.json; shipped inside the Agave $AGAVE_VERSION release tarball, which also provides cargo-test-sbf from the same crate)
platform-tools=$PLATFORM_TOOLS_VERSION (source: config/toolchain/solana-baseline-assets.json, cargo-build-sbf $CARGO_BUILD_SBF_VERSION default; fetched on demand and not checksummed here)
avm=$AVM_MANAGER_VERSION (source: config/toolchain/solana-baseline-assets.json; official tag object $AVM_TAG_OBJECT_SHA, commit $AVM_TAG_COMMIT_SHA)
anchor=$ANCHOR_VERSION (source: Anchor.toml; official tag object $ANCHOR_TAG_OBJECT_SHA, commit $ANCHOR_TAG_COMMIT_SHA; release binary sha256 $ANCHOR_CLI_SHA256)
rustup-init=$RUSTUP_VERSION (source: config/toolchain/solana-baseline-assets.json)
surfpool=$SURFPOOL_VERSION (source: config/toolchain/solana-baseline-assets.json)
PINS
  exit 0
fi

rustup_pinned_toolchain_installed() {
  command -v rustup >/dev/null 2>&1 || return 1
  rustup toolchain list 2>/dev/null | grep -q "^$RUST_VERSION\(-\| \|\$\)"
}

is_rustup_proxy() {
  local resolved
  resolved=$(command -v "$1" 2>/dev/null) || return 1
  [ "$resolved" = "${CARGO_HOME:-$HOME/.cargo}/bin/$1" ]
}

is_mise_shim() {
  local resolved
  resolved=$(command -v "$1" 2>/dev/null) || return 1
  [ "$resolved" = "${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims/$1" ]
}

probe_ambient_version() {
  local cmd=$1
  case "$cmd" in
    rustc|cargo)
      if is_rustup_proxy "$cmd" && ! rustup_pinned_toolchain_installed; then
        echo "not probed: this is a rustup proxy and toolchain $RUST_VERSION named by rust-toolchain.toml is not installed"
        return 0
      fi
      ;;
    node|npm|npx)
      if is_mise_shim "$cmd" && ! mise_pinned_node_dir >/dev/null; then
        echo "not probed: this is a mise shim and node@$NODE_VERSION named by .mise.toml is not installed"
        return 0
      fi
      ;;
  esac
  "$cmd" --version 2>&1 || true
}

mise_pinned_node_dir() {
  local dir
  dir=$(mise where "node@$NODE_VERSION" 2>/dev/null) || return 1
  [ -n "$dir" ] || return 1
  printf '%s\n' "$dir"
}

redact_home() {
  sed "s#${HOME}#~#g"
}

version_output() {
  local label=$1; shift
  printf '$ %s\n' "$label"
  ("$@" 2>&1 || true) | redact_home
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
    echo "Worktree: <local worktree path redacted>"
    echo "Git HEAD: $(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
    echo
    echo "## Expected pins"
    echo
    "$SELF" print-pins
    echo
    echo "## Probed versions"
    echo
    echo '```text'
    version_output "mise --version" mise --version
    if mise_pinned_node_dir >/dev/null; then
      version_output "mise exec node@$NODE_VERSION -- node --version" mise exec "node@$NODE_VERSION" -- node --version
      version_output "mise exec node@$NODE_VERSION -- npm --version" mise exec "node@$NODE_VERSION" -- npm --version
    else
      printf '$ mise where node@%s\n' "$NODE_VERSION"
      echo "node@$NODE_VERSION is not installed through mise (not probed, to avoid installing it)"
      echo
    fi
    for cmd in node npm npx rustup rustc cargo solana agave-install avm anchor surfpool cargo-build-sbf cargo-test-sbf; do
      printf '$ command -v %s\n' "$cmd"
      (command -v "$cmd" || true) | redact_home
      probe_ambient_version "$cmd" | redact_home
      echo
    done
    for sbf_bin in cargo-build-sbf cargo-test-sbf; do
      printf '$ %s --version\n' "$(printf '%s' "$SBF_BIN_DIR/$sbf_bin" | redact_home)"
      if [ -x "$SBF_BIN_DIR/$sbf_bin" ]; then
        ("$SBF_BIN_DIR/$sbf_bin" --version 2>&1 || true) | redact_home
      else
        echo "not present in the baseline-owned Agave tree (not probed)"
      fi
      echo
    done
    if rustup_pinned_toolchain_installed; then
      version_output "rustup run $RUST_VERSION rustfmt --version" rustup run "$RUST_VERSION" rustfmt --version
      version_output "rustup run $RUST_VERSION cargo clippy --version" rustup run "$RUST_VERSION" cargo clippy --version
    else
      printf '$ rustup toolchain list\n'
      echo "toolchain $RUST_VERSION is not installed (rustfmt/clippy not probed, to avoid installing it)"
      echo
    fi
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
  if ! version_token_match "$output" "$expected"; then
    echo "error: $description expected '$expected' but got '$output'" >&2
    return 1
  fi
  printf 'ok: %s -> %s\n' "$description" "$output"
}

verify_versions() {
  require_cmd mise
  if ! mise_pinned_node_dir >/dev/null; then
    echo "error: node@$NODE_VERSION is not installed through mise; run 'scripts/solana-baseline-toolchain.sh install' (verify never installs)" >&2
    return 1
  fi
  expect_exact node "v$NODE_VERSION" mise exec "node@$NODE_VERSION" -- node --version
  expect_exact npm "$NPM_VERSION" mise exec "node@$NODE_VERSION" -- npm --version
  expect_exact rustc "rustc $RUST_VERSION" rustup run "$RUST_VERSION" rustc --version
  expect_exact cargo "cargo $RUST_VERSION" rustup run "$RUST_VERSION" cargo --version
  expect_exact rustfmt "rustfmt $RUSTFMT_VERSION" rustup run "$RUST_VERSION" rustfmt --version
  expect_exact clippy "clippy $CLIPPY_VERSION" rustup run "$RUST_VERSION" cargo clippy --version
  expect_exact solana "solana-cli ${AGAVE_VERSION#v}" solana --version
  expect_exact cargo-build-sbf "cargo-build-sbf $CARGO_BUILD_SBF_VERSION" "$SBF_BIN_DIR/cargo-build-sbf" --version
  expect_exact platform-tools "platform-tools $PLATFORM_TOOLS_VERSION" "$SBF_BIN_DIR/cargo-build-sbf" --version
  expect_exact cargo-test-sbf "cargo-build-sbf $CARGO_BUILD_SBF_VERSION" "$SBF_BIN_DIR/cargo-test-sbf" --version
  expect_exact avm "avm $AVM_MANAGER_VERSION" avm --version
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
  for file in "${STARTUP_FILES[@]}"; do
    if [ -e "$file" ]; then
      cp -a "$file" "$backup_dir/$(basename "$file")"
      copied=$((copied + 1))
    fi
  done
  printf '%s\n' "$backup_dir"
}

snapshot_shell_startup() {
  local dir=$1 file
  mkdir -p "$dir"
  rm -f "$dir"/*
  for file in "${STARTUP_FILES[@]}"; do
    [ -e "$file" ] && cp -a "$file" "$dir/$(basename "$file")"
  done
  return 0
}

inspect_step_startup_diffs() {
  local step=$1 snapshot_dir=$2 log=$3 file base
  for file in "${STARTUP_FILES[@]}"; do
    base="$snapshot_dir/$(basename "$file")"
    if [ -e "$file" ] && [ ! -e "$base" ]; then
      echo "### Created during $step: $file" >> "$log"
    elif [ -e "$file" ] && [ -e "$base" ] && ! cmp -s "$base" "$file"; then
      {
        echo "### Changed during $step: $file"
        echo '```diff'
        diff -u "$base" "$file" || true
        echo '```'
      } >> "$log"
    fi
  done
  snapshot_shell_startup "$snapshot_dir"
}

inspect_shell_startup_diffs() {
  local backup_dir=$1 out=$2 step_log=${3:-}
  {
    echo "## Shell startup file diff inspection"
    echo
    echo "Backup directory: $(printf '%s' "$backup_dir" | redact_home)"
    echo
    if [ -n "$step_log" ]; then
      echo "### Per-install inspection"
      echo
      if [ -s "$step_log" ]; then
        cat "$step_log"
      else
        echo "No shell startup file changed after any individual installer."
      fi
      echo
    fi
    local any=0
    for file in "${STARTUP_FILES[@]}"; do
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

checksum_ok() {
  local sha256=$1 file=$2
  printf '%s  %s\n' "$sha256" "$file" | sha256sum -c - >/dev/null 2>&1
}

download_verified() {
  local url=$1 sha256=$2 out=$3
  mkdir -p "$(dirname "$out")"
  if [ -f "$out" ] && checksum_ok "$sha256" "$out"; then
    return 0
  fi
  rm -f "$out"
  local tmp="$out.partial.$$"
  rm -f "$tmp"
  if ! curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$tmp"; then
    rm -f "$tmp"
    echo "error: download failed for $url" >&2
    return 1
  fi
  if ! checksum_ok "$sha256" "$tmp"; then
    rm -f "$tmp"
    echo "error: SHA-256 mismatch for $url (expected $sha256)" >&2
    return 1
  fi
  mv -f "$tmp" "$out"
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
    rustup set auto-self-update disable
  else
    echo "rustup already present; leaving its auto-self-update setting as the host had it"
  fi
  rustup toolchain install "$RUST_VERSION" --profile minimal $(for c in $RUST_COMPONENTS; do printf -- ' --component %q' "$c"; done)
}

install_agave() {
  mkdir -p "$DOWNLOAD_DIR" "$SOLANA_INSTALL_DIR"
  if [ "$SOLANA_INSTALL_DIR" = "$SHARED_SOLANA_INSTALL_DIR" ]; then
    echo "warning: RAP_BASELINE_SOLANA_INSTALL_DIR points at the shared default agave-install data dir:" >&2
    echo "         $SHARED_SOLANA_INSTALL_DIR" >&2
    echo "         installing here relinks active_release and can change the user-wide 'solana'." >&2
    if [ -x "$SOLANA_INSTALL_DIR/active_release/bin/solana" ]; then
      echo "         currently active there: $("$SOLANA_INSTALL_DIR/active_release/bin/solana" --version 2>&1 || true)" >&2
    fi
  else
    echo "note: installing Agave $AGAVE_VERSION into baseline-owned directory $SOLANA_INSTALL_DIR"
    echo "      shared default agave-install data dir is left untouched: $SHARED_SOLANA_INSTALL_DIR"
  fi
  local init="$DOWNLOAD_DIR/agave-install-init-$AGAVE_VERSION"
  download_verified "$AGAVE_URL" "$AGAVE_SHA256" "$init"
  chmod +x "$init"
  "$init" --no-modify-path --config "$SOLANA_CONFIG" --data-dir "$SOLANA_INSTALL_DIR" "$AGAVE_VERSION"
}

install_anchor() {
  local refs anchor_refs
  refs=$(git ls-remote --tags "$AVM_GIT_URL" "refs/tags/$AVM_TAG" "refs/tags/$AVM_TAG^{}")
  grep -q "^$AVM_TAG_OBJECT_SHA[[:space:]]refs/tags/$AVM_TAG$" <<<"$refs" || {
    echo "error: $AVM_TAG object SHA no longer matches recorded $AVM_TAG_OBJECT_SHA" >&2
    exit 1
  }
  grep -q "^$AVM_TAG_COMMIT_SHA[[:space:]]refs/tags/$AVM_TAG\^{}$" <<<"$refs" || {
    echo "error: $AVM_TAG commit SHA no longer matches recorded $AVM_TAG_COMMIT_SHA" >&2
    exit 1
  }
  anchor_refs=$(git ls-remote --tags "$AVM_GIT_URL" "refs/tags/$ANCHOR_TAG" "refs/tags/$ANCHOR_TAG^{}")
  grep -q "^$ANCHOR_TAG_OBJECT_SHA[[:space:]]refs/tags/$ANCHOR_TAG$" <<<"$anchor_refs" || {
    echo "error: $ANCHOR_TAG object SHA no longer matches recorded $ANCHOR_TAG_OBJECT_SHA" >&2
    exit 1
  }
  grep -q "^$ANCHOR_TAG_COMMIT_SHA[[:space:]]refs/tags/$ANCHOR_TAG\^{}$" <<<"$anchor_refs" || {
    echo "error: $ANCHOR_TAG commit SHA no longer matches recorded $ANCHOR_TAG_COMMIT_SHA" >&2
    exit 1
  }

  if version_token_match "$(avm --version 2>/dev/null || true)" "avm $AVM_MANAGER_VERSION" \
    && version_token_match "$(anchor --version 2>/dev/null || true)" "anchor-cli $ANCHOR_VERSION"; then
    echo "avm $AVM_MANAGER_VERSION and anchor $ANCHOR_VERSION already selected; skipping install"
    return 0
  fi

  if ! version_token_match "$(avm --version 2>/dev/null || true)" "avm $AVM_MANAGER_VERSION"; then
    cargo install --git "$AVM_GIT_URL" avm --rev "$AVM_TAG_COMMIT_SHA" --locked
  fi

  mkdir -p "$AVM_BIN_DIR" "$DOWNLOAD_DIR"
  local anchor_download="$DOWNLOAD_DIR/$ANCHOR_CLI_ASSET_NAME"
  local anchor_bin="$AVM_BIN_DIR/anchor-$ANCHOR_VERSION"
  download_verified "$ANCHOR_CLI_URL" "$ANCHOR_CLI_SHA256" "$anchor_download"
  install -m 0755 "$anchor_download" "$anchor_bin"
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

  local step
  STEP_SNAPSHOT=$(mktemp -d)
  STEP_LOG=$(mktemp)
  trap 'rm -rf "${STEP_SNAPSHOT:-}" "${STEP_LOG:-}"' EXIT
  snapshot_shell_startup "$STEP_SNAPSHOT"

  for step in install_node install_rust install_agave install_anchor install_surfpool; do
    "$step"
    inspect_step_startup_diffs "$step" "$STEP_SNAPSHOT" "$STEP_LOG"
  done

  local after_capture
  after_capture=$(capture_versions "after-install")
  inspect_shell_startup_diffs "$backup_dir" "$after_capture" "$STEP_LOG"
  echo "Captured post-install versions to $after_capture"
  verify_versions
}

main_install
