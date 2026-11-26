#!/usr/bin/env bash
# Owner-run set-up of the Budget watcher's Cloudflare Worker (see README.md).
# It makes one fresh cron secret, stores it in 1Password, sets it on the app
# (Vercel), in GitHub Actions and on the Worker, deploys the Worker and
# redeploys the app. The secret is never printed.
#
# Needs: op (signed in; set OP_ACCOUNT if you have more than one account),
# vercel and gh (signed in), node. Wrangler opens a browser to sign in to
# Cloudflare the first time.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
vault="${OP_VAULT:-OpenClaw-Agents}"
item="RAP Budget watcher cron secret"
repo="nissan/reddi-agent-protocol"
app="https://app.agent-protocol.reddi.tech"

for tool in op vercel gh node openssl; do command -v "$tool" >/dev/null || { echo "Missing: $tool"; exit 1; }; done
op vault get "$vault" >/dev/null || { echo "1Password: cannot read vault $vault (sign in, or set OP_ACCOUNT)"; exit 1; }
# Everything that can fail on a missing set-up is checked before a secret is made.
[ -f "$root/.vercel/project.json" ] || { echo "Vercel: $root is not linked to the app project (no .vercel/project.json). In a git worktree, copy .vercel from your main checkout, or run 'vercel link' here."; exit 1; }
(cd "$root" && vercel whoami >/dev/null 2>&1) || { echo "Vercel: not signed in (run 'vercel login')"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "GitHub: not signed in (run 'gh auth login')"; exit 1; }

echo "1/6 Cloudflare Worker (a browser may open to sign in)"
(cd "$here" && npx --yes wrangler@4 deploy) || {
  echo "The Worker did not deploy, so nothing else was changed."
  echo "If Cloudflare said you need a workers.dev subdomain (code 10063): open Workers & Pages once in the Cloudflare dashboard, which creates it, then run this again."
  exit 1
}

s="$(openssl rand -hex 32)"
[ "${#s}" -eq 64 ] || { echo "Could not make a secret"; exit 1; }
trap 'unset s' EXIT

echo "2/6 1Password"
if op item get "$item" --vault "$vault" >/dev/null 2>&1; then
  op item edit "$item" --vault "$vault" "credential=$s" >/dev/null
else
  op item create --category "API Credential" --title "$item" --vault "$vault" "credential=$s" >/dev/null
fi

echo "3/6 Worker secret, then Vercel (app, production)"
(cd "$here" && printf %s "$s" | npx --yes wrangler@4 secret put CRON_SECRET)
(cd "$root" && { vercel env rm CRON_SECRET production --yes >/dev/null 2>&1 || true; } && printf %s "$s" | vercel env add CRON_SECRET production --sensitive >/dev/null)

echo "4/6 GitHub Actions"
printf %s "$s" | gh secret set BUDGET_WATCH_CRON_SECRET --repo "$repo"

echo "5/6 Redeploy the app so it reads the new secret"
# The deployment is looked up in the team that owns the linked project, not in
# whichever scope the CLI last used.
org="$(node -e 'process.stdout.write(String(require(process.argv[1]).orgId||""))' "$root/.vercel/project.json")"
(cd "$root" && vercel redeploy "${app#https://}" --target production ${org:+--scope "$org"}) || echo "Redeploy did not start: redeploy the latest production deployment from the Vercel dashboard now. This script keeps checking for 5 minutes."

echo "6/6 Check"
ok=""
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 60 -H "authorization: Bearer $s" "$app/api/cron/budget-watch" || true)"
  [ "$code" = 200 ] && { ok=1; break; }
  sleep 10
done
if [ -n "$ok" ]; then echo "The watcher accepts the new secret."; else echo "The watcher did not accept the new secret within 5 minutes (last status $code). Check the redeploy."; exit 1; fi
curl -s -m 30 "$app/api/cron/budget-watch/health"; echo
echo "Done. The Worker runs every 5 minutes; its runs are under Workers > rap-budget-watch > Logs."
