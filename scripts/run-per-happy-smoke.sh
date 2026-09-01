#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[per-happy] missing required command: $1" >&2
    exit 1
  fi
}

require_cmd npm
require_cmd node
require_cmd python3

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/artifacts/per-happy/$TS"
LOG_FILE="$OUT_DIR/per-happy.log"
mkdir -p "$OUT_DIR"

PROFILE="${NETWORK_PROFILE:-devnet}"
if [ "$PROFILE" = "local-surfpool" ] || [ "$PROFILE" = "local" ] || [ "$PROFILE" = "localnet" ]; then
  echo "[per-happy] NETWORK_PROFILE=$PROFILE is not valid for PER happy-path validation." | tee "$LOG_FILE"
  echo "[per-happy] use the devnet profile with a reachable TEE endpoint." | tee -a "$LOG_FILE"
  exit 1
fi
if [ "$PROFILE" = "mainnet" ] || [ "$PROFILE" = "mainnet-beta" ]; then
  echo "[per-happy] NETWORK_PROFILE=$PROFILE is refused: packages/demo-agents is a devnet/local evidence runner only." | tee "$LOG_FILE"
  echo "[per-happy] mainnet execution requires a separate audited deployment, custody plan, and explicit approval." | tee -a "$LOG_FILE"
  exit 1
fi

PER_RPC="${NEXT_PUBLIC_PER_RPC:-${DEMO_PER_RPC:-https://devnet-tee.magicblock.app}}"
RPC_URL="${NEXT_PUBLIC_RPC_ENDPOINT:-https://api.devnet.solana.com}"
PER_RPC_AUTH="$PER_RPC"

run_step() {
  local label="$1"
  shift
  {
    echo ""
    echo "[per-happy] >>> $label"
    "$@"
  } 2>&1 | tee -a "$LOG_FILE"

  local code=${PIPESTATUS[0]}
  if [ "$code" -ne 0 ]; then
    echo "[per-happy] FAIL: $label (code=$code)" | tee -a "$LOG_FILE"
    return "$code"
  fi
  return 0
}

{
  echo "[per-happy] starting PER happy-path lane"
  echo "[per-happy] output: $OUT_DIR"
  echo "[per-happy] network_profile: $PROFILE"
  echo "[per-happy] rpc: $RPC_URL"
  echo "[per-happy] per_rpc: $PER_RPC"
} | tee "$LOG_FILE"

if [ "$PROFILE" = "devnet" ] && [[ "$PER_RPC" == https://devnet-tee.magicblock.app* ]]; then
  echo "[per-happy] generating MagicBlock TEE auth token (token redacted)" | tee -a "$LOG_FILE"
  AUTH_JSON="$OUT_DIR/00-tee-auth.json"
  PER_RPC_AUTH="$(node - <<NODE
const path = require("path");
const dotenv = require("dotenv");
const { Keypair } = require("@solana/web3.js");
const nacl = require("./packages/per-client/node_modules/tweetnacl");
const { getAuthToken } = require("./packages/per-client/node_modules/@magicblock-labs/ephemeral-rollups-sdk");
dotenv.config({ path: path.resolve("packages/demo-agents/.env.devnet"), quiet: true });
(async () => {
  const raw = process.env.AGENT_A_KEYPAIR;
  if (!raw) throw new Error("AGENT_A_KEYPAIR missing from packages/demo-agents/.env.devnet");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const auth = await getAuthToken("$PER_RPC", kp.publicKey, (message) =>
    Promise.resolve(nacl.sign.detached(message, kp.secretKey))
  );
  require("fs").writeFileSync("$AUTH_JSON", JSON.stringify({
    endpoint: "$PER_RPC",
    wallet: kp.publicKey.toBase58(),
    tokenLength: auth.token.length,
    expiresAt: auth.expiresAt,
    tokenRedacted: true
  }, null, 2));
  process.stdout.write("$PER_RPC" + "?token=" + encodeURIComponent(auth.token));
})().catch((e) => { console.error(e); process.exit(1); });
NODE
)"
fi

run_step "Fund + register agents" bash -lc "
  cd packages/demo-agents
  NETWORK_PROFILE='${PROFILE}' \
  NEXT_PUBLIC_RPC_ENDPOINT='${RPC_URL}' \
  NEXT_PUBLIC_PER_RPC='${PER_RPC}' \
  npm run fund | tee '${OUT_DIR}/01-fund.log'

  NETWORK_PROFILE='${PROFILE}' \
  NEXT_PUBLIC_RPC_ENDPOINT='${RPC_URL}' \
  NEXT_PUBLIC_PER_RPC='${PER_RPC}' \
  npm run register | tee '${OUT_DIR}/02-register.log'
"

set +e
cd "$ROOT_DIR/packages/demo-agents"
NETWORK_PROFILE="$PROFILE" \
NEXT_PUBLIC_RPC_ENDPOINT="$RPC_URL" \
NEXT_PUBLIC_PER_RPC="$PER_RPC_AUTH" \
DEMO_SETTLEMENT_MODE=magicblock_per \
DEMO_ALLOW_FALLBACK=false \
DEMO_STOP_AFTER_SETTLEMENT=true \
npm run demo > "$OUT_DIR/03-demo.log" 2>&1
DEMO_CODE=$?
cd "$ROOT_DIR"
set -e

FAIL_CLASS=""
if [ "$DEMO_CODE" -ne 0 ]; then
  FAIL_CLASS="$(python3 - <<PY
from pathlib import Path
text = Path(r"$OUT_DIR/03-demo.log").read_text(errors="ignore").lower()
if "per settlement failed and fallback disabled" in text:
    print("per_unavailable_or_rejected")
elif "429" in text or "airdrop" in text and "rate" in text:
    print("rate_limited")
elif "blockhash not found" in text:
    print("stale_blockhash")
else:
    print("unknown")
PY
)"
fi

