# Quasar Devnet Validation Runbook — 2026-05-06

> **Historical record:** This dated runbook records a completed former process and is not current operator guidance. The four Quasar devnet/PER scripts named in the current freeze document now refuse unconditionally before SDK, signer, RPC, or transaction work. No prior approval described below can enable them. The separate demo-agent commands recorded here remain outside that four-entrypoint control and are not authorized by this document.

## Purpose

Record the formerly approval-gated step after local Surfpool confidence: read-only registry inspection first, then explicitly approved devnet signing for Quasar demo-agent registration and optional legacy cleanup.

## Current read-only findings

Checked against `https://api.devnet.solana.com` at `2026-05-05T20:53:42Z`.

### Legacy Anchor program

Program: `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`

| Agent | Owner | Agent PDA | Exists | Lamports | Data length |
| --- | --- | --- | --- | ---: | ---: |
| A | `AjAPTMjZbsJbeXmdBGzMADWkFixRvVw3mKt8sp99mVCe` | `7wYS7G2L9VQMuSmPVvB3c8qwLKmABmnEwvE7pUDgMVkH` | yes | 1934880 | 150 |
| B | `78DhERomBE36WYyd5YcKKDvNpptD5WhEfUmar3LqPeVj` | `ET155YLD2UFcSd56pQZWbR9zMfgqhrAegCho3UnniLZ7` | yes | 1934880 | 150 |
| C | `7XW2SbWWp2R38WFRrhZJDS9A991kTSjcoYNSK2nX3zoq` | `CSZ4nza8P17S4S8YqG1t4rwvwRqhiSPWstXgaBDzT5ch` | yes | 1934880 | 150 |

### Quasar program

Program: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`

| Agent | Owner | Agent PDA | Exists | Lamports | Data length |
| --- | --- | --- | --- | ---: | ---: |
| A | `AjAPTMjZbsJbeXmdBGzMADWkFixRvVw3mKt8sp99mVCe` | `8pXm6NN2MSVxZuXi8JYAx4kyTaRByTenCGCcAzV5Xs82` | no | 0 | 0 |
| B | `78DhERomBE36WYyd5YcKKDvNpptD5WhEfUmar3LqPeVj` | `HJQeU7eG2BSyhUEczTmCEFLPpJX5cphZtQmGJvH1uTpX` | no | 0 | 0 |
| C | `7XW2SbWWp2R38WFRrhZJDS9A991kTSjcoYNSK2nX3zoq` | `3fNMku8qtrDaxPu74izXWyXTVencAGBH89bGuXNYCkJr` | no | 0 | 0 |

## Local validation completed before this runbook

- `npm run smoke:economic-demo:surfpool` — PASS; artifact `artifacts/economic-demo-surfpool-rehearsal/20260505T205134Z/SUMMARY.md`.
- `npm run test:surfpool:critical` — PASS; artifact `artifacts/surfpool-smoke/20260506-065203/SUMMARY.md`.
- `npx jest --runTestsByPath lib/__tests__/demo-agent-registration-instruction.test.ts lib/__tests__/quasar-instructions.test.ts --runInBand` — PASS.
- `npm run build` — PASS.
- `npm run check:quasar:submission` — PASS.

## Approval boundary

Do not run the commands below unless Nissan explicitly approves this runbook or the exact command block.

These commands may sign and submit devnet transactions from `packages/demo-agents/.env.devnet` wallets. They may mutate devnet program state and spend devnet SOL fees. They must not use mainnet, paid providers, production env mutation, or live PER/TEE.

## Proposed approved command block

```bash
cd /Users/loki/.openclaw/workspace/projects/reddi-agent-protocol-code/packages/demo-agents

# 1) Register A/B/C under Quasar devnet program.
NETWORK_PROFILE=devnet \
HACKATHON_DEMO_TARGET=quasar \
DEMO_PROGRAM_TARGET=quasar \
NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar \
npm run register

# 2) Re-run read-only registry inspection from repo root and save output.
cd /Users/loki/.openclaw/workspace/projects/reddi-agent-protocol-code
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/check-devnet-agent-pdas.ts
```

## Optional legacy cleanup block

Only run if Nissan confirms we should close old Anchor demo registrations. Keeping them is low risk because Quasar mode derives different PDAs under a different program ID; cleanup is mostly to avoid demo/operator confusion.

```bash
cd /Users/loki/.openclaw/workspace/projects/reddi-agent-protocol-code/packages/demo-agents

# Deregister A/B/C from the legacy Anchor devnet program.
NETWORK_PROFILE=devnet \
HACKATHON_DEMO_TARGET=legacy-anchor \
DEMO_PROGRAM_TARGET=legacy-anchor \
NEXT_PUBLIC_DEMO_PROGRAM_TARGET=legacy-anchor \
npm run deregister
```

## Expected success evidence

- Three Quasar register transaction signatures.
- Quasar PDAs exist for A/B/C under `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`.
- Optional: legacy Anchor PDAs no longer exist if cleanup is approved.
- No claim of live PER/TEE unless a separate live PER approval/runbook is approved and executed.

## Retrospective gate after approval run

After any approved devnet mutation:

1. Save transaction signatures and PDA readbacks in an artifact directory.
2. Run `npm run check:quasar:submission`.
3. Run a web-app build or smoke for Quasar target mode.
4. Update `STATUS.md`, this runbook, and the BDD playbook with observed result and next demo-recording step.

## 2026-05-06 execution result — Quasar Registry registration complete

Nissan approved devnet transactions needed for the Quasar cutover goal. Execution found and fixed one important plan/config issue: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW` is the Quasar Escrow program, not the Quasar Registry program. Sending `register_agent` there failed before Agent A registration with `insufficient account keys for instruction`.

Correct Quasar devnet program inventory:

- Escrow: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`
- Registry: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
- Reputation: `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`
- Attestation: `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`

Registration command used after correction:

```bash
NETWORK_PROFILE=devnet \
HACKATHON_DEMO_TARGET=quasar \
DEMO_PROGRAM_TARGET=quasar \
NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar \
npm run register
```

Successful Quasar Registry devnet txs:

- Agent A / Orchestrator: `iLudQFTyJ7c7mpzDxWMZaLEptmv1H3eM7NtfmSULLi6FTQKkaKvEJeE3hFn5Tf3YQEEvvhJcX7nvJucjyE8eghX`
- Agent B / Primary Specialist: `2KnvFgTm3ivqis5iFAxpyX4TkH1Zbyv2sfv975MtT6Be39kTy8mabRmf9jWXJekVY22NLKaR3cAb9dVsC8oFcFMi`
- Agent C / Attestation Judge: `46H43gGDZFvWL9oLzg1iNXTdweuihmbp9DH2fKhHdpeJKdxywUKsFdTkna8XxeyKeXhsZ53ykbPjLzQ9AotGGeS9`

Readback artifact:

- `artifacts/quasar-devnet-registration/20260505T211525Z/SUMMARY.md`
- `artifacts/quasar-devnet-registration/20260505T211525Z/pda-readback.json`

Readback summary: all three Quasar Registry PDAs exist with data length `153`, matching the Quasar `AgentAccount` layout.

Local validation after fix:

- `npm run check:quasar:submission` — PASS
- Focused Quasar/register Jest suite — PASS, 14/14
- `npm run build` — PASS (existing workspace-root/NFT trace warnings only)
