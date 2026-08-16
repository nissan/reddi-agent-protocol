# Deployment Guide

## Current deployments (devnet)

**Demo target is the Quasar program set** — four programs deployed to devnet per
`config/quasar/deployments.json` (cutover 2026-05-06):

| Program | ID |
|---|---|
| Registry | `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU` |
| Escrow | `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW` |
| Reputation | `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6` |
| Attestation | `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex` |

Quasar sources live under `experiments/quasar-*`; build/test via
`bash scripts/run-quasar-program-tests.sh`.

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

### Redeploy steps

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
If rate-limited, use a pre-funded wallet from 1Password:
```bash
op read "op://OpenClaw/Devnet Faucet Keypair/credential"
```
If that item doesn't exist, request smaller amounts:
```bash
solana airdrop 1 <wallet> --url devnet
```

### MagicBlock PER

The TEE endpoint (`devnet-tee.magicblock.app`) is intermittent. If unreachable, `demo.ts` automatically falls back to L1 settlement and logs `"L1 fallback used"`. The demo works either way.
