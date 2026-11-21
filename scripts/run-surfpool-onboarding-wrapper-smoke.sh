#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[surfpool-onboarding-wrapper] missing required command: $1" >&2
    exit 1
  fi
}

require_cmd surfpool
require_cmd solana
require_cmd npm
require_cmd node
require_cmd python3
require_cmd openssl
require_cmd "${HOME}/.cargo/bin/cargo"

PROGRAM_KEYPAIR="target/deploy/escrow-keypair.json"
PROGRAM_SOURCE="archive/anchor-escrow/src/lib.rs"

declared_program_id() {
  python3 - <<'PY'
import re
from pathlib import Path
text = Path('archive/anchor-escrow/src/lib.rs').read_text()
m = re.search(r'declare_id!\("([^"]+)"\)', text)
if not m:
    raise SystemExit('declare_id! not found in archive/anchor-escrow/src/lib.rs')
print(m.group(1))
PY
}

assert_program_id_alignment() {
  local declared keypair
  declared="$(declared_program_id)"
  keypair="$(solana address -k "$PROGRAM_KEYPAIR")"
  if [ "$declared" != "$keypair" ]; then
    echo "[surfpool-onboarding-wrapper] program-id preflight failed" >&2
    echo "[surfpool-onboarding-wrapper] declare_id in $PROGRAM_SOURCE: $declared" >&2
    echo "[surfpool-onboarding-wrapper] keypair address in $PROGRAM_KEYPAIR: $keypair" >&2
    echo "[surfpool-onboarding-wrapper] Fix by restoring a matching escrow keypair or updating declare_id + dependent env/docs in a coordinated change." >&2
    exit 1
  fi
}

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/artifacts/surfpool-onboarding-wrapper/$TS"
LOG_FILE="$OUT_DIR/surfpool-onboarding-wrapper.log"
mkdir -p "$OUT_DIR"

PORT="${SURFPOOL_PORT:-18999}"
WS_PORT="${SURFPOOL_WS_PORT:-19000}"
RPC_URL="http://127.0.0.1:${PORT}"
SURFPOOL_LOG="$OUT_DIR/surfpool.log"
SURFPOOL_PID=""

APP_PORT="${ONBOARDING_WRAPPER_APP_PORT:-3210}"
APP_LOG="$OUT_DIR/next-dev.log"
APP_PID=""

MOCK_PORT="${ONBOARDING_WRAPPER_MOCK_PORT:-3899}"
MOCK_LOG="$OUT_DIR/mock-specialist.log"
MOCK_PID=""

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" 2>/dev/null || true
  fi

  if [ -n "$MOCK_PID" ] && kill -0 "$MOCK_PID" >/dev/null 2>&1; then
    kill "$MOCK_PID" >/dev/null 2>&1 || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi

  if [ -n "$SURFPOOL_PID" ] && kill -0 "$SURFPOOL_PID" >/dev/null 2>&1; then
    kill "$SURFPOOL_PID" >/dev/null 2>&1 || true
    wait "$SURFPOOL_PID" 2>/dev/null || true
  fi

  local pids
  pids="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill -9 $pids >/dev/null 2>&1 || true
  fi

  pids="$(lsof -tiTCP:${APP_PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill -9 $pids >/dev/null 2>&1 || true
  fi

  pids="$(lsof -tiTCP:${MOCK_PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill -9 $pids >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_step() {
  local label="$1"
  shift

  {
    echo ""
    echo "[surfpool-onboarding-wrapper] >>> $label"
    "$@"
  } 2>&1 | tee -a "$LOG_FILE"

  local code=${PIPESTATUS[0]}
  if [ "$code" -ne 0 ]; then
    echo "[surfpool-onboarding-wrapper] FAIL: $label (code=$code)" | tee -a "$LOG_FILE"
    exit "$code"
  fi
}

