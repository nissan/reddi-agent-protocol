#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# OpenClaw/non-login shells do not always include rustup's cargo shim.
# Keep the BDD sweep self-contained so Bucket M does not depend on caller PATH shape.
if [ -x "$HOME/.cargo/bin/cargo" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/artifacts/bdd-sweep/$TS"
LOG_FILE="$OUT_DIR/bdd-sweep.log"
STEPS_FILE="$OUT_DIR/steps.tsv"
mkdir -p "$OUT_DIR"

echo "[bdd-sweep] starting representative per-bucket verification"
echo "[bdd-sweep] artifacts: $OUT_DIR"

FAILED_STEPS=0

run_step() {
  local label="$1"
  shift

  {
    echo ""
    echo "[bdd-sweep] >>> $label"
    "$@"
  } 2>&1 | tee -a "$LOG_FILE"

  local code=${PIPESTATUS[0]}
  if [ "$code" -eq 0 ]; then
    printf "PASS\t%s\n" "$label" >> "$STEPS_FILE"
  else
    printf "FAIL\t%s\n" "$label" >> "$STEPS_FILE"
    FAILED_STEPS=$((FAILED_STEPS + 1))
  fi

  return 0
}

run_step "Bucket A (onboarding/operator gates)" \
  npx jest lib/__tests__/operator-key-rotation.test.ts lib/__tests__/onboarding-operator-status-routes.test.ts --runInBand

run_step "Bucket B (discovery + ranking contracts)" \
  npx jest lib/__tests__/registry-route.test.ts lib/__tests__/registry-bridge-sort.test.ts --runInBand

run_step "Bucket C (planner consumption contracts)" \
  npx jest lib/__tests__/planner-resolve-route.test.ts lib/__tests__/planner-invoke-route.test.ts lib/__tests__/planner-signal-route.test.ts --runInBand

run_step "Bucket D/E (security + reliability contracts)" \
  npx jest lib/__tests__/endpoint-security-compat.test.ts lib/__tests__/program-rpc-config.test.ts lib/__tests__/register-probe-route.test.ts lib/__tests__/onboarding-healthcheck-security.test.ts --runInBand

run_step "Bucket F (jupiter + payment contracts)" \
  npx jest lib/__tests__/jupiter-client.test.ts lib/__tests__/planner-invoke-route.test.ts --runInBand

run_step "Bucket F package payment contracts" \
  bash -lc 'cd packages/x402-solana && npm test -- --runInBand tests/payment.test.ts'

run_step "Bucket G (torque retention contracts)" \
  npx jest lib/__tests__/torque-client.test.ts lib/__tests__/torque-event-route.test.ts lib/__tests__/torque-leaderboard-route.test.ts lib/__tests__/torque-onboarding-event.test.ts --runInBand

run_step "Bucket H (consumer orchestrator lifecycle contracts)" \
  npx jest lib/__tests__/planner-register-consumer-route.test.ts lib/__tests__/planner-tools-manifest-route.test.ts lib/__tests__/planner-resolve-attestor-route.test.ts lib/__tests__/planner-release-route.test.ts lib/__tests__/planner-auditability.test.ts --runInBand

run_step "Bucket I (agent manager operations)" \
  npx jest lib/__tests__/manager-readiness-route.test.ts lib/__tests__/manager-evidence-pack.test.ts lib/__tests__/manager-evidence-route.test.ts --runInBand

run_step "Bucket J e2e (judge replication UX)" \
  npx playwright test e2e/judge-replication-onboarding.spec.ts

run_step "Bucket S (source adapter conformance contracts)" \
  npx jest lib/__tests__/source-adapter-schema.test.ts lib/__tests__/register-probe-route.test.ts lib/__tests__/source-adapter-openclaw-profile.test.ts lib/__tests__/source-adapter-openclaw-connector.test.ts lib/__tests__/source-adapter-hermes-profile.test.ts lib/__tests__/source-adapter-hermes-attestor.test.ts lib/__tests__/source-adapter-pi-profile.test.ts lib/__tests__/source-adapter-pi-extension-bundle.test.ts lib/__tests__/source-adapter-routing-policy.test.ts lib/__tests__/planner-resolve-route.test.ts --runInBand

run_step "Bucket S source conformance matrix" \
  npm run test:source:matrix

run_step "Bucket M (Quasar/PER readiness contracts)" \
  npx jest lib/__tests__/quasar-demo-program-config.test.ts lib/__tests__/quasar-demo-agent-guard.test.ts lib/__tests__/quasar-agent-account-decoder.test.ts lib/__tests__/quasar-instructions.test.ts --runInBand

run_step "Bucket M cargo PER smoke" \
  cargo test --manifest-path experiments/quasar-escrow-per/Cargo.toml

PASS_COUNT=$(awk -F'\t' 'BEGIN{c=0} $1=="PASS"{c++} END{print c}' "$STEPS_FILE" 2>/dev/null || printf '0')
FAIL_COUNT=$(awk -F'\t' 'BEGIN{c=0} $1=="FAIL"{c++} END{print c}' "$STEPS_FILE" 2>/dev/null || printf '0')
TOTAL_COUNT=$((PASS_COUNT + FAIL_COUNT))

{
  echo "# BDD Bucket Sweep Summary"
  echo ""
  echo "- Timestamp: $TS"
  echo "- Output dir: $OUT_DIR"
  echo "- Steps passed: $PASS_COUNT"
  echo "- Steps failed: $FAIL_COUNT"
  echo "- Steps total: $TOTAL_COUNT"
  echo ""
  echo "## Step Results"
  echo ""
  echo "| Status | Step |"
  echo "|---|---|"
  if [ -f "$STEPS_FILE" ]; then
    while IFS=$'\t' read -r status label; do
      [ -n "$status" ] || continue
      echo "| $status | $label |"
    done < "$STEPS_FILE"
  fi
  echo ""
  echo "## Artifacts"
  echo "- Log: $LOG_FILE"
  echo "- Step status table source: $STEPS_FILE"
} > "$OUT_DIR/SUMMARY.md"

if [ "$FAILED_STEPS" -gt 0 ]; then
  echo ""
  echo "[bdd-sweep] complete with failures ($FAILED_STEPS)"
  echo "[bdd-sweep] summary: $OUT_DIR/SUMMARY.md"
  exit 1
fi

echo ""
echo "[bdd-sweep] complete: representative per-bucket suite is green"
echo "[bdd-sweep] summary: $OUT_DIR/SUMMARY.md"