PER_SENT="no"
if grep -q "PER settlement submitted" "$OUT_DIR/03-demo.log"; then
  PER_SENT="yes"
fi
FALLBACK_USED="no"
if grep -q "L1 fallback used" "$OUT_DIR/03-demo.log"; then
  FALLBACK_USED="yes"
fi

PER_SIG=""
if [ "$PER_SENT" = "yes" ]; then
  PER_SIG="$(python3 - <<PY
import re
from pathlib import Path
text = Path(r"$OUT_DIR/03-demo.log").read_text(errors="ignore")
m = re.search(r"PER settlement submitted: ([1-9A-HJ-NP-Za-km-z]{32,120})", text)
print(m.group(1) if m else "")
PY
)"
fi

TEE_STATUS="not_checked"
TEE_ERR=""
PUBLIC_STATUS="not_checked"
if [ -n "$PER_SIG" ]; then
  node - <<NODE > "$OUT_DIR/04-tee-status.json" 2>&1
const { Connection } = require("@solana/web3.js");
const sig = "$PER_SIG";
(async () => {
  const out = { signature: sig, perEndpoint: "$PER_RPC", publicEndpoint: "$RPC_URL" };
  for (const [name, url] of [["tee", "$PER_RPC_AUTH"], ["public", "$RPC_URL"]]) {
    try {
      const c = new Connection(url, "confirmed");
      out[name] = await c.getSignatureStatus(sig, { searchTransactionHistory: true });
    } catch (e) {
      out[name] = { error: e.message };
    }
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
NODE
  TEE_STATUS="$(python3 - <<PY
import json
from pathlib import Path
data=json.loads(Path(r"$OUT_DIR/04-tee-status.json").read_text())
value=(data.get("tee") or {}).get("value")
if not value:
    print("missing")
elif value.get("err") is None:
    print(value.get("confirmationStatus") or "ok")
else:
    print("err")
PY
)"
  TEE_ERR="$(python3 - <<PY
import json
from pathlib import Path
data=json.loads(Path(r"$OUT_DIR/04-tee-status.json").read_text())
value=(data.get("tee") or {}).get("value") or {}
print(value.get("err") or "")
PY
)"
  PUBLIC_STATUS="$(python3 - <<PY
import json
from pathlib import Path
data=json.loads(Path(r"$OUT_DIR/04-tee-status.json").read_text())
print("visible" if (data.get("public") or {}).get("value") else "not_visible")
PY
)"
fi

RESULT_LINE="❌ FAIL"
if [ "$DEMO_CODE" -eq 0 ] && [ "$PER_SENT" = "yes" ] && [ "$FALLBACK_USED" = "no" ] && [ "$TEE_STATUS" != "err" ] && [ "$TEE_STATUS" != "missing" ]; then
  RESULT_LINE="✅ PASS"
fi

{
  echo "# PER Happy-Path Lane Summary"
  echo ""
  echo "- Timestamp: $TS"
  echo "- Network profile: $PROFILE"
  echo "- RPC: $RPC_URL"
  echo "- PER RPC: $PER_RPC"
  echo "- Result: $RESULT_LINE"
  echo "- PER submitted: $PER_SENT"
  if [ -n "$PER_SIG" ]; then echo "- PER signature: $PER_SIG"; fi
  echo "- TEE status: $TEE_STATUS"
  if [ -n "$TEE_ERR" ]; then echo "- TEE error: $TEE_ERR"; fi
  echo "- Public RPC visibility: $PUBLIC_STATUS"
  echo "- Fallback used: $FALLBACK_USED"
  if [ "$DEMO_CODE" -ne 0 ]; then
    echo "- Failure class: ${FAIL_CLASS}"
  fi
  echo ""
  echo "## Artifacts"
  echo "- Main log: $LOG_FILE"
  echo "- Fund log: $OUT_DIR/01-fund.log"
  echo "- Register log: $OUT_DIR/02-register.log"
  echo "- Demo log: $OUT_DIR/03-demo.log"
  if [ -f "$OUT_DIR/00-tee-auth.json" ]; then echo "- TEE auth metadata: $OUT_DIR/00-tee-auth.json"; fi
  if [ -f "$OUT_DIR/04-tee-status.json" ]; then echo "- TEE/public status: $OUT_DIR/04-tee-status.json"; fi
} > "$OUT_DIR/SUMMARY.md"

if [ "$RESULT_LINE" != "✅ PASS" ]; then
  echo "[per-happy] incomplete: class=${FAIL_CLASS:-none} artifacts=$OUT_DIR" | tee -a "$LOG_FILE"
  exit 1
fi

echo "[per-happy] complete: $OUT_DIR/SUMMARY.md" | tee -a "$LOG_FILE"
