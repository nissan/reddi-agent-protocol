# Quasar Scoped Judge Proof

> **Dated historical campaign record — superseded 2026-10-02.** This packet, including its target, deployment, command, and judge-copy claims, is preserved as 2026-05-06 campaign evidence, not current guidance or proof. Quasar is frozen and its recorded deployment is blocked. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

_Date:_ 2026-05-06 AEST  
_Issue:_ #236  
_Status:_ Scoped Quasar proof packet; no signing, deployment, wallet mutation, env mutation, devnet transfer, or paid/live provider calls performed.

## Proof boundary

The hackathon-facing proof boundary is now **scoped Quasar proof**, not legacy Anchor full-flow/PER proof.

Included in the Quasar proof boundary:

1. Quasar devnet program target selection through `config/quasar/deployments.json` and runtime network config.
2. Quasar registry instruction construction and account decoding.
3. Quasar reputation commit/reveal instruction construction.
4. Quasar attestation instruction construction, confirmation, and dispute construction.
5. `/register`, `/economic-demo`, onboarding, registry read paths, and demo-agent registration helpers selecting Quasar-compatible builders in explicit Quasar mode.
6. CI/readiness guard `npm run check:quasar:submission`.

Explicitly outside the proof boundary unless Nissan approves a live validation run:

1. Live MagicBlock PER/TEE execution.
2. Any devnet signing, transaction send, wallet mutation, or transfer.
3. Paid/live specialist, research, image generation, or provider calls.
4. The legacy `packages/demo-agents/src/demo.ts` full-flow/PER script as Quasar proof; it now fails closed when selected with a Quasar target.

## Three cutover questions

### 1. Which Quasar program ID is used?

Devnet Quasar candidate program:

```text
VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW
```

This is selected by explicit Quasar target flags:

```bash
NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar
HACKATHON_DEMO_TARGET=quasar
DEMO_PROGRAM_TARGET=quasar
```

Legacy Anchor reference:

```text
794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD
```

The legacy Anchor reference is retained only for comparison/history and must not be presented as final hackathon proof.

### 2. What proves it is deployed and relevant?

Deployment inventory:

- `config/quasar/deployments.json`

Read-only RPC evidence:

- `solana account VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW --url https://api.devnet.solana.com`
- Result recorded in inventory: executable program account, owner `BPFLoaderUpgradeab1e11111111111111111111111`

Parity and scope evidence:

- `docs/verifiable-agent-protocol/colosseum-frontier-2026-04/QUASAR-REGISTRY-PARITY-REPORT.md`
- `docs/verifiable-agent-protocol/colosseum-frontier-2026-04/QUASAR-REPUTATION-PARITY-REPORT.md`
- `docs/verifiable-agent-protocol/colosseum-frontier-2026-04/QUASAR-ATTESTATION-PARITY-REPORT.md`
- `docs/verifiable-agent-protocol/colosseum-frontier-2026-04/QUASAR-PER-PARITY-REPORT.md`

Runtime guard evidence:

```bash
npm run check:quasar:runtime-compatibility
npm run check:quasar:deployments
npm run check:quasar:demo-readiness
npm run check:quasar:submission
```

### 3. What fails if the demo falls back to Anchor?

- Quasar target tests verify Quasar ID selection and legacy Anchor separation.
- `npm run check:quasar:runtime-compatibility` audits demo-critical paths and fails if any are `anchor-layout-only` or `blocked-pending-quasar-port`.
- `packages/demo-agents/src/demo.ts` throws immediately when a Quasar target is selected because it is legacy full-flow/PER proof material, not scoped Quasar proof.
- `/economic-demo` includes a Solana program target card so operators can narrate Quasar target, readiness, and limitations without implying live settlement.

## Recommended judge wording

> Reddi Agent Protocol’s hackathon demo targets Quasar-deployed Solana programs. The scoped proof shows Quasar program target selection, Quasar-compatible registry/reputation/attestation transaction construction, target-aware registry account decoding, and readiness guards that prevent accidental fallback to legacy Anchor proof. Live PER/TEE settlement is not claimed in this packet; it remains approval-gated for a separate live validation run.

## Validation snapshot

Latest local validation for this packet:

```bash
npm run build
npx jest --runTestsByPath lib/__tests__/quasar-instructions.test.ts lib/__tests__/quasar-agent-account-decoder.test.ts lib/__tests__/quasar-demo-agent-guard.test.ts --runInBand
npm run check:quasar:submission
npm run test:bdd:index
git diff --check
```

Expected state after Phase 11:

- Runtime compatibility: zero blocker-status demo-critical paths.
- Deployment/readiness checks: pass for scoped proof metadata.
- Live PER/TEE proof: not claimed.
