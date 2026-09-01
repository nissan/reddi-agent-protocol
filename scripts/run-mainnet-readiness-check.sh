#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/artifacts/mainnet-readiness/$TS"
mkdir -p "$OUT_DIR"
LOG_FILE="$OUT_DIR/mainnet-readiness.log"
JSON_OUT="$OUT_DIR/result.json"
SUMMARY_OUT="$OUT_DIR/SUMMARY.md"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[mainnet-readiness] missing required command: $1" | tee -a "$LOG_FILE"
    exit 1
  fi
}

require_cmd curl
require_cmd python3

read_profile_value() {
  local py="$1"
  python3 - <<PY
import json
from pathlib import Path
p=Path("$ROOT_DIR/config/networks/mainnet.json")
obj=json.loads(p.read_text())
print($py)
PY
}

DEFAULT_RPC="$(read_profile_value 'obj["solana"]["rpcHttp"]')"
DEFAULT_ESCROW_PROGRAM_ID="$(read_profile_value 'obj["programs"].get("escrowProgramId", "")')"
DEFAULT_REGISTRY_PROGRAM_ID="$(read_profile_value 'obj["programs"].get("registryProgramId", "")')"
DEFAULT_REPUTATION_PROGRAM_ID="$(read_profile_value 'obj["programs"].get("reputationProgramId", "")')"
DEFAULT_ATTESTATION_PROGRAM_ID="$(read_profile_value 'obj["programs"].get("attestationProgramId", "")')"
PLACEHOLDER_ESCROW_PROGRAM_ID="$(read_profile_value 'obj["programs"].get("escrowProgramId", "") if obj["programs"].get("deploymentStatus") == "not_deployed" or obj["programs"].get("escrowProgramIdNote") else ""')"
DEFAULT_PER_RPC="$(read_profile_value 'obj["payments"]["perRpc"]')"
DEFAULT_JUPITER_BASE="$(read_profile_value 'obj["payments"]["jupiterApiBase"]')"

RPC_URL="${NEXT_PUBLIC_RPC_ENDPOINT:-$DEFAULT_RPC}"
ESCROW_PROGRAM_ID="${NEXT_PUBLIC_ESCROW_PROGRAM_ID:-$DEFAULT_ESCROW_PROGRAM_ID}"
REGISTRY_PROGRAM_ID="${NEXT_PUBLIC_REGISTRY_PROGRAM_ID:-$DEFAULT_REGISTRY_PROGRAM_ID}"
REPUTATION_PROGRAM_ID="${NEXT_PUBLIC_REPUTATION_PROGRAM_ID:-$DEFAULT_REPUTATION_PROGRAM_ID}"
ATTESTATION_PROGRAM_ID="${NEXT_PUBLIC_ATTESTATION_PROGRAM_ID:-$DEFAULT_ATTESTATION_PROGRAM_ID}"
PROGRAM_ID="$ESCROW_PROGRAM_ID"
PER_RPC="${NEXT_PUBLIC_PER_RPC:-$DEFAULT_PER_RPC}"
JUPITER_BASE="${JUPITER_API_BASE:-$DEFAULT_JUPITER_BASE}"
NETWORK_PROFILE_EFFECTIVE="${NETWORK_PROFILE:-mainnet}"

{
  echo "[mainnet-readiness] output: $OUT_DIR"
  echo "[mainnet-readiness] network_profile: $NETWORK_PROFILE_EFFECTIVE"
  echo "[mainnet-readiness] rpc: $RPC_URL"
  echo "[mainnet-readiness] escrow_program_id: $ESCROW_PROGRAM_ID"
  echo "[mainnet-readiness] registry_program_id: ${REGISTRY_PROGRAM_ID:-UNSET}"
  echo "[mainnet-readiness] reputation_program_id: ${REPUTATION_PROGRAM_ID:-UNSET}"
  echo "[mainnet-readiness] attestation_program_id: ${ATTESTATION_PROGRAM_ID:-UNSET}"
  echo "[mainnet-readiness] per_rpc: $PER_RPC"
  echo "[mainnet-readiness] jupiter_base: $JUPITER_BASE"
} | tee "$LOG_FILE"

