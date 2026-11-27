#!/usr/bin/env bash
# Rehearse the mainnet deploy (docs/MAINNET-LAUNCH-RUNBOOK.md §3 and §4) on a
# throwaway local validator, with the same commands and flags, before any real
# SOL is spent. Read-only towards mainnet: it reads the feature set and four mint
# accounts from a mainnet RPC and sends nothing there.
#
# It never touches the real program keypair, deployer or vault keys: it makes a
# throwaway deployer and program keypair in a temporary folder, uses local
# airdropped SOL, and deletes the folder on exit. The vault address is only a
# destination (the handover skips the new authority's signature, as on mainnet).
#
#   scripts/rehearse-mainnet-deploy.sh --so <pinocchio_escrow.so from the build of record> \
#     [--record config/releases/v1-mainnet-83045ee.json] [--mainnet-url <rpc>]
#
# --mainnet-url defaults to MAINNET_RPC_URL, else the public mainnet RPC; only
# its host is printed. Needs solana, solana-keygen, solana-test-validator,
# spl-token and node, and packages/x402-solana built (npm ci && npm run build).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECORD="$ROOT/config/releases/v1-mainnet-83045ee.json"
SO=""
MAINNET_URL="${MAINNET_RPC_URL:-https://api.mainnet-beta.solana.com}"
VAULT="5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe"
FUND_SOL=3

while [ $# -gt 0 ]; do
  case "$1" in
    --so) SO="$2"; shift 2 ;;
    --record) RECORD="$2"; shift 2 ;;
    --mainnet-url) MAINNET_URL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SO" ] && [ -f "$SO" ] || { echo "--so <pinocchio_escrow.so> is required" >&2; exit 2; }
for tool in solana solana-keygen solana-test-validator spl-token node; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 2; }
done

