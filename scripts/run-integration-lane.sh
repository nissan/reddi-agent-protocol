#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

probe_ollama() {
  local raw=""
  raw="$(curl -s --max-time 4 http://localhost:11434/api/tags || true)"
  if [ -z "$raw" ]; then
    echo "down|"
    return
  fi

  local model
  model="$(OLLAMA_RAW="$raw" python3 - <<'PY'
import json, os
raw = os.environ.get("OLLAMA_RAW", "")
try:
    data = json.loads(raw)
    models = data.get("models") or []
    if not models:
        print("")
    else:
        first = models[0]
        if isinstance(first, dict):
            print(first.get("name", ""))
        else:
            print(str(first))
except Exception:
    print("")
PY
)"

  if [ -n "$model" ]; then
    echo "up|$model"
  else
    echo "down|"
  fi
}

VALIDATOR_RPC_URL="${INTEGRATION_VALIDATOR_RPC_URL:-http://localhost:8899}"

probe_validator() {
  local health
  health="$(curl -s --max-time 4 -X POST "$VALIDATOR_RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' || true)"

  if printf "%s" "$health" | grep -q '"result"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "up"
  else
    echo "down"
  fi
}

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${ROOT_DIR}/artifacts/integration-lane/${TS}"
mkdir -p "$OUT_DIR"

echo "[integration-lane] output: $OUT_DIR"

OLLAMA_PROBE="$(probe_ollama)"
OLLAMA_STATUS="${OLLAMA_PROBE%%|*}"
OLLAMA_MODEL="${OLLAMA_PROBE#*|}"
VALIDATOR_STATUS="$(probe_validator)"

latest_summary() {
  local glob="$1"
  local latest=""
  latest="$(ls -td ${glob} 2>/dev/null | head -1 || true)"
  if [ -n "$latest" ] && [ -f "$latest/SUMMARY.md" ]; then
    echo "$latest/SUMMARY.md"
  else
    echo "n/a"
  fi
}

# Surfpool lanes publish a PASS-only accepted-evidence receipt; resolve through the same validated
# contract the Node consumers use so a retained FAIL run is never cited as lane evidence.
accepted_surfpool_summary() {
  node "${ROOT_DIR}/scripts/resolve-accepted-surfpool-evidence.mjs" "$1" "$2" 2>/dev/null || echo "n/a"
}

SURFPOOL_CRITICAL_SUMMARY="$(accepted_surfpool_summary "artifacts/surfpool-smoke" "legacy-anchor")"
SURFPOOL_QUASAR_SUMMARY="$(accepted_surfpool_summary "artifacts/surfpool-quasar-smoke" "quasar")"
SURFPOOL_ECONOMIC_SUMMARY="$(latest_summary "${ROOT_DIR}/artifacts/economic-demo-surfpool-rehearsal/*")"

set +e
npx playwright test e2e/integration.spec.ts \
  --reporter=line,json \
  --output="$OUT_DIR/test-output" \
  > "$OUT_DIR/playwright.log" 2>&1
EXIT_CODE=$?
set -e

JSON_REPORT="playwright-report.json"
if [ -f "$JSON_REPORT" ]; then
  mv "$JSON_REPORT" "$OUT_DIR/report.json"
fi

SKIPPED_COUNT=$(grep -Eo "[0-9]+ skipped" "$OUT_DIR/playwright.log" | tail -1 | awk '{print $1}' || echo "0")
PASSED_COUNT=$(grep -Eo "[0-9]+ passed" "$OUT_DIR/playwright.log" | tail -1 | awk '{print $1}' || echo "0")
FAILED_COUNT=$(grep -Eo "[0-9]+ failed" "$OUT_DIR/playwright.log" | tail -1 | awk '{print $1}' || echo "0")
INFRA_HINT=$(grep -E "Integration tests skipped|Infra ready" "$OUT_DIR/playwright.log" | tail -1 || true)
LOG_SELECTED_MODEL="$(printf "%s" "$INFRA_HINT" | sed -n 's/.*Ollama model: \([^,\"]*\).*/\1/p')"
MODEL_SOURCE_NOTE="probe"
if [ -n "${LOG_SELECTED_MODEL:-}" ]; then
  MODEL_SOURCE_NOTE="playwright"
fi
FINAL_MODEL="${LOG_SELECTED_MODEL:-${OLLAMA_MODEL:-n/a}}"
MODEL_MISMATCH="no"
if [ -n "${LOG_SELECTED_MODEL:-}" ] && [ -n "${OLLAMA_MODEL:-}" ] && [ "$LOG_SELECTED_MODEL" != "$OLLAMA_MODEL" ]; then
  MODEL_MISMATCH="yes"
fi

cat > "$OUT_DIR/SUMMARY.md" <<EOF
# Integration Lane Summary

- Timestamp: ${TS}
- Exit code: ${EXIT_CODE}
- Passed: ${PASSED_COUNT}
- Skipped: ${SKIPPED_COUNT}
- Failed: ${FAILED_COUNT}

## Infra Readiness Snapshot (pre-run)
- Ollama: ${OLLAMA_STATUS}
- Ollama model (probe): ${OLLAMA_MODEL:-n/a}
- Ollama model (selected by tests): ${LOG_SELECTED_MODEL:-n/a}
- Ollama model (effective summary): ${FINAL_MODEL}
- Model source: ${MODEL_SOURCE_NOTE}
- Model probe/selection mismatch: ${MODEL_MISMATCH}
- Local validator RPC: ${VALIDATOR_RPC_URL}
- Local validator status: ${VALIDATOR_STATUS}
- Playwright infra hint: ${INFRA_HINT:-n/a}

## Surfpool Runtime Evidence Snapshot
- Economic demo Surfpool rehearsal: ${SURFPOOL_ECONOMIC_SUMMARY}
- A→B→C Surfpool critical lane: ${SURFPOOL_CRITICAL_SUMMARY}
- Quasar Surfpool critical lane: ${SURFPOOL_QUASAR_SUMMARY}

## Artifacts
- Log:
  - ${OUT_DIR}/playwright.log
- JSON report:
  - ${OUT_DIR}/report.json

## Interpretation
- This Playwright lane is a legacy live-infra probe for Ollama + a validator at the configured RPC URL.
- If all tests are skipped, those exact prerequisites were unavailable or not ready.
- Dedicated Surfpool runtime evidence is tracked separately above because the active local-validator proof path uses isolated Surfpool ports instead of localhost:8899.
- If tests pass, this lane provides additional runtime-backed evidence beyond route/unit contracts.
EOF

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[integration-lane] FAILED (see $OUT_DIR/SUMMARY.md)"
  exit "$EXIT_CODE"
fi

echo "[integration-lane] complete (see $OUT_DIR/SUMMARY.md)"
