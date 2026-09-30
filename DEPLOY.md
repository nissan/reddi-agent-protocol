# Deployment Guide

Status: historical/reference deployment notes. This guide does not authorize redeployments, live funds, mainnet, custody, or public production claims.

## Current deployments (devnet)

**The recorded Quasar devnet program set is blocked.** `config/quasar/deployments.json`
owns those four program ids and their status; it records `submissionReady: false`
because the deployed binaries predate the job-binding rework and no longer match the
in-repo client. Requesting the Quasar target outside `local-surfpool` is refused before
any instruction, signer, or RPC call. No redeploy is authorized or performed here.

Quasar sources live under `experiments/quasar-*`; build/test via
`bash scripts/run-quasar-program-tests.sh`, and validate current sources locally with
the lane in `docs/SURFPOOL-QUASAR-CRITICAL-SDK-LANE.md`.

## Legacy Anchor reference program

**Deployed ID:** `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD` (historical
comparison only — must not be used as the demo target). This ID is set in
`packages/demo-agents/src/config.ts` (`defaultEscrowProgramId`) and
`config/networks/devnet.json`.

> Note: the `77rkRQxe…UZXmX` ID that appears in some older `declare_id!`
> macros and stale docs predates the current deployment — ignore it.

### When to redeploy

Redeploy the legacy Anchor program if:
- On-chain program changes are made (any `programs/escrow/src/` edits)
- The program account runs out of rent (unlikely for demo scale)
- A fresh devnet keypair is needed

### Historical redeploy steps

Do not run these steps without explicit operator approval. They can spend devnet SOL, change public devnet state, or create generated key material.

```bash
# 1. Build (ignore-keys skips keygen for deterministic build)
anchor build --ignore-keys

# 2. Deploy — this prints the new program ID
anchor deploy --provider.cluster devnet

# 3. Update config with the new ID
# Edit: packages/demo-agents/src/config.ts → ESCROW_PROGRAM_ID
# Edit: Anchor.toml → [programs.devnet] escrow = "<new-id>"

# 4. Fund agent wallets (if fresh wallets needed)
npx ts-node packages/demo-agents/src/fund-agents.ts

# 5. Register agents on-chain
npx ts-node packages/demo-agents/src/register-agents.ts

# 6. Run the full demo
npx ts-node packages/demo-agents/src/demo.ts
```

### Agent wallet addresses (current devnet)

| Agent | Role | Public key |
|---|---|---|
| Agent A | Orchestrator | `AjAPTMjZbsJbeXmdBGzMADWkFixRvVw3mKt8sp99mVCe` |
| Agent B | Primary Specialist | `78DhERomBE36WYyd5YcKKDvNpptD5WhEfUmar3LqPeVj` |
| Agent C | Attestation Judge | `7XW2SbWWp2R38WFRrhZJDS9A991kTSjcoYNSK2nX3zoq` |

Private keys are in `packages/demo-agents/.env.devnet` (gitignored).
See `.env.devnet.example` for the required format.

### Airdrop rate limits

Devnet airdrop is rate-limited to ~2 SOL per request, ~2 requests per day per address.
If rate-limited, stop and request operator guidance instead of reaching for shared or pre-funded wallet material. For approved devnet-only testing, prefer smaller faucet requests such as:
```bash
solana airdrop 1 <wallet> --url devnet
```

### MagicBlock PER

The TEE endpoint (`devnet-tee.magicblock.app`) has been intermittent in historical testing. Treat MagicBlock/PER behavior here as reference evidence only, not a production settlement or privacy guarantee.
