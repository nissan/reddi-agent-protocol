#!/usr/bin/env bash
# Owner-run rehearsal of the Budget stop procedure (docs/security/INCIDENT-RUNBOOK.md, section 6; #1211).
# It calls the signer's incident route in the runbook's order, times each step and writes a record.
#
# IT REALLY STOPS THINGS on the signer it is pointed at: every approval is paused and EVERY open
# Budget on that signer is closed (payers are emailed). Point it at a rehearsal signer, or at the
# real one only when the open Budgets are your own drill Budgets.
#
#   BUDGET_SIGNER_URL=https://<signer> bash scripts/budget-incident-drill.sh
#
# The incident secret is read from 1Password (never printed, never written to the record):
#   OP_ACCOUNT, OP_VAULT (default OpenClaw-Agents), OP_ITEM (default "RAP Budget incident secret (signer)"),
#   OP_FIELD (default credential). Or pass it in BUDGET_INCIDENT_SECRET.
# Optional:
#   DRILL_AGENT_KEY + BUDGET_APP_URL  a drill Budget's agent key and the app origin: the script then
#                                     shows a call refused while paused and served after resume
#   DRILL_UNFREEZE_ID                 a frozen record id (32 hex) to lift with "unfreeze"
#   DRILL_OUT                         where the record goes (default .tmp/budget-incident-drill-<time>.md)
#   DRILL_SKIP_CLOSE=1                pause, probe and resume only: closes nothing
set -euo pipefail

signer="${BUDGET_SIGNER_URL:-}"
case "$signer" in https://* | http://127.0.0.1:* | http://localhost:*) ;; *) echo "Set BUDGET_SIGNER_URL to the signer's https origin (or a local rehearsal signer on 127.0.0.1)."; exit 1 ;; esac
signer="${signer%/}"
for tool in curl jq; do command -v "$tool" >/dev/null || { echo "Missing: $tool"; exit 1; }; done

secret="${BUDGET_INCIDENT_SECRET:-}"
if [ -z "$secret" ]; then
  command -v op >/dev/null || { echo "Set BUDGET_INCIDENT_SECRET, or install and sign in to op."; exit 1; }
  # `op read` refuses item names with brackets, and --reveal quotes some values: read the field as JSON.
  secret="$(op item get "${OP_ITEM:-RAP Budget incident secret (signer)}" --vault "${OP_VAULT:-OpenClaw-Agents}" --fields "label=${OP_FIELD:-credential}" --format json | jq -r .value)"
fi
[ -n "$secret" ] && [ "$secret" != null ] || { echo "The incident secret could not be read. Nothing was done."; exit 1; }
trap 'unset secret' EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="${DRILL_OUT:-.tmp/budget-incident-drill-$stamp.md}"
mkdir -p "$(dirname "$out")"
now() { date -u +%H:%M:%S; }
ms() { date +%s%3N; }
note() { printf '%s\n' "$*" | tee -a "$out"; }

health="$(curl -sS -m 30 "$signer/api/v1/health" || true)"
network="$(printf %s "$health" | jq -r '.network // "unknown"' 2>/dev/null || echo unknown)"
echo "Signer: $signer"
echo "Network: $network"
echo "This pauses every Budget approval on that signer${DRILL_SKIP_CLOSE:+ (no closes: DRILL_SKIP_CLOSE is set)}."
[ -n "${DRILL_SKIP_CLOSE:-}" ] || echo "It then CLOSES EVERY OPEN BUDGET on it and emails their payers."
printf 'Type DRILL to go on: '
read -r answer
[ "$answer" = DRILL ] || { echo "Stopped. Nothing was done."; exit 1; }

note "# Budget stop drill, $stamp"
note ""
note "- Signer: \`$signer\` (network \`$network\`)"
note "- Health before: \`$(printf %s "$health" | jq -c '{ok, network, programId, judge}' 2>/dev/null || echo unreadable)\`"
note ""
note "| Step | Started (UTC) | Took | HTTP | Result |"
note "| --- | --- | --- | --- | --- |"

