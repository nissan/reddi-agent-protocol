# Devnet Deployment Guide

## Status

The program was deployed to devnet during Phase 6, but the original `.so` was built with a
placeholder `declare_id!` value. The devnet airdrop was rate-limited before the corrected
binary could be uploaded.

**Current deployed address:** `77rkRQxe4GRzHU56H6JuWPFe27g4NoRBz4GGftuUZXmX` ← needs redeployment

## One-time setup (Nissan runs this once with funded wallet)

```bash
# 1. Fund the upgrade authority wallet (blitz-dev needs ~3 SOL)
solana airdrop 2 d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR --url devnet
solana airdrop 2 d4ST3N4Vkio1Xsg2NaF6Zox7Xq8MdqWihvyip9AHioR --url devnet

# 2. Sync program ID from keypair and rebuild
~/.avm/bin/anchor keys sync
~/.avm/bin/anchor build

# 3. Deploy (the keypair at target/deploy/escrow-keypair.json determines the address)
~/.avm/bin/anchor deploy --provider.cluster devnet

# 4. Update ESCROW_PROGRAM_ID in packages/demo-agents/src/config.ts with new address

# 5. Fund agent wallets
solana airdrop 1 AjAPTMjZbsJbeXmdBGzMADWkFixRvVw3mKt8sp99mVCe --url devnet  # Agent A
solana airdrop 1 78DhERomBE36WYyd5YcKKDvNpptD5WhEfUmar3LqPeVj --url devnet  # Agent B
solana airdrop 1 7XW2SbWWp2R38WFRrhZJDS9A991kTSjcoYNSK2nX3zoq --url devnet  # Agent C

# 6. Register agents
cd packages/demo-agents && npm run register

# 7. Run the demo
npm run demo

# Step 4 settlement route. PER settlement is skipped: PER tracking instructions
# (delegate_escrow, release_escrow_per) are not in the V1 program build (post-V1, issue #839).
# auto (default): prints that PER was skipped, then releases on L1
DEMO_SETTLEMENT_MODE=auto npm run demo

# magicblock_per: refused with the same message; nothing is sent
DEMO_SETTLEMENT_MODE=magicblock_per npm run demo

# Steps 6-8 (commit/reveal ratings, judge attestation) are skipped on the default target:
# the V1 program ties them to an escrow opted in at lock (open_rating), which this script
# does not do yet (issue #842).

# private routing contract knobs (MagicBlock ONE-style semantics)
DEMO_SETTLEMENT_MODE=auto DEMO_PRIVATE_MIN_DELAY_MS=1000 DEMO_PRIVATE_MAX_DELAY_MS=5000 DEMO_PRIVATE_SPLIT=3 npm run demo

# enable mint-readiness preflight for private route
DEMO_SETTLEMENT_MODE=auto DEMO_PRIVATE_MINT=<mint-pubkey> DEMO_PAYMENTS_CLUSTER=devnet npm run demo

# strict mode: fail demo if mint is not initialized
DEMO_SETTLEMENT_MODE=auto DEMO_PRIVATE_MINT=<mint-pubkey> DEMO_REQUIRE_MINT_READY=true npm run demo

# print initialize-mint JSON + ready curl command
DEMO_PRIVATE_MINT=<mint-pubkey> npm run mint:init-helper

# force public L1 settlement
DEMO_SETTLEMENT_MODE=public npm run demo

# note: vanish_core is tracked as swap privacy route in plugin flow,
# this escrow-release demo releases on the public rail
DEMO_SETTLEMENT_MODE=vanish_core npm run demo
```

## Agent wallets (pre-generated, each funded with 0.025 SOL from blitz-dev)

| Role | Pubkey |
|---|---|
| Agent A (Orchestrator) | `AjAPTMjZbsJbeXmdBGzMADWkFixRvVw3mKt8sp99mVCe` |
| Agent B (Specialist/Primary) | `78DhERomBE36WYyd5YcKKDvNpptD5WhEfUmar3LqPeVj` |
| Agent C (Judge/Attestation) | `7XW2SbWWp2R38WFRrhZJDS9A991kTSjcoYNSK2nX3zoq` |

Private keys in `.env.devnet` (gitignored — back this up separately).

## Timing

Demo targets < 10s end-to-end for the steps it runs.
Devnet latency (~400–600ms per confirmation) is the bottleneck, not instruction encoding.
