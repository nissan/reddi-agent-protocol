#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[surfpool-onboarding] missing required command: $1" >&2
    exit 1
  fi
}

require_cmd surfpool
require_cmd solana
require_cmd npm
require_cmd node
require_cmd python3
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
    echo "[surfpool-onboarding] program-id preflight failed" >&2
    echo "[surfpool-onboarding] declare_id in $PROGRAM_SOURCE: $declared" >&2
    echo "[surfpool-onboarding] keypair address in $PROGRAM_KEYPAIR: $keypair" >&2
    echo "[surfpool-onboarding] Fix by restoring a matching escrow keypair or updating declare_id + dependent env/docs in a coordinated change." >&2
    exit 1
  fi
}

TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT_DIR/artifacts/surfpool-onboarding/$TS"
LOG_FILE="$OUT_DIR/surfpool-onboarding.log"
mkdir -p "$OUT_DIR"

PORT="${SURFPOOL_PORT:-18999}"
WS_PORT="${SURFPOOL_WS_PORT:-19000}"
RPC_URL="http://127.0.0.1:${PORT}"
SURFPOOL_LOG="$OUT_DIR/surfpool.log"
SURFPOOL_PID=""

cleanup() {
  if [ -n "$SURFPOOL_PID" ] && kill -0 "$SURFPOOL_PID" >/dev/null 2>&1; then
    kill "$SURFPOOL_PID" >/dev/null 2>&1 || true
    wait "$SURFPOOL_PID" 2>/dev/null || true
  fi
  local pids
  pids="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
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
    echo "[surfpool-onboarding] >>> $label"
    "$@"
  } 2>&1 | tee -a "$LOG_FILE"

  local code=${PIPESTATUS[0]}
  if [ "$code" -ne 0 ]; then
    echo "[surfpool-onboarding] FAIL: $label (code=$code)" | tee -a "$LOG_FILE"
    exit "$code"
  fi
}

{
  echo "[surfpool-onboarding] starting onboarding attestation lane"
  echo "[surfpool-onboarding] output: $OUT_DIR"
  echo "[surfpool-onboarding] rpc: $RPC_URL"
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
    echo "[surfpool-onboarding] Surfpool RPC did not become ready" | tee -a "$LOG_FILE"
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

run_step "Submit onboarding attestation on-chain (Surfpool)" bash -lc "
  set -euo pipefail
  RPC_URL='${RPC_URL}' node <<'NODE' | tee '${OUT_DIR}/06-onboarding-attestation.log'
(async () => {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const { execSync } = require('child_process');
  const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } = require('@solana/web3.js');

  const rpcUrl = process.env.RPC_URL;
  const envPath = path.resolve('packages/demo-agents/.env.devnet');
  const envText = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    env[line.slice(0, idx)] = line.slice(idx + 1);
  }

  function kpFromEnv(name) {
    if (!env[name]) throw new Error(name + ' missing in .env.devnet');
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env[name])));
  }

  const agentA = kpFromEnv('AGENT_A_KEYPAIR');
  const agentC = kpFromEnv('AGENT_C_KEYPAIR');
  const programAddress = execSync('solana address -k target/deploy/escrow-keypair.json').toString().trim();
  const escrowProgramId = new PublicKey(programAddress);

  const conn = new Connection(rpcUrl, 'confirmed');
  const jobId = crypto.randomBytes(16);

  const [attestPda] = PublicKey.findProgramAddressSync([Buffer.from('attestation'), jobId], escrowProgramId);
  const [judgeAgentPda] = PublicKey.findProgramAddressSync([Buffer.from('agent'), agentC.publicKey.toBytes()], escrowProgramId);

  const disc = crypto.createHash('sha256').update('global:attest_quality').digest().subarray(0, 8);
  const scores = [8, 8, 8, 8, 8];
  const data = Buffer.alloc(8 + 16 + 5 + 32);
  let o = 0;
  disc.copy(data, o); o += 8;
  jobId.copy(data, o); o += 16;
  for (const s of scores) data.writeUInt8(s, o++);
  Buffer.from(agentA.publicKey.toBytes()).copy(data, o);

  const ix = new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      { pubkey: attestPda, isSigner: false, isWritable: true },
      { pubkey: judgeAgentPda, isSigner: false, isWritable: false },
      { pubkey: agentC.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = agentC.publicKey;
  tx.add(ix);
  tx.sign(agentC);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, 'confirmed');

  const acct = await conn.getAccountInfo(attestPda, 'confirmed');
  if (!acct) throw new Error('attestation PDA account missing after tx');

  console.log(JSON.stringify({
    ok: true,
    signature: sig,
    attestationPda: attestPda.toBase58(),
    judgeAgentPda: judgeAgentPda.toBase58(),
    consumer: agentA.publicKey.toBase58(),
    programId: escrowProgramId.toBase58(),
  }, null, 2));
})();
NODE
"

{
  echo "# Surfpool Onboarding Attestation Summary"
  echo ""
  echo "- Timestamp: $TS"
  echo "- RPC: $RPC_URL"
  echo "- Program ID: ${PROGRAM_ID}"
  echo "- Scenario: onboarding attestation instruction submitted on local Surfpool ✅"
  echo ""
  echo "## Artifacts"
  echo "- Main log: $LOG_FILE"
  echo "- Surfpool log: $SURFPOOL_LOG"
  echo "- Deploy log: $OUT_DIR/03-deploy.log"
  echo "- Register log: $OUT_DIR/05-register.log"
  echo "- Attestation log: $OUT_DIR/06-onboarding-attestation.log"
} > "$OUT_DIR/SUMMARY.md"

echo "[surfpool-onboarding] complete: $OUT_DIR/SUMMARY.md" | tee -a "$LOG_FILE"