rpc_health_code=""
rpc_health_body=""
rpc_slot_code=""
rpc_slot_body=""
prog_code=""
prog_body=""
per_code=""
jup_code=""
jup_body=""

rpc_health_body="$(curl -sS -w '\n%{http_code}' "$RPC_URL" -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' || true)"
rpc_health_code="$(echo "$rpc_health_body" | tail -n1)"
rpc_health_body="$(echo "$rpc_health_body" | sed '$d')"

rpc_slot_body="$(curl -sS -w '\n%{http_code}' "$RPC_URL" -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' || true)"
rpc_slot_code="$(echo "$rpc_slot_body" | tail -n1)"
rpc_slot_body="$(echo "$rpc_slot_body" | sed '$d')"

prog_body="$(curl -sS -w '\n%{http_code}' "$RPC_URL" -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$PROGRAM_ID\",{\"encoding\":\"jsonParsed\"}]}" || true)"
prog_code="$(echo "$prog_body" | tail -n1)"
prog_body="$(echo "$prog_body" | sed '$d')"

per_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 6 "$PER_RPC" || true)"

jup_body="$(curl -sS -w '\n%{http_code}' "$JUPITER_BASE/execute" -X POST -H 'content-type: application/json' -d '{}' || true)"
jup_code="$(echo "$jup_body" | tail -n1)"
jup_body="$(echo "$jup_body" | sed '$d')"

python3 - <<PY
import json
from datetime import datetime, timezone
from pathlib import Path

rpc_health_code = "${rpc_health_code}".strip()
rpc_health_body = '''${rpc_health_body}'''.strip()
rpc_slot_code = "${rpc_slot_code}".strip()
rpc_slot_body = '''${rpc_slot_body}'''.strip()
prog_code = "${prog_code}".strip()
prog_body = '''${prog_body}'''.strip()
per_code = "${per_code}".strip()
jup_code = "${jup_code}".strip()
jup_body = '''${jup_body}'''.strip()


def parse_json(s):
    try:
        return json.loads(s) if s else {}
    except Exception:
        return {"_raw": s}

health_json = parse_json(rpc_health_body)
slot_json = parse_json(rpc_slot_body)
prog_json = parse_json(prog_body)
jup_json = parse_json(jup_body)

health_ok = rpc_health_code == "200" and health_json.get("result") == "ok"
slot_ok = rpc_slot_code == "200" and isinstance(slot_json.get("result"), int)
program_exec = False
if prog_code == "200":
    value = (prog_json.get("result") or {}).get("value")
    if isinstance(value, dict):
        program_exec = bool(value.get("executable"))

program_ids = {
    "escrow": "${ESCROW_PROGRAM_ID}",
    "registry": "${REGISTRY_PROGRAM_ID}",
    "reputation": "${REPUTATION_PROGRAM_ID}",
    "attestation": "${ATTESTATION_PROGRAM_ID}",
}
placeholder_escrow_program_id = "${PLACEHOLDER_ESCROW_PROGRAM_ID}".strip()


def program_id_defect(name, value):
    if not value.strip():
        return "unset"
    if name == "escrow" and placeholder_escrow_program_id and value.strip() == placeholder_escrow_program_id:
        return "placeholder (profile records deploymentStatus=not_deployed)"
    return None

unconfigured_program_ids = [
    f"{name}: {defect}"
    for name, value in program_ids.items()
    for defect in [program_id_defect(name, value)]
    if defect
]
program_set_configured = not unconfigured_program_ids

per_ok = per_code.isdigit() and int(per_code) > 0 and int(per_code) < 500
jup_ok = jup_code in {"200", "400", "401", "403"}

