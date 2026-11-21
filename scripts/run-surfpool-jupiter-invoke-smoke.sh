#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[surfpool-jupiter-invoke] missing required command: $1" >&2
    exit 1
  fi
}

require_cmd surfpool
require_cmd solana
require_cmd npm
require_cmd node
require_cmd python3
require_cmd "${HOME}/.cargo/bin/cargo"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/artifacts/surfpool-jupiter-invoke/$TS"
LOG_FILE="$OUT_DIR/surfpool-jupiter-invoke.log"
mkdir -p "$OUT_DIR"

PORT="${SURFPOOL_PORT:-18999}"
WS_PORT="${SURFPOOL_WS_PORT:-19000}"
RPC_URL="http://127.0.0.1:${PORT}"
SURFPOOL_LOG="$OUT_DIR/surfpool.log"
SURFPOOL_PID=""

APP_PORT="${JUPITER_INVOKE_APP_PORT:-3220}"
APP_LOG="$OUT_DIR/next-dev.log"
APP_PID=""

SPECIALIST_PORT="${JUPITER_INVOKE_SPECIALIST_PORT:-3991}"
SPECIALIST_LOG="$OUT_DIR/mock-specialist.log"
SPECIALIST_PID=""

JUP_PORT="${JUPITER_INVOKE_JUP_PORT:-3992}"
JUP_LOG="$OUT_DIR/mock-jupiter.log"
JUP_PID=""

IDX_PATH="$ROOT_DIR/data/onboarding/specialist-index.json"
RUNS_PATH="$ROOT_DIR/data/onboarding/planner-runs.json"
POLICY_PATH="$ROOT_DIR/data/orchestrator/policy.json"
SPEND_PATH="$ROOT_DIR/data/orchestrator/spend.json"

BACKUP_DIR="$OUT_DIR/state-backup"
mkdir -p "$BACKUP_DIR"

backup_file() {
  local src="$1"
  local dst="$2"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
  fi
}

restore_file() {
  local dst="$1"
  local src="$2"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
  else
    rm -f "$dst"
  fi
}

cleanup() {
  restore_file "$IDX_PATH" "$BACKUP_DIR/specialist-index.json"
  restore_file "$RUNS_PATH" "$BACKUP_DIR/planner-runs.json"
  restore_file "$POLICY_PATH" "$BACKUP_DIR/policy.json"
  restore_file "$SPEND_PATH" "$BACKUP_DIR/spend.json"

  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$SPECIALIST_PID" ] && kill -0 "$SPECIALIST_PID" >/dev/null 2>&1; then
    kill "$SPECIALIST_PID" >/dev/null 2>&1 || true
    wait "$SPECIALIST_PID" 2>/dev/null || true
  fi
  if [ -n "$JUP_PID" ] && kill -0 "$JUP_PID" >/dev/null 2>&1; then
    kill "$JUP_PID" >/dev/null 2>&1 || true
    wait "$JUP_PID" 2>/dev/null || true
  fi
  if [ -n "$SURFPOOL_PID" ] && kill -0 "$SURFPOOL_PID" >/dev/null 2>&1; then
    kill "$SURFPOOL_PID" >/dev/null 2>&1 || true
    wait "$SURFPOOL_PID" 2>/dev/null || true
  fi

  local pids
  for p in "$PORT" "$APP_PORT" "$SPECIALIST_PORT" "$JUP_PORT"; do
    pids="$(lsof -tiTCP:${p} -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      kill -9 $pids >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT

run_step() {
  local label="$1"
  shift

  {
    echo ""
    echo "[surfpool-jupiter-invoke] >>> $label"
    "$@"
  } 2>&1 | tee -a "$LOG_FILE"

  local code=${PIPESTATUS[0]}
  if [ "$code" -ne 0 ]; then
    echo "[surfpool-jupiter-invoke] FAIL: $label (code=$code)" | tee -a "$LOG_FILE"
    exit "$code"
  fi
}

backup_file "$IDX_PATH" "$BACKUP_DIR/specialist-index.json"
backup_file "$RUNS_PATH" "$BACKUP_DIR/planner-runs.json"
backup_file "$POLICY_PATH" "$BACKUP_DIR/policy.json"
backup_file "$SPEND_PATH" "$BACKUP_DIR/spend.json"

{
  echo "[surfpool-jupiter-invoke] starting jupiter invoke lane"
  echo "[surfpool-jupiter-invoke] output: $OUT_DIR"
  echo "[surfpool-jupiter-invoke] rpc: $RPC_URL"
} | tee "$LOG_FILE"

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
    echo "[surfpool-jupiter-invoke] Surfpool RPC did not become ready" | tee -a "$LOG_FILE"
    exit 1
  fi
done

run_step "Build + deploy escrow" bash -lc "
  set -euo pipefail
  ~/.cargo/bin/cargo build-sbf --manifest-path archive/anchor-escrow/Cargo.toml --sbf-out-dir target/deploy | tee '${OUT_DIR}/01-build.log'
  solana airdrop 10 --url '${RPC_URL}' d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR | tee '${OUT_DIR}/02-upgrade-airdrop.log'
  solana program deploy target/deploy/escrow.so \
    --program-id target/deploy/escrow-keypair.json \
    --url '${RPC_URL}' \
    --keypair ~/.config/solana/blitz-dev.json \
    | tee '${OUT_DIR}/03-deploy.log'
"

PROGRAM_ID="$(solana address -k target/deploy/escrow-keypair.json)"

TARGET_WALLET="$(python3 - <<'PY'
from pathlib import Path
text = Path('packages/demo-agents/.env.devnet').read_text()
for line in text.splitlines():
    if line.startswith('AGENT_B_PUBKEY='):
        print(line.split('=', 1)[1].strip())
        break
else:
    raise SystemExit('AGENT_B_PUBKEY missing in packages/demo-agents/.env.devnet')
PY
)"

