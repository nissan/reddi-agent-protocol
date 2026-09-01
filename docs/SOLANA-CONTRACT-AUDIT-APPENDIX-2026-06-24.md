# Solana Contract Audit Appendix

Date: 2026-06-24

Issue: #531

> **Readiness reconciliation note (2026-08-31):** this appendix predates the
> job-binding series (#642-#645). Current main uses `experiments/quasar-escrow`
> as the owner-checked escrow boundary for reputation/attestation; the PER crate
> remains a separate MagicBlock proof lane unless a later approved issue reselects
> it.

Inputs:

- #526 / PR #527 Solana contract audit-readiness evidence pack.
- #388 Solana/Quasar rail boundary.
- #441 Quasar/Surfpool/devnet promotion checklist.
- #508 package/read-model boundary guard.

## Scope Boundary

This appendix is an audit handoff artifact. It records program ids, instruction
interfaces, account/PDA surfaces, client builders, and proof scripts that need
review before any grant-facing Solana contract audit claim.

This appendix does not deploy programs, build transactions, start Surfpool or
devnet, call RPC, use wallets, activate live payments, publish packages, mutate
trust/reputation state, claim mainnet readiness, claim custody expansion, or
claim settlement finality.

## Active Program Targets

### Quasar Registry

- Source path: `experiments/quasar-registry`
- Source files:
  - `experiments/quasar-registry/src/lib.rs`
  - `experiments/quasar-registry/src/state.rs`
- Program id in source: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
- Purpose: SOL-native agent registry parity surface.
- Instructions:
  - `register`: discriminator `0`
  - `update`: discriminator `1`
  - `deregister`: discriminator `2`
- Accounts:
  - `AgentAccount`: discriminator `20`
- PDA seeds:
  - `AgentAccount`: `[b"agent", owner]`
- Signer/writable expectations:
  - owner signs register/update/deregister paths;
  - agent PDA is writable;
  - register includes incinerator and system program accounts.
- Layout notes:
  - fixed `[u8; 64]` model bytes plus `model_len`;
  - `rate_lamports` is `u64`;
  - reputation and attestation fields must remain compatible with reputation and
    attestation modules.

### Quasar Attestation

- Source path: `experiments/quasar-attestation`
- Source files:
  - `experiments/quasar-attestation/src/lib.rs`
  - `experiments/quasar-attestation/src/state.rs`
- Program id in source: `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`
- Purpose: attestation judge records and consumer resolution.
- Instructions:
  - `register`: discriminator `0`
  - `attest`: discriminator `1`
  - `confirm`: discriminator `2`
  - `dispute`: discriminator `3`
- Accounts:
  - `AgentAccount`: discriminator `20`
  - `AttestationAccount`: discriminator `40`
- PDA seeds:
  - `AgentAccount`: `[b"agent", owner]`
  - `AttestationAccount`: `[b"attestation", job_id]`
- Signer/writable expectations:
  - judge signs `attest`;
  - consumer signs `confirm` and `dispute`;
  - attestation PDA is writable;
  - judge agent account is read for attest and writable for confirm/dispute.
- Layout notes:
  - `job_id` is `[u8; 16]` stored from a `u128` seed;
  - `scores` is `[u8; 5]` with valid score range 1-10;
  - `confirmed` is a `u8` sentinel: `0=pending`, `1=confirmed`,
    `2=disputed`.

### Quasar Reputation

- Source path: `experiments/quasar-reputation`
- Source files:
  - `experiments/quasar-reputation/src/lib.rs`
  - `experiments/quasar-reputation/src/state.rs`
- Program id in source: `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`
- Purpose: blind commit-reveal reputation records.
- Instructions:
  - `register`: discriminator `0`
  - `commit`: discriminator `1`
  - `reveal`: discriminator `2`
  - `expire`: discriminator `3`
- Accounts:
  - `AgentAccount`: discriminator `20`
  - `RatingAccount`: discriminator `30`
- PDA seeds:
  - `AgentAccount`: `[b"agent", owner]`
  - `RatingAccount`: `[b"rating", job_id]`
- Signer/writable expectations:
  - consumer or specialist signs commit/reveal/expire according to role;
  - rating PDA is writable;
  - consumer and specialist agent accounts are writable during reveal/update
    paths.
- Layout notes:
  - `job_id` is `[u8; 16]` stored from a `u128` seed;
  - commitments are `[u8; 32]`;
  - scores use `0` as unrevealed sentinel and `1..=10` as valid values;
  - `state` is a `u8` lifecycle sentinel.

### Quasar Escrow PER

- Current boundary: MagicBlock PER proof lane; not the escrow owner accepted by
  `quasar-escrow-ref` for current reputation/attestation job binding.
- Source path: `experiments/quasar-escrow-per`
- Source files:
  - `experiments/quasar-escrow-per/src/lib.rs`
  - `experiments/quasar-escrow-per/src/state.rs`
- Program id in source: `7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb`
- Purpose: MagicBlock PER-specific SOL escrow and self-custodied agent vault
  proof of concept.
- Instructions:
  - `make`: discriminator bytes `[81,80,69,82,76,79,67,75]`
  - `take`: discriminator bytes `[81,80,69,82,84,65,75,69]`
  - `refund`: discriminator bytes `[81,80,69,82,82,69,70,68]`
  - `delegate_per`: discriminator bytes `[81,80,69,82,68,69,76,71]`
  - `commit_undelegate_per`: discriminator bytes `[81,80,69,82,67,77,73,84]`
  - `prepare_agent_vault`: discriminator bytes `[81,80,69,82,86,65,76,84]`
  - `delegate_agent_vault_per`: discriminator bytes `[81,80,69,82,86,68,69,76]`
  - `commit_agent_vault_per`: discriminator bytes `[81,80,69,82,86,67,77,84]`
  - `commit_agent_vault_magic_intent_per`: discriminator bytes `[81,80,69,82,86,77,65,71]`
  - `take_to_agent_vault`: discriminator bytes `[81,80,69,82,86,84,65,75]`
  - `prepare_vault_credit_intent`: discriminator bytes `[81,80,69,82,86,73,78,84]`
  - `private_take_to_agent_vault`: discriminator bytes `[81,80,69,82,86,80,82,86]`
  - `withdraw_agent_vault`: discriminator bytes `[81,80,69,82,86,87,68,82]`
  - `undelegate_callback`: discriminator bytes `[196,28,41,206,48,37,51,167]`
- Accounts:
  - `UserEscrowCounter`: discriminator `9`
  - `EscrowAccount`: discriminator `10`
  - `AgentVault`: discriminator `11`
- PDA seeds:
  - `UserEscrowCounter`: `[b"counter", payer]`
  - `EscrowAccount`: `[b"escrow", payer, escrow_id]`
  - `AgentVault`: `[b"agent_vault", authority]`
- Signer/writable expectations:
  - payer signs escrow lock/release/refund/delegate paths;
  - agent authority signs vault withdraw/delegate paths;
  - escrow, counter, vault, permission, delegation, and metadata PDAs are
    writable according to the PER instruction.
- Layout notes:
  - custody state is SOL lamports only;
  - `EscrowAccount.status` is `0=locked`, `1=released`, `2=cancelled`;
  - `AgentVault.status` is `0=active`;
  - PER callback must restore the committed agent-vault PDA bytes and ownership.

### Quasar Escrow Legacy POC

- Current boundary: despite this historical heading, current main reselects this
  program as the canonical job record owner for reputation/attestation job
  binding via `quasar-escrow-ref`.
- Source path: `experiments/quasar-escrow`
- Source files:
  - `experiments/quasar-escrow/src/lib.rs`
  - `experiments/quasar-escrow/src/state.rs`
- Program id in source: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`
- Purpose: SOL-native escrow parity POC for lock/release/cancel and current
  canonical job record owner on main after the job-binding series.
- Status: active for current reputation/attestation job binding; the heading is
  retained only to avoid breaking historical checker anchors before the audit
  packet is fully re-frozen.
- Instructions:
  - `make`: discriminator `0`
  - `take`: discriminator `1`
  - `refund`: discriminator `2`
- Accounts:
  - `UserEscrowCounter`: discriminator `9`
  - `EscrowAccount`: discriminator `10`
- PDA seeds:
  - `UserEscrowCounter`: `[b"counter", payer]`
  - `EscrowAccount`: `[b"escrow", payer, escrow_id]`

## Legacy Anchor Reference

- Source path: `programs/escrow`
- Source files:
  - `programs/escrow/src/lib.rs`
  - `programs/escrow/src/state.rs`
- Program id in source: `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`
- Status: reference implementation and parity oracle.
- Instructions:
  - SOL escrow: `lock_escrow`, `release_escrow`, `cancel_escrow`
  - registry: `register_agent`, `update_agent`, `deregister_agent`
  - reputation: `commit_rating`, `reveal_rating`, `expire_rating`
  - MagicBlock PER reference: `delegate_escrow`, `release_escrow_per`
  - attestation: `attest_quality`, `confirm_attestation`, `dispute_attestation`
- Accounts:
  - `EscrowAccount`
  - `AgentAccount`
  - `RatingAccount`
  - `AttestationAccount`
- Audit use:
  - compare parity behavior and known deltas;
  - do not present Anchor as the active deployment target without a fresh
    roadmap decision.

## Active Client And Instruction Builders

- `lib/quasar/instruction-builders.ts`
  - Builds Quasar instruction data bytes for registry, reputation, and
    attestation paths.
  - Audit focus: discriminator constants, byte order, fixed field lengths,
    job-id encoding, score validation, commitment/salt lengths, and model length
    checks.
- `lib/quasar/instructions.ts`
  - Builds Quasar `TransactionInstruction` objects and PDAs for registry,
    reputation, and attestation paths.
  - Audit focus: account metas, signer/writable flags, system program use,
    incinerator account use, PDA derivation, and program id routing.
- `lib/register/registration-instruction.ts`
  - Routes app registration between Quasar and legacy Anchor targets.
  - Audit focus: target switching, owner signer requirements, agent PDA
    derivation, fee destination, and parity with selected registry target.
- `packages/demo-agents/src/registration-instruction.ts`
  - Demo register/deregister builders for Anchor and Quasar.
  - Audit focus: duplicate encoding logic, default target config, fixture/demo
    boundary, and avoidance of production activation claims.
- `packages/per-client/src/client.ts`
  - MagicBlock PER delegation, PER release, and fallback release client paths.
  - Audit focus: keypair handling, transaction assembly, signing, blockhash
    source, TEE RPC routing, fallback RPC path, session token handling, and
    confirmation semantics.

## Scripted Proof Lanes

- `scripts/run-quasar-program-tests.sh`
  - Builds and tests Quasar program candidates.
- `scripts/check-quasar-boundary-guard.mjs`
  - Guards package/read-model lanes from unreviewed program-boundary surfaces.
- `scripts/check-quasar-runtime-compatibility.mjs`
  - Checks runtime compatibility metadata.
- `scripts/check-quasar-deployment-inventory.mjs`
  - Checks deployment inventory metadata.
- `scripts/run-quasar-per-agent-vault-delegation-smoke.mjs`
  - PER delegation proof lane.
- `scripts/run-quasar-per-agent-vault-settlement-smoke.mjs`
  - PER settlement/vault proof lane.
- `scripts/run-surfpool-critical-smoke.sh`
  - Surfpool critical smoke lane.

These scripts are evidence inputs, not approvals. This appendix does not approve transaction submission.
Anything that starts Surfpool/devnet, loads wallets, sends transactions, or deploys programs still requires the #441 promotion gate and explicit approval.

## Payment Rail Contract Relevance

- SOL:
  - Current program custody rail through lamports escrow/vault surfaces.
  - Audit scope includes authorization, PDA ownership, status transitions,
    release/refund/withdraw, cancellation windows, and PER callback behavior.
- USDC:
  - Current package/proof/helper rail, not Quasar or Anchor custody.
  - Audit scope is receipt/evidence and verifier behavior unless a later SPL
    custody issue is approved.
- AUDD:
  - Current payment-plan/proof metadata rail from #525/#528.
  - No current Quasar/Anchor/SPL custody.
  - Any AUDD custody requires a later audited custody workstream with SPL token
    account layout, mint validation, migration, tests, and explicit approval.

## Required External Audit Packet Inputs

- selected active program set and rationale;
- exact commit SHA and source tree;
- program ids from source/config;
- account/PDA/layout matrix;
- instruction ABI/discriminator list;
- active client/instruction-builder list;
- scripted proof lane list;
- threat model and trust-boundary summary;
- known blockers and product decisions;
- test/smoke evidence;
- explicit non-goals for mainnet, custody expansion, live payment, and
  settlement-finality claims.

## Validation

Run:

- `npm run check:solana:audit-appendix`
- `npm run check:rap:naming`
- `npm run check:quasar:boundary-guard -- --changed`
- `git diff --check`

If BDD docs change, also run:

- `npm run test:bdd:index`