HELPER="node $ROOT/scripts/rehearse-escrow-deployment.mjs"
MAINNET_HOST="$(node -e 'try{console.log(new URL(process.argv[1]).host)}catch{console.log("invalid url")}' "$MAINNET_URL")"
SIZE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).size)' "$RECORD")"
WORK="$(mktemp -d)"
VALIDATOR_PID=""
cleanup() {
  [ -n "$VALIDATOR_PID" ] && kill "$VALIDATOR_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }

step "1. The file is the build of record ($(basename "$RECORD"))"
$HELPER verify-file --record "$RECORD" --so "$SO"

step "2. secp256r1 precompile on mainnet (RPC $MAINNET_HOST, read only)"
FEATURES="$(solana feature status --display-all --url "$MAINNET_URL" 2>/dev/null || true)"
P256_LINE="$(printf '%s\n' "$FEATURES" | grep -i 'secp256r1' | head -1 || true)"
if [ -z "$P256_LINE" ]; then echo "FAIL could not find the secp256r1 feature in the mainnet feature list"; exit 1; fi
if printf '%s' "$P256_LINE" | grep -qiE 'inactive|pending'; then echo "FAIL $P256_LINE"; exit 1; fi
echo "ok   $P256_LINE"

step "3. Local validator with mainnet's feature set and the four mints (cloned now)"
MINTS="$($HELPER mints)"
CLONES=()
while read -r _symbol mint _program; do CLONES+=(--clone "$mint"); done <<< "$MINTS"
RPC_PORT="$(free_port)"; FAUCET_PORT="$(free_port)"; GOSSIP_PORT="$(free_port)"
LOCAL="http://127.0.0.1:$RPC_PORT"
solana-test-validator --ledger "$WORK/ledger" --rpc-port "$RPC_PORT" --faucet-port "$FAUCET_PORT" \
  --gossip-port "$GOSSIP_PORT" --bind-address 127.0.0.1 --url "$MAINNET_URL" --clone-feature-set \
  "${CLONES[@]}" --quiet >"$WORK/validator.log" 2>&1 &
VALIDATOR_PID=$!
for _ in $(seq 1 90); do
  solana cluster-version --url "$LOCAL" >/dev/null 2>&1 && break
  kill -0 "$VALIDATOR_PID" 2>/dev/null || { echo "FAIL the local validator stopped:"; tail -5 "$WORK/validator.log"; exit 1; }
  sleep 1
done
solana cluster-version --url "$LOCAL" >/dev/null || { echo "FAIL the local validator did not start"; exit 1; }
echo "ok   local validator on 127.0.0.1:$RPC_PORT"

step "4. Throwaway deployer and program id, funded with $FUND_SOL SOL (local only)"
solana-keygen new --no-bip39-passphrase --silent --outfile "$WORK/deployer.json" >/dev/null
solana-keygen new --no-bip39-passphrase --silent --outfile "$WORK/program.json" >/dev/null
DEPLOYER="$(solana-keygen pubkey "$WORK/deployer.json")"
PROGRAM_ID="$(solana-keygen pubkey "$WORK/program.json")"
solana airdrop "$FUND_SOL" "$DEPLOYER" --url "$LOCAL" >/dev/null
lamports() { solana balance "$1" --lamports --url "$LOCAL" | awk '{print $1}'; }
START="$(lamports "$DEPLOYER")"
echo "ok   deployer $DEPLOYER, program $PROGRAM_ID"

step "5. Upload to a buffer, check the buffer, deploy from it (runbook §3.1, same flags)"
solana program write-buffer "$SO" --keypair "$WORK/deployer.json" --use-rpc --url "$LOCAL" | tee "$WORK/buffer.txt"
BUFFER="$(awk '/^Buffer:/ {print $2}' "$WORK/buffer.txt")"
[ -n "$BUFFER" ] || { echo "FAIL could not read the buffer address"; exit 1; }
# The check reads at finalized commitment and write-buffer returns at confirmed, so the
# buffer can be missing for a few seconds; only that case is retried, a wrong hash is not.
for _ in $(seq 1 60); do
  BUFFER_OK=0
  $HELPER buffer-hash --record "$RECORD" --url "$LOCAL" --buffer "$BUFFER" >"$WORK/buffer-hash.txt" 2>&1 && BUFFER_OK=1
  [ "$BUFFER_OK" = 1 ] && break
  grep -q 'not a loader buffer account' "$WORK/buffer-hash.txt" || break
  sleep 1
done
cat "$WORK/buffer-hash.txt"
[ "$BUFFER_OK" = 1 ] || exit 1
solana program deploy --buffer "$BUFFER" --program-id "$WORK/program.json" --keypair "$WORK/deployer.json" \
  --max-len "$SIZE" --url "$LOCAL"

step "6. Hand upgrade authority to the vault (runbook §3.2)"
solana program set-upgrade-authority "$PROGRAM_ID" --upgrade-authority "$WORK/deployer.json" \
  --new-upgrade-authority "$VAULT" --skip-new-upgrade-authority-signer-check \
  --keypair "$WORK/deployer.json" --url "$LOCAL"
AFTER_DEPLOY="$(lamports "$DEPLOYER")"

step "7. Deployment check (runbook §3.3)"
sleep 2 # the check reads at finalized commitment
for _ in $(seq 1 30); do
  $HELPER check --record "$RECORD" --url "$LOCAL" --program-id "$PROGRAM_ID" --deployer "$DEPLOYER" >"$WORK/check.txt" 2>&1 && break
  sleep 1
done
cat "$WORK/check.txt"
grep -q '^FAIL' "$WORK/check.txt" && exit 1

step "8. The deployer can no longer change the program (runbook §3.4)"
if solana program set-upgrade-authority "$PROGRAM_ID" --upgrade-authority "$WORK/deployer.json" \
  --new-upgrade-authority "$WORK/deployer.json" --keypair "$WORK/deployer.json" --url "$LOCAL" >"$WORK/neg.txt" 2>&1; then
  echo "FAIL the deployer changed the authority after the handover"; exit 1
fi
echo "ok   refused: $(grep -iE 'error|authority' "$WORK/neg.txt" | head -1)"

step "8a. Emergency pause init (runbook §3a): not rehearsed here"
echo "info init_pause is signed by the vault through Squads, which a local validator cannot stand in for;"
echo "     it is drilled on devnet (scripts/emergency-pause.mjs devnet-admin). Until it lands, the program"
echo "     refuses every lock, open, reserve and payout, so on mainnet it follows the handover straight away."

step "9. Mints and treasury: SOL and the four token accounts (runbook §4)"
$HELPER mint-check --url "$LOCAL"
solana transfer "$VAULT" 0.001 --allow-unfunded-recipient --keypair "$WORK/deployer.json" --url "$LOCAL" >/dev/null
while read -r symbol mint program; do
  spl-token create-account "$mint" --owner "$VAULT" --fee-payer "$WORK/deployer.json" \
    --program-id "$program" --url "$LOCAL" >/dev/null
  echo "ok   $symbol account created"
done <<< "$MINTS"
node "$ROOT/scripts/check-escrow-treasury.mjs" --network mainnet --url "$LOCAL"

step "10. What it cost (local lamports, mainnet rent rates may differ)"
END="$(lamports "$DEPLOYER")"
node -e '
const [start, afterDeploy, end] = process.argv.slice(1).map(BigInt);
const sol = (l) => (Number(l) / 1e9).toFixed(4);
console.log(`deploy and handover: ${sol(start - afterDeploy)} SOL`);
console.log(`treasury setup:      ${sol(afterDeploy - end)} SOL`);
console.log(`left of the ${sol(start)} SOL funded: ${sol(end)} SOL`);
' "$START" "$AFTER_DEPLOY" "$END"
echo
echo "Rehearsal passed. Nothing was sent to mainnet; the throwaway keys are deleted on exit."