CONSUMER_WALLET="$(python3 - <<'PY'
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

run_step "Seed planner policy + specialist index for invoke lane" python3 - <<PY
import json
from datetime import datetime, timezone
from pathlib import Path

idx_path = Path(r"${IDX_PATH}")
runs_path = Path(r"${RUNS_PATH}")
policy_path = Path(r"${POLICY_PATH}")
spend_path = Path(r"${SPEND_PATH}")

target_wallet = "${TARGET_WALLET}"
specialist_port = ${SPECIALIST_PORT}

idx_path.parent.mkdir(parents=True, exist_ok=True)
policy_path.parent.mkdir(parents=True, exist_ok=True)

now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

index_payload = [
    {
        "walletAddress": target_wallet,
        "updatedAt": now,
        "endpointUrl": f"http://127.0.0.1:{specialist_port}",
        "healthcheckStatus": "pass",
        "attested": True,
        "capabilities": {
            "taskTypes": ["summarize"],
            "inputModes": ["text"],
            "outputModes": ["text"],
            "privacyModes": ["public", "per"],
            "pricing": {"baseUsd": 0, "perCallUsd": 0.01},
            "tags": ["surfpool", "jupiter", "invoke"],
            "context_requirements": [],
            "runtime_capabilities": [],
        },
        "routingSignals": {
            "feedbackCount": 0,
            "avgFeedbackScore": 0,
            "attestationAgreements": 0,
            "attestationDisagreements": 0,
        },
        "ranking_score": 1.0,
        "reputation_score": 5,
    }
]

policy_payload = {
    "enabled": True,
    "maxPerTaskUsd": 1,
    "dailyBudgetUsd": 10,
    "allowedTaskTypes": [],
    "minReputation": 0,
    "requireAttestation": False,
    "preferredPrivacyMode": "public",
    "fallbackMode": "skip",
    "updatedAt": now,
}

idx_path.write_text(json.dumps(index_payload, indent=2))
policy_path.write_text(json.dumps(policy_payload, indent=2))
spend_path.write_text(json.dumps([], indent=2))
runs_path.write_text(json.dumps([], indent=2))

print("seeded", idx_path)
print("seeded", policy_path)
PY

cp "$IDX_PATH" "$OUT_DIR/seed-specialist-index.json"
cp "$POLICY_PATH" "$OUT_DIR/seed-policy.json"

run_step "Start mock specialist (x402 challenge + receipt validation)" bash -lc "
  SPECIALIST_PORT='${SPECIALIST_PORT}' \
  TARGET_WALLET='${TARGET_WALLET}' \
  node <<'NODE' > '${SPECIALIST_LOG}' 2>&1 &
const http = require('http');
const port = Number(process.env.SPECIALIST_PORT || 3991);
const targetWallet = process.env.TARGET_WALLET;

const challenge = {
  amount: 1000,
  currency: 'USDC',
  paymentAddress: targetWallet,
  nonce: 'jupiter-lane-nonce-001',
  payerCurrency: 'SOL',
  autoSwap: true,
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const payment = req.headers['x402-payment'];
  if (!payment) {
    res.writeHead(402, {
      'content-type': 'application/json',
      'x402-request': JSON.stringify(challenge),
    });
    res.end(JSON.stringify({ error: 'payment_required' }));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(String(payment));
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_x402_payment' }));
    return;
  }

  if (parsed?.swap?.performed !== true) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'swap_not_performed', receipt: parsed }));
    return;
  }

  const body = {
    id: 'chatcmpl-surfpool-jupiter',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Summary: momentum remains positive, swap order ' + parsed.swap.orderId,
        },
        finish_reason: 'stop',
      },
    ],
    swapConfirmed: true,
    swapOrderId: parsed.swap.orderId,
    swapExecuteId: parsed.swap.executeId,
  };

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});

