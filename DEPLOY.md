# Deployment Guide

Status: historical/reference deployment notes. This guide does not authorize redeployments, live funds, mainnet, custody, or public production claims. Stable Anchor `1.1.2` is the authoritative source reference. Quasar is frozen historical experimental evidence and is not a deployment candidate; see [`docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](docs/QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

## Current deployments (devnet)

**The recorded Quasar devnet program set is blocked.** `config/quasar/deployments.json`
owns those four program ids and their status; it records `submissionReady: false`
because the deployed binaries predate the job-binding rework and no longer match the
in-repo client. Requesting the Quasar target outside `local-surfpool` is refused before
any instruction, signer, or RPC call. No redeploy is authorized or performed here.

Quasar sources under `experiments/quasar-*`, vendored framework code, historical
operator scripts, and the local Surfpool lane are retained only for historical
reproducibility. Direct operator use is an explicit experimental opt-in, not a product
or promotion step. The hosted Quasar Surfpool workflow still invokes the local lane
automatically for its existing broad path filters; this preserved regression role is
not product adoption or benchmark evidence. Do not manually run the historical build,
validator, smoke, deployment, signing, or RPC procedures without a new authorization
that supersedes the freeze.

## V1 program source (from 21 November 2026)

The V1 program is the Pinocchio program in `programs/pinocchio-escrow/` (owner decision,
21 November 2026). It keeps the Anchor program's wire contract and declares the same
program ID. It runs on devnet (record below) and is not on mainnet. The release binary is
the artifact of the container build (`.github/workflows/escrow-verifiable-build.yml`, library
`pinocchio_escrow`). Any deploy or upgrade needs the owner's explicit approval.

## V1 escrow program (devnet)

Upgraded in place on devnet on 21 November 2026 with owner approval, to the Pinocchio
program with ratings and judge attestations: commit `2b7e2c1` (program source as at
`b71a91e`), container build with `--features devnet`. Devnet only: nothing is deployed to
mainnet, and this record is not an audit, production or mainnet readiness claim.

| Field | Value |
|---|---|
| Program ID | `DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu` |
| Upgrade authority (devnet) | `hbr2Fee3ewDbm33wTDrdEF3e7byNCzNgQ57CwJWaPtt` (managed deployer key) |
| ProgramData address | `8cCmxnMPU8EQR7ECfff19Dr4gu1n7jyFCuEEyaYspRn2` (337,760 bytes reserved, kept from the first deploy) |
| Upgraded in slot | 524707788 |
| Upgrade signature | `5FMKo1K8ufkxB9SHzDCghnA4EXWm2gRaDS3esLoq3LMJPTrEAFHjeNMAsTpTSrUQZsKa5mUCaiJJu2Z1qEzZSR4t` |
| Build | `solana-verify` 0.5.2, image `solanafoundation/solana-verifiable-build:4.2.2` |
| Executable hash (`solana-verify get-executable-hash`, read back from devnet) | `10e986fe1b1e619fff02b2120fcc9c47bd373677526b8f386095360bb15b0e7b`, same as CI run 44900313151 |
| File size and SHA-256 | 96,272 bytes, `2576a9cccb15ea09aa675e1a2d415043f8d231179772e5fa23728402b10a32ac` |

Escrow accounts written by the earlier Anchor build (149 and 203 bytes) cannot be read by
this build; the four left open by e2e run v3 were abandoned (owner decision).

Earlier on 21 November 2026 the same ID was first deployed from commit `8c21aee` (the
Anchor program, now under `archive/anchor-escrow`, built on macOS; slot 524536326,
337,760 bytes, SHA-256 `5055df469642a3429c524a312b129c7e9b7cb6fdbeb37fa2e8275ab87b8e142a`).
A host build embeds host paths, so compare a host build only with a hash from the same
host; the container build gives the same hash anywhere.

This ID is set in `programs/pinocchio-escrow/program/src/lib.rs`, `archive/anchor-escrow/src/lib.rs` (`declare_id!`), `Anchor.toml`,
`packages/demo-agents/src/config.ts` (`defaultEscrowProgramId`) and
`config/networks/devnet.json`. Both key files are held by the owner; agents use them by
path only and never read them.

## Legacy Anchor reference program

**Earlier devnet ID:** `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD` (historical only).
Its upgrade key is no longer available, so that deployment cannot be changed and must not
be used as a target. `config/networks/mainnet.json` still carries it as a not-deployed
placeholder.

> Note: the `77rkRQxe…UZXmX` ID that appears in some older `declare_id!`
> macros and stale docs predates the current deployment — ignore it.

### When to redeploy

Redeploy the legacy Anchor program if:
- On-chain program changes are made (any `archive/anchor-escrow/src/` edits)
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