# step <name> <json body> <jq summary filter>
step() {
  local name="$1" body="$2" filter="$3" started t0 code took summary
  started="$(now)"; t0="$(ms)"
  code="$(curl -sS -m 320 -o /tmp/drill-step.json -w '%{http_code}' -X POST "$signer/api/v1/incident" \
    -H "Authorization: Bearer $secret" -H 'Content-Type: application/json' -d "$body" || echo 000)"
  took="$(( $(ms) - t0 ))"
  summary="$(jq -c "$filter" /tmp/drill-step.json 2>/dev/null || echo '(no JSON)')"
  note "| $name | $started | ${took} ms | $code | \`$summary\` |"
  rm -f /tmp/drill-step.json
}

# probe <name> <expect: refused|served>: one small call with the drill Budget's agent key.
probe() {
  [ -n "${DRILL_AGENT_KEY:-}" ] && [ -n "${BUDGET_APP_URL:-}" ] || { note "| $1 | $(now) | - | - | skipped: DRILL_AGENT_KEY or BUDGET_APP_URL not set; check by hand |"; return 0; }
  local started t0 code took verdict
  started="$(now)"; t0="$(ms)"
  code="$(curl -sS -m 120 -o /tmp/drill-probe.json -w '%{http_code}' -X POST "${BUDGET_APP_URL%/}/api/budget/v1/chat/completions" \
    -H "Authorization: Bearer $DRILL_AGENT_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"auto","messages":[{"role":"user","content":"Say ok."}],"max_tokens":8}' || echo 000)"
  took="$(( $(ms) - t0 ))"
  if [ "$2" = refused ]; then [ "$code" != 200 ] && verdict="as expected: refused" || verdict="WRONG: the call was served"; else [ "$code" = 200 ] && verdict="as expected: served" || verdict="WRONG: the call was refused"; fi
  note "| $1 | $started | ${took} ms | $code | $verdict: \`$(jq -c '{code: (.error.code // .code // null)}' /tmp/drill-probe.json 2>/dev/null || echo '(no JSON)')\` |"
  rm -f /tmp/drill-probe.json
}

reason="drill $stamp"
probe "0. Call before the drill" served
step "1. Pause" "{\"action\":\"pause\",\"reason\":\"$reason\"}" '{ok}'
probe "2. Call while paused" refused
if [ -z "${DRILL_SKIP_CLOSE:-}" ]; then
  step "3. Close all" "{\"action\":\"close-all\",\"reason\":\"$reason\"}" '{ok, paused, closed: ([.results[]? | select(.ok)] | length), failed: ([.results[]? | select(.ok | not)] | length), unreached: (.unreached | length)}'
  step "4. Close all again (must find nothing left)" "{\"action\":\"close-all\",\"reason\":\"$reason, second pass\"}" '{ok, paused, failed: ([.results[]? | select(.ok | not)] | length), unreached: (.unreached | length)}'
else
  note "| 3. Close all | - | - | - | skipped: DRILL_SKIP_CLOSE |"
fi
step "5. Resume" "{\"action\":\"resume\",\"reason\":\"$reason over\"}" '{ok}'
if [ -n "${DRILL_UNFREEZE_ID:-}" ]; then
  step "6. Unfreeze one record" "{\"action\":\"unfreeze\",\"id\":\"$DRILL_UNFREEZE_ID\",\"reason\":\"$reason over\"}" '{ok}'
else
  note "| 6. Unfreeze one record | - | - | - | skipped: DRILL_UNFREEZE_ID not set |"
fi
wrong="$(curl -sS -m 30 -o /dev/null -w '%{http_code}' -X POST "$signer/api/v1/incident" -H "Authorization: Bearer not-the-secret" -H 'Content-Type: application/json' -d '{"action":"pause","reason":"x"}' || echo 000)"
note "| 7. A wrong secret | $(now) | - | $wrong | $([ "$wrong" = 401 ] && echo "as expected: refused" || echo "WRONG: expected 401") |"

note ""
note "Health after: \`$(curl -sS -m 30 "$signer/api/v1/health" | jq -c '{ok, network}' 2>/dev/null || echo unreadable)\`"
note ""
note "Still by hand (runbook section 6): open a new Budget and make one call (resume works), remove and restore the KMS grant with an approval refused in between, check each closed Budget's refund on chain, and sign this record."
echo
echo "Record: $out"
