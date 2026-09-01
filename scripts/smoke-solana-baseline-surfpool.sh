#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
cd "$ROOT_DIR"
# shellcheck source=lib/solana-baseline-version-match.sh
. "$SCRIPT_DIR/lib/solana-baseline-version-match.sh"

PINS="$("$SCRIPT_DIR/solana-baseline-toolchain.sh" print-pins)"
pin_value() { awk -F'[= ]' -v key="$1" '$0 ~ "^" key "=" { print $2; exit }' <<<"$PINS"; }
SURFPOOL_VERSION="$(pin_value surfpool)"
AGAVE_VERSION="$(pin_value agave)"
[ -n "$SURFPOOL_VERSION" ] && [ -n "$AGAVE_VERSION" ] || {
  echo "could not resolve surfpool/agave pins from solana-baseline-toolchain.sh print-pins" >&2
  exit 1
}

SOLANA_INSTALL_DIR="${RAP_BASELINE_SOLANA_INSTALL_DIR:-$HOME/.local/share/solana/reddi-agent-protocol-baseline/install}"
SURFPOOL_ROOT="${RAP_BASELINE_SURFPOOL_ROOT:-$HOME/.local/share/surfpool/releases}"
export PATH="$HOME/.cargo/bin:$SOLANA_INSTALL_DIR/active_release/bin:$SURFPOOL_ROOT/$SURFPOOL_VERSION/bin:$PATH"

for cmd in surfpool solana python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "missing required command: $cmd" >&2; exit 1; }
done

assert_pinned() {
  local description=$1 expected=$2 output=$3
  if ! version_token_match "$output" "$expected"; then
    echo "$description is not the pinned baseline build: expected '$expected' but got '$output' (from $(command -v "${description}"))" >&2
    exit 1
  fi
}

SURFPOOL_VERSION_OUTPUT="$(surfpool --version 2>&1)"
SOLANA_VERSION_OUTPUT="$(solana --version 2>&1)"
assert_pinned surfpool "surfpool ${SURFPOOL_VERSION#v}" "$SURFPOOL_VERSION_OUTPUT"
assert_pinned solana "solana-cli ${AGAVE_VERSION#v}" "$SOLANA_VERSION_OUTPUT"

read -r PORT WS_PORT < <(python3 - <<'PY'
import socket
ports = []
sockets = []
try:
    for _ in range(2):
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        sockets.append(s)
        ports.append(s.getsockname()[1])
    print(*ports)
finally:
    for s in sockets:
        s.close()
PY
)

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$ROOT_DIR/artifacts/toolchain/surfpool-smoke-$STAMP"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/surfpool.log"
RPC_URL="http://127.0.0.1:$PORT"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      kill -0 "$PID" >/dev/null 2>&1 || return 0
      sleep 0.1
    done
    kill -9 "$PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

surfpool start \
  --ci \
  --offline \
  --no-deploy \
  --airdrop-amount 0 \
  --db ':memory:' \
  --surfnet-id "rap-baseline-$STAMP" \
  --port "$PORT" \
  --ws-port "$WS_PORT" \
  --no-studio \
  --no-tui \
  > "$LOG" 2>&1 &
PID=$!

for _ in {1..40}; do
  if solana cluster-version --url "$RPC_URL" > "$OUT_DIR/cluster-version.txt" 2>&1; then
    {
      echo "surfpool-smoke=ok"
      echo "rpc=$RPC_URL"
      echo "ws=ws://127.0.0.1:$WS_PORT"
      echo "surfpool=$SURFPOOL_VERSION_OUTPUT"
      echo "solana=$SOLANA_VERSION_OUTPUT"
      echo "cluster_version=$(cat "$OUT_DIR/cluster-version.txt")"
      echo "log=$LOG"
    } | tee "$OUT_DIR/summary.txt"
    exit 0
  fi
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    echo "surfpool exited before RPC became ready; see $LOG" >&2
    tail -80 "$LOG" >&2 || true
    exit 1
  fi
  sleep 0.5
done

echo "timed out waiting for Surfpool RPC at $RPC_URL; see $LOG" >&2
tail -80 "$LOG" >&2 || true
exit 1