{
  echo "[surfpool-onboarding-wrapper] starting onboarding wrapper lane"
  echo "[surfpool-onboarding-wrapper] output: $OUT_DIR"
  echo "[surfpool-onboarding-wrapper] rpc: $RPC_URL"
} | tee "$LOG_FILE"

assert_program_id_alignment

run_step "Start Surfpool" bash -lc "
  surfpool start --ci --legacy-anchor-compatibility -y --offline \
    --port ${PORT} --ws-port ${WS_PORT} --no-studio --no-tui --log-level info \
    > '${SURFPOOL_LOG}' 2>&1 &
  echo \$! > '${OUT_DIR}/surfpool.pid'
"
SURFPOOL_PID="$(cat "$OUT_DIR/surfpool.pid")"

for i in {1..40}; do
  if solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
  if [ "$i" -eq 40 ]; then
    echo "[surfpool-onboarding-wrapper] Surfpool RPC did not become ready" | tee -a "$LOG_FILE"
    exit 1
  fi
done

run_step "Build + deploy escrow" bash -lc "
  set -euo pipefail
  ~/.cargo/bin/cargo build-sbf --manifest-path archive/anchor-escrow/Cargo.toml --sbf-out-dir target/deploy | tee '${OUT_DIR}/01-build.log'
  solana airdrop 10 --url '${RPC_URL}' d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR | tee '${OUT_DIR}/02-upgrade-airdrop.log'
  solana program deploy target/deploy/escrow.so \
    --program-id "$PROGRAM_KEYPAIR" \
    --url '${RPC_URL}' \
    --keypair ~/.config/solana/blitz-dev.json \
    | tee '${OUT_DIR}/03-deploy.log'
"

PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"

run_step "Fund + register agents on Surfpool" bash -lc "
  set -euo pipefail
  cd packages/demo-agents
  DEMO_DEVNET_RPC='${RPC_URL}' DEMO_ESCROW_PROGRAM_ID='${PROGRAM_ID}' npm run fund | tee '${OUT_DIR}/04-fund.log'
  DEMO_DEVNET_RPC='${RPC_URL}' DEMO_ESCROW_PROGRAM_ID='${PROGRAM_ID}' npm run register | tee '${OUT_DIR}/05-register.log'
"

run_step "Start mock specialist endpoint" bash -lc "
  set -euo pipefail
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout '${OUT_DIR}/mock-key.pem' \
    -out '${OUT_DIR}/mock-cert.pem' \
    -days 1 \
    -subj '/CN=127.0.0.1' >/dev/null 2>&1

  MOCK_PORT='${MOCK_PORT}' \
  MOCK_CERT='${OUT_DIR}/mock-cert.pem' \
  MOCK_KEY='${OUT_DIR}/mock-key.pem' \
  node <<'NODE' > '${MOCK_LOG}' 2>&1 &
const fs = require('fs');
const https = require('https');

const port = Number(process.env.MOCK_PORT || 3899);
const cert = fs.readFileSync(process.env.MOCK_CERT);
const key = fs.readFileSync(process.env.MOCK_KEY);

