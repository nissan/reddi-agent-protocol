#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT_DIR"

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/share/surfpool/releases/v1.5.0/bin:$PATH"

for cmd in surfpool solana python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "missing required command: $cmd" >&2; exit 1; }
done

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
      echo "surfpool=$(surfpool --version)"
      echo "solana=$(solana --version)"
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
