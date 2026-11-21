#!/usr/bin/env bash
# Assemble a self-contained auditor prompt for one surface, pinned to a commit.
#
#   docs/security/audit-kit/assemble-prompt.sh <S1..S7|AGG> <commit> [report-path-or-reports-dir]
#
# Prints the prompt to stdout. Reads only files in this folder. Touches nothing
# else: no network, no git changes, no secrets.
set -euo pipefail

usage() {
  echo "usage: $0 <S1|S2|S3|S4|S5|S6|S7|AGG> <commit-sha> [report path, or reports dir for AGG]" >&2
  exit 2
}

[ $# -ge 2 ] || usage
surface="$1"
commit="$2"
target="${3:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$commit" in
  *[!0-9a-fA-F]*|"") echo "commit must be a hex sha" >&2; exit 2 ;;
esac

case "$surface" in
  S1) file="S1-onchain-program.md"; name="S1 On-chain program (programs/pinocchio-escrow, V1 default build)" ;;
  S2) file="S2-app-sandbox-api.md"; name="S2 Developer app, sandbox and API routes" ;;
  S3) file="S3-marketing-site.md"; name="S3 Marketing site (apps/marketing)" ;;
  S4) file="S4-provider-kit-sdk-supply-chain.md"; name="S4 Provider kit, SDK packages and npm supply chain" ;;
  S5) file="S5-supabase-auth.md"; name="S5 Supabase database, RLS and wallet sign-in" ;;
  S6) file="S6-infra-keys-custody-cicd.md"; name="S6 Infrastructure, keys, custody and CI/CD" ;;
  S7) file="S7-payment-economic-flows.md"; name="S7 End-to-end payment and economic flows" ;;
  AGG) file="AGG-go-no-go-aggregator.md"; name="AGG Go/No-go aggregator" ;;
  *) usage ;;
esac

short="${commit:0:7}"
if [ -z "$target" ]; then
  if [ "$surface" = "AGG" ]; then target="<reports folder>"; else target="(none given: print the report as your final answer)"; fi
fi

render() {
  # Fill placeholders. Uses | as the sed delimiter; paths must not contain |.
  sed -e "s|{{SURFACE}}|$name|g" \
      -e "s|{{COMMIT}}|$commit|g" \
      -e "s|{{COMMIT_SHORT}}|$short|g" \
      -e "s|{{REPORT_PATH}}|$target|g" \
      -e "s|{{REPORTS_DIR}}|$target|g" "$1"
}

if [ "$surface" = "AGG" ]; then
  render "$here/prompts/$file"
  exit 0
fi

render "$here/prompts/00-common-preamble.md"
printf '\n---\n\n'
render "$here/prompts/$file"
printf '\n---\n\n# Context pack (also in the repository under docs/security/audit-kit/context/)\n\n'
for f in ARCHITECTURE THREAT-MODEL SCOPE-AND-RULES PRIOR-REVIEWS; do
  printf '\n---\n\n'
  cat "$here/context/$f.md"
done
printf '\n---\n\n# Checklist section for this surface\n\n'
awk -v s="## $surface " 'index($0, s) == 1 {on=1; print; next} on && /^## S[0-9] / {exit} on {print}' "$here/CHECKLIST.md"