const server = https.createServer({ cert, key }, (req, res) => {
  if (req.url === '/api/tags') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
    return;
  }
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === '/v1/models') {
    res.writeHead(402, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'payment_required' }));
    return;
  }
  if (req.url === '/v1/chat/completions') {
    res.writeHead(402, {
      'content-type': 'application/json',
      'x402-request': JSON.stringify({
        chain: 'solana-devnet',
        asset: 'SOL',
        amount: 1000000,
        memo: 'reddi-specialist-test-call',
      }),
    });
    res.end(JSON.stringify({ error: 'payment_required' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(port, '127.0.0.1', () => {
  console.log('[mock-specialist] https listening on', port);
});
NODE
  echo \$! > '${OUT_DIR}/mock.pid'
"
MOCK_PID="$(cat "$OUT_DIR/mock.pid")"

for i in {1..30}; do
  if curl -kfsS "https://127.0.0.1:${MOCK_PORT}/api/tags" >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
  if [ "$i" -eq 30 ]; then
    echo "[surfpool-onboarding-wrapper] mock specialist endpoint did not become ready" | tee -a "$LOG_FILE"
    exit 1
  fi
done

OPERATOR_SECRET_KEY="$(python3 - <<'PY'
from pathlib import Path
text = Path('packages/demo-agents/.env.devnet').read_text()
for line in text.splitlines():
    if line.startswith('AGENT_C_KEYPAIR='):
        print(line.split('=', 1)[1].strip())
        break
else:
    raise SystemExit('AGENT_C_KEYPAIR missing in packages/demo-agents/.env.devnet')
PY
)"

CONSUMER_PUBKEY="$(python3 - <<'PY'
from pathlib import Path
text = Path('packages/demo-agents/.env.devnet').read_text()
for line in text.splitlines():
    if line.startswith('AGENT_A_PUBKEY='):
        print(line.split('=', 1)[1].strip())
        break
else:
    raise SystemExit('AGENT_A_PUBKEY missing in packages/demo-agents/.env.devnet')
PY
)"

run_step "Start Next.js API host" bash -lc "
  ONBOARDING_ATTEST_OPERATOR_SECRET_KEY='${OPERATOR_SECRET_KEY}' \
  NEXT_PUBLIC_RPC_ENDPOINT='${RPC_URL}' \
  NEXT_PUBLIC_ESCROW_PROGRAM_ID='${PROGRAM_ID}' \
  NODE_TLS_REJECT_UNAUTHORIZED='0' \
  PORT='${APP_PORT}' \
  npm run dev > '${APP_LOG}' 2>&1 &
  echo \$! > '${OUT_DIR}/next.pid'
"
APP_PID="$(cat "$OUT_DIR/next.pid")"

for i in {1..80}; do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/onboarding/operator-key" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
  if [ "$i" -eq 80 ]; then
    echo "[surfpool-onboarding-wrapper] Next.js API host did not become ready" | tee -a "$LOG_FILE"
    exit 1
  fi
done

run_step "Execute onboarding wrapper flow via API routes" bash -lc "
  set -euo pipefail
  APP_BASE='http://127.0.0.1:${APP_PORT}' \
  ENDPOINT_URL='https://127.0.0.1:${MOCK_PORT}' \
  CONSUMER_PUBKEY='${CONSUMER_PUBKEY}' \
  WRAPPER_FLOW_RESULT_PATH='${OUT_DIR}/wrapper-flow-result.json' \
  node ./scripts/surfpool-onboarding-wrapper-runner.mjs | tee '${OUT_DIR}/06-wrapper-flow.json'
"

{
  echo "# Surfpool Onboarding Wrapper Summary"
  echo ""
  echo "- Timestamp: $TS"
  echo "- RPC: $RPC_URL"
  echo "- App base: http://127.0.0.1:${APP_PORT}"
  echo "- Mock endpoint: https://127.0.0.1:${MOCK_PORT}"
  echo "- Program ID: ${PROGRAM_ID}"
  echo "- Scenario: onboarding wrapper flow via API routes (runtime -> endpoint -> wallet -> healthcheck -> attestation) on Surfpool ✅"
  echo ""
  echo "## Artifacts"
  echo "- Main log: $LOG_FILE"
  echo "- Surfpool log: $SURFPOOL_LOG"
  echo "- Next dev log: $APP_LOG"
  echo "- Mock specialist log: $MOCK_LOG"
  echo "- Wrapper flow result: $OUT_DIR/wrapper-flow-result.json"
  echo "- Wrapper flow stdout: $OUT_DIR/06-wrapper-flow.json"
} > "$OUT_DIR/SUMMARY.md"

echo "[surfpool-onboarding-wrapper] complete: $OUT_DIR/SUMMARY.md" | tee -a "$LOG_FILE"