server.listen(port, '127.0.0.1', () => {
  console.log('[mock-specialist] listening on', port);
});
NODE
  echo \$! > '${OUT_DIR}/specialist.pid'
"
SPECIALIST_PID="$(cat "$OUT_DIR/specialist.pid")"

run_step "Start mock Jupiter API" bash -lc "
  JUP_PORT='${JUP_PORT}' node <<'NODE' > '${JUP_LOG}' 2>&1 &
const http = require('http');
const port = Number(process.env.JUP_PORT || 3992);

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  const body = JSON.parse(raw);

  if (req.url === '/swap/v2/order') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      orderId: 'ord_surfpool_jupiter_001',
      inAmount: String(body.amount || '1000'),
      outAmount: '995',
    }));
    return;
  }

  if (req.url === '/swap/v2/execute') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      executeId: 'exec_surfpool_jupiter_001',
      outAmount: '995',
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log('[mock-jupiter] listening on', port);
});
NODE
  echo \$! > '${OUT_DIR}/jupiter.pid'
"
JUP_PID="$(cat "$OUT_DIR/jupiter.pid")"

for i in {1..40}; do
  if curl -fsS "http://127.0.0.1:${SPECIALIST_PORT}/healthz" >/dev/null 2>&1 && \
     curl -fsS "http://127.0.0.1:${JUP_PORT}/swap/v2/order" -X POST -H 'content-type: application/json' -d '{}' >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
  if [ "$i" -eq 40 ]; then
    echo "[surfpool-jupiter-invoke] mock servers did not become ready" | tee -a "$LOG_FILE"
    exit 1
  fi
done

run_step "Start Next.js API host" bash -lc "
  NEXT_PUBLIC_RPC_ENDPOINT='${RPC_URL}' \
  NEXT_PUBLIC_ESCROW_PROGRAM_ID='${PROGRAM_ID}' \
  ONBOARDING_SPECIALIST_INDEX_PATH='${IDX_PATH}' \
  ONBOARDING_PLANNER_RUNS_PATH='${RUNS_PATH}' \
  ORCHESTRATOR_POLICY_PATH='${POLICY_PATH}' \
  ORCHESTRATOR_SPEND_PATH='${SPEND_PATH}' \
  JUPITER_API_KEY='test-key' \
  JUPITER_API_BASE='http://127.0.0.1:${JUP_PORT}/swap/v2' \
  JUPITER_SLIPPAGE_BPS='75' \
  PORT='${APP_PORT}' \
  npm run dev > '${APP_LOG}' 2>&1 &
  echo \$! > '${OUT_DIR}/next.pid'
"
APP_PID="$(cat "$OUT_DIR/next.pid")"

for i in {1..90}; do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/planner/tools/invoke" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
  if [ "$i" -eq 90 ]; then
    echo "[surfpool-jupiter-invoke] Next.js API host did not become ready" | tee -a "$LOG_FILE"
    exit 1
  fi
done

run_step "Execute planner invoke with Jupiter auto-swap path" bash -lc "
  set -euo pipefail
  APP_BASE='http://127.0.0.1:${APP_PORT}' \
  TARGET_WALLET='${TARGET_WALLET}' \
  CONSUMER_WALLET='${CONSUMER_WALLET}' \
  ORCHESTRATOR_POLICY_PATH='${POLICY_PATH}' \
  PLANNER_RUNS_PATH='${RUNS_PATH}' \
  JUPITER_INVOKE_RESULT_PATH='${OUT_DIR}/jupiter-invoke-result.json' \
  node ./scripts/surfpool-jupiter-invoke-runner.mjs | tee '${OUT_DIR}/06-jupiter-invoke.json'
"

{
  echo "# Surfpool Jupiter Invoke Summary"
  echo ""
  echo "- Timestamp: $TS"
  echo "- RPC: $RPC_URL"
  echo "- Program ID: ${PROGRAM_ID}"
  echo "- App base: http://127.0.0.1:${APP_PORT}"
  echo "- Specialist endpoint: http://127.0.0.1:${SPECIALIST_PORT}"
  echo "- Jupiter mock API base: http://127.0.0.1:${JUP_PORT}/swap/v2"
  echo "- Scenario: planner invoke route executed x402 challenge with SOL->USDC auto-swap path ✅"
  echo ""
  echo "## Artifacts"
  echo "- Main log: $LOG_FILE"
  echo "- Surfpool log: $SURFPOOL_LOG"
  echo "- Next dev log: $APP_LOG"
  echo "- Specialist log: $SPECIALIST_LOG"
  echo "- Jupiter log: $JUP_LOG"
  echo "- Invoke result: $OUT_DIR/jupiter-invoke-result.json"
  echo "- Invoke stdout: $OUT_DIR/06-jupiter-invoke.json"
} > "$OUT_DIR/SUMMARY.md"

echo "[surfpool-jupiter-invoke] complete: $OUT_DIR/SUMMARY.md" | tee -a "$LOG_FILE"