checks = [
    {
        "id": "rpc_health",
        "blocking": True,
        "ok": health_ok,
        "detail": f"HTTP {rpc_health_code}, result={health_json.get('result')}",
        "fix": None if health_ok else "Provide a healthy mainnet RPC endpoint via NEXT_PUBLIC_RPC_ENDPOINT.",
    },
    {
        "id": "rpc_slot",
        "blocking": True,
        "ok": slot_ok,
        "detail": f"HTTP {rpc_slot_code}, slot={slot_json.get('result')}",
        "fix": None if slot_ok else "Verify RPC endpoint and network access.",
    },
    {
        "id": "mainnet_program_set_configured",
        "blocking": True,
        "ok": program_set_configured,
        "detail": "all four program ids are audited mainnet deployments" if program_set_configured else f"unconfigured ids: {'; '.join(unconfigured_program_ids)}",
        "fix": None if program_set_configured else "Record audited mainnet registry, escrow, reputation, and attestation program ids (and clear the placeholder escrow id in config/networks/mainnet.json) before mainnet activation.",
    },
    {
        "id": "escrow_program_executable",
        "blocking": True,
        "ok": program_exec,
        "detail": f"HTTP {prog_code}, executable={program_exec}",
        "fix": None if program_exec else "Deploy audited escrow program to mainnet and set NEXT_PUBLIC_ESCROW_PROGRAM_ID to deployed address.",
    },
    {
        "id": "per_endpoint_reachable",
        "blocking": False,
        "ok": per_ok,
        "detail": f"HTTP {per_code}",
        "fix": None if per_ok else "Verify NEXT_PUBLIC_PER_RPC for selected environment.",
    },
    {
        "id": "jupiter_endpoint_reachable",
        "blocking": False,
        "ok": jup_ok,
        "detail": f"HTTP {jup_code}",
        "fix": None if jup_ok else "Verify JUPITER_API_BASE and outbound network DNS/connectivity.",
    },
]

blocking_failures = [c for c in checks if c["blocking"] and not c["ok"]]
result_ok = len(blocking_failures) == 0

payload = {
    "ok": result_ok,
    "checkedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "networkProfile": "${NETWORK_PROFILE_EFFECTIVE}",
    "rpcUrl": "${RPC_URL}",
    "programId": "${PROGRAM_ID}",
    "programIds": program_ids,
    "perRpc": "${PER_RPC}",
    "jupiterBase": "${JUPITER_BASE}",
    "checks": checks,
    "raw": {
        "rpcHealth": health_json,
        "rpcSlot": slot_json,
        "program": prog_json,
        "jupiterExecuteProbe": jup_json,
    },
}

Path("${JSON_OUT}").write_text(json.dumps(payload, indent=2))

status = "✅ PASS" if result_ok else "❌ FAIL"
lines = [
    "# Mainnet Readiness Check Summary",
    "",
    f"- Timestamp: {payload['checkedAt']}",
    f"- Profile (effective): {payload['networkProfile']}",
    f"- RPC: {payload['rpcUrl']}",
    f"- Escrow program ID: {payload['programIds']['escrow'] or 'UNSET'}",
    f"- Registry program ID: {payload['programIds']['registry'] or 'UNSET'}",
    f"- Reputation program ID: {payload['programIds']['reputation'] or 'UNSET'}",
    f"- Attestation program ID: {payload['programIds']['attestation'] or 'UNSET'}",
    f"- PER RPC: {payload['perRpc']}",
    f"- Jupiter base: {payload['jupiterBase']}",
    f"- Result: {status}",
    "",
    "## Checks",
]
for c in checks:
    mark = "PASS" if c["ok"] else "FAIL"
    block = "blocking" if c["blocking"] else "advisory"
    lines.append(f"- [{mark}] {c['id']} ({block}) — {c['detail']}")
    if c.get("fix") and not c["ok"]:
        lines.append(f"  - fix: {c['fix']}")

lines += [
    "",
    "## Artifacts",
    f"- JSON: ${JSON_OUT}",
]
Path("${SUMMARY_OUT}").write_text("\n".join(lines) + "\n")
print(json.dumps(payload, indent=2))
PY

cat "$SUMMARY_OUT" | tee -a "$LOG_FILE"

if ! python3 - <<PY
import json
from pathlib import Path
obj = json.loads(Path("$JSON_OUT").read_text())
raise SystemExit(0 if obj.get("ok") else 1)
PY
then
  exit 1
fi
