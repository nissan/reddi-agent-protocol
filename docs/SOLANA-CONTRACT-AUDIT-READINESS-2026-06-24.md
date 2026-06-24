# Solana Contract Audit-Readiness Evidence Pack

Date: 2026-06-24

Issue: #526

Parent gate: #524

## Decision

Reddi Agent Protocol should treat Solana contract audit-readiness as an immediate
grant-delivery gate. The current deliverable is an evidence and handoff packet,
not a deploy, audit completion claim, wallet-funded run, custody expansion, or
mainnet readiness claim.

The audit handoff scope is:

- active Quasar program candidates under `experiments/quasar-*`;
- legacy Anchor reference code under `programs/escrow`;
- package/read-model boundaries that consume Solana contract metadata without
  building, signing, submitting, or probing transactions;
- AUDD, USDC, and SOL payment-rail relevance, with AUDD kept proof-metadata /
  payment-plan only for v0.1 unless a later audited custody workstream is
  approved.

## Active Solana Program Inventory

### Quasar Registry

- Path: `experiments/quasar-registry`
- Program id in source: `Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU`
- Purpose: SOL-native agent registry parity surface.
- Instructions:
  - `register(agent_type, model_len, model_data, rate_lamports, min_reputation)`
  - `update(rate_lamports, min_reputation, active)`
  - `deregister()`
- Accounts:
  - `AgentAccount`
- PDA seeds:
  - `[b"agent", owner]`
- Contract-relevant risks:
  - registration fee burn destination;
  - model length and fixed-size model encoding;
  - owner-only update/deregister authority;
  - reputation and attestation layout compatibility with the other Quasar
    modules.

### Quasar Attestation

- Path: `experiments/quasar-attestation`
- Program id in source: `CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex`
- Purpose: SOL-native attestation judge records and consumer resolution.
- Instructions:
  - `register(...)` for test/setup parity with registry records
  - `attest(job_id, scores, consumer)`
  - `confirm(job_id)`
  - `dispute(job_id)`
- Accounts:
  - `AgentAccount`
  - `AttestationAccount`
- PDA seeds:
  - `[b"agent", owner]`
  - `[b"attestation", job_id]`
- Contract-relevant risks:
  - judge role eligibility;
  - score range validation;
  - duplicate attestation prevention;
  - consumer-only confirm/dispute authority;
  - attestation accuracy reward and dispute penalty.

### Quasar Reputation

- Path: `experiments/quasar-reputation`
- Program id in source: `nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6`
- Purpose: SOL-native blind commit-reveal reputation records.
- Instructions:
  - `register(...)` for test/setup parity with registry records
  - `commit(job_id, commitment, role, consumer_pk, specialist_pk)`
  - `reveal(job_id, score, salt)`
  - `expire(job_id)`
- Accounts:
  - `AgentAccount`
  - `RatingAccount`
- PDA seeds:
  - `[b"agent", owner]`
  - `[b"rating", job_id]`
- Contract-relevant risks:
  - commitment hash verification;
  - duplicate and role-mismatch commits;
  - reveal score range;
  - expiry slot calculation and penalty path;
  - rolling reputation update math.

### Quasar Escrow PER

- Path: `experiments/quasar-escrow-per`
- Program id in source: `7ra8FZAHQ6F4SGfJJdjfgLuVnSN8HsGLx5iXq8qxSCpb`
- Purpose: MagicBlock PER-specific SOL escrow and self-custodied agent vault
  proof of concept.
- Instructions:
  - `make(amount, escrow_id)`
  - `take(escrow_id)`
  - `refund(escrow_id)`
  - `delegate_per(escrow_id)`
  - `commit_undelegate_per(escrow_id)`
  - `prepare_agent_vault()`
  - `delegate_agent_vault_per()`
  - `commit_agent_vault_per()`
  - `commit_agent_vault_magic_intent_per()`
  - `take_to_agent_vault(escrow_id)`
  - `prepare_vault_credit_intent(escrow_id)`
  - `private_take_to_agent_vault(escrow_id)`
  - `withdraw_agent_vault(amount)`
  - `undelegate_callback()`
- Accounts:
  - `UserEscrowCounter`
  - `EscrowAccount`
  - `AgentVault`
- PDA seeds:
  - `[b"counter", payer]`
  - `[b"escrow", payer, escrow_id]`
  - `[b"agent_vault", authority]`
- Contract-relevant risks:
  - SOL lamports custody semantics;
  - payer/payee/authority controls;
  - cancel window;
  - MagicBlock PER delegation and undelegation callback validation;
  - self-custodied agent vault withdrawal authority;
  - TEE/private execution proof boundaries.

### Quasar Escrow Legacy POC

- Path: `experiments/quasar-escrow`
- Program id in source: `VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`
- Purpose: earlier SOL-native escrow parity POC for lock/release/cancel.
- Status: reference/legacy once `experiments/quasar-escrow-per` is the active
  escrow audit target.
- Instructions:
  - `make(amount, escrow_id)`
  - `take(escrow_id)`
  - `refund(escrow_id)`
- Accounts:
  - `UserEscrowCounter`
  - `EscrowAccount`
- PDA seeds:
  - `[b"counter", payer]`
  - `[b"escrow", payer, escrow_id]`
- Contract-relevant risks:
  - retained for comparison and regression coverage;
  - should not be presented as the active grant-facing escrow target without a
    fresh issue decision.

## Legacy Anchor Reference Surface

- Path: `programs/escrow`
- Program id in source: `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`
- Status: legacy/reference implementation for parity comparison.
- Surfaces:
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
- Audit posture:
  - use this as a reference surface and parity oracle;
  - do not claim it as the current audit-ready deployment target unless a later
    issue explicitly reselects Anchor.

## Payment-Rail Contract Relevance

### SOL

SOL is the only current on-chain custody rail in the escrow program surfaces.
Both Anchor reference escrow and Quasar escrow/PER surfaces store lamports in
escrow/vault state and move lamports on release/refund/withdraw paths.

Audit impact:

- custody and authorization must be reviewed for SOL paths;
- cancel windows, status transitions, escrow PDA ownership, agent vault
  authority, and MagicBlock PER callback semantics are in scope.

### USDC

USDC is currently package/proof-level support through x402/Solana helper
surfaces, not a Quasar custody rail in the active program inventory.

Audit impact:

- no SPL custody account or token program state is present in the current
  program inventory;
- USDC proof validation belongs to package/receipt/evidence checks unless a
  later issue creates audited SPL custody.

### AUDD

AUDD is a first-class roadmap rail for grant delivery, but current v0.1 support
is payment-plan/proof metadata through `reddi.audd-payment-plan.v1`.

Audit impact:

- no AUDD custody path is approved in the current contract scope;
- AUDD plans must retain explicit mint, network, payee, settlement account,
  amount, evidence, approval, expiry, and buyer-policy checks;
- receipt/evidence binding may record AUDD proof metadata without implying
  custody, settlement finality, or mainnet execution;
- any future AUDD custody requires a new issue, SPL/token-account threat model,
  account-layout design, migration plan, local token-program tests, and external
  audit readiness review before devnet or mainnet promotion.

## Threat Model

Primary assets:

- SOL lamports held by escrow and agent-vault accounts;
- registry listing integrity;
- reputation and attestation state integrity;
- payment-proof metadata for USDC/AUDD receipts;
- grant-facing claims about audit readiness.

Trust boundaries:

- buyer/seller/operator package code is off-chain until an explicit
  instruction-builder or transaction lane is approved;
- package/read-model work must not build, sign, submit, simulate, or probe
  transactions;
- Quasar program tests and Surfpool/devnet promotion are separate gates;
- AUDD and USDC are proof rails unless a later custody issue explicitly changes
  scope;
- MagicBlock PER and TEE paths require their own callback/delegation evidence
  before promotion.

Key risks to audit:

- PDA seed collision or wrong signer authority;
- escrow release/refund/withdraw authorization bypass;
- MagicBlock delegate-buffer or callback spoofing;
- stale or mismatched account layouts between registry/reputation/attestation;
- score/commitment validation bypass;
- cancelled/released/expired state double-spend or double-mutation;
- incorrect slot-window assumptions;
- claim drift from "audit-ready evidence" into "audited", "mainnet ready",
  "custody supported", or "settlement finality proven".

## Account, PDA, And Layout Notes

Before external audit handoff, freeze an account-layout appendix with:

- account names, discriminators, field order, byte sizes, and padding;
- PDA seeds and signer authority per instruction;
- compatibility notes between Quasar registry, reputation, and attestation
  `AgentAccount` layouts;
- explicit differences from Anchor reference layouts, including dynamic strings
  versus fixed `[u8; 64]`, `Option<T>` versus sentinel fields, and timestamp /
  slot differences;
- MagicBlock PER delegate-buffer, permission, delegation-record, metadata, and
  undelegate-callback account expectations.

The existing parity reports under
`docs/verifiable-agent-protocol/colosseum-frontier-2026-04/` should be treated
as inputs, not final audit artifacts. They need a current-date review pass before
external submission.

## Migration And Backwards Compatibility

Current status:

- Quasar programs are separate experimental targets rather than a migration of
  already-live mainnet state.
- Legacy Anchor remains a reference implementation and parity oracle.
- Current AUDD and USDC support is package/proof metadata, not migrated custody.

Required before promotion:

- select the authoritative audit target for registry, attestation, reputation,
  and escrow/PER;
- record whether the older `experiments/quasar-escrow` POC is retired or kept as
  a regression fixture;
- pin program ids and account layouts for the selected target;
- define migration or coexistence rules before any existing receipt/evidence
  record claims a link to audited on-chain state;
- require a new design issue for SPL/AUDD custody rather than retrofitting it
  into the current SOL-only escrow claim.

## Instruction-Builder And Client Coverage

Active client/interface surfaces that auditors need in the handoff path:

- `lib/quasar/instruction-builders.ts`
  - Quasar instruction data builders for registry, reputation, and attestation
    parity paths.
  - Builds single-byte Quasar discriminator payloads and fixed-size byte layouts
    for register/update/deregister, commit/reveal/expire, and
    attest/confirm/dispute instruction data.
  - Audit focus: discriminator mapping, byte order, model length limits, job id
    encoding, commitment/salt length validation, score range checks, and parity
    with selected Quasar program ABIs.
- `lib/quasar/instructions.ts`
  - Quasar registration instruction assembly used by app registration flows.
  - Audit focus: account metas, signer/writable flags, program id routing,
    incinerator/system-program accounts, and alignment with registry PDA seeds.
- `lib/register/registration-instruction.ts`
  - Agent registration `TransactionInstruction` builder that routes between
    Quasar and legacy Anchor targets.
  - Audit focus: target switching, owner signer requirements, agent PDA
    derivation, registry fee destination, and legacy-vs-Quasar account layout
    differences.
- `packages/demo-agents/src/registration-instruction.ts`
  - Demo-agent register/deregister instruction builders for Anchor and Quasar
    targets.
  - Audit focus: duplicate encoding logic versus shared Quasar builders,
    default target selection, agent PDA derivation, deregistration authority, and
    fixture/demo paths not being mistaken for production activation.
- `packages/per-client/src/client.ts`
  - MagicBlock PER client paths for delegation, PER release, and L1 fallback.
  - Audit focus: keypair handling, transaction assembly, blockhash source,
    signing, TEE RPC routing, public-RPC fallback, session token handling,
    confirmation semantics, and claims that mention private settlement or
    mainnet finalization.
- `scripts/run-quasar-per-agent-vault-delegation-smoke.mjs`,
  `scripts/run-quasar-per-agent-vault-settlement-smoke.mjs`, and related
  `scripts/run-quasar-*` / `scripts/run-surfpool-*` files.
  - Scripted proof paths for local/devnet/PER evidence.
  - Audit focus: explicit approval gates, wallet/RPC requirements, artifact
    capture, transaction counts, spend caps, and separation between local
    evidence and deploy/mainnet claims.

These client surfaces are active audit inputs, but this document does not run
them and does not approve transaction submission. Any code change in these files
is a program-boundary or client-boundary change and must follow the #441
promotion checklist before Surfpool/devnet evidence is requested.

Package/read-model lanes are currently protected by
`npm run check:quasar:boundary-guard`. That guard prevents package metadata and
read-model files from quietly adding:

- instruction builders and transaction assembly;
- signing, keypair, wallet, or send paths;
- Solana RPC probes;
- Surfpool/devnet/MagicBlock TEE calls;
- deploy, upgrade, or migration commands;
- PDA/account-layout mutation surfaces;
- Quasar registry, escrow, reputation, attestation, PER, or vault mutation.

Any PR that needs one of those surfaces must move to a program-boundary path or
explicitly mark the handoff with `@quasar-program-boundary`, then follow the
promotion checklist in `docs/QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md`.

## Existing Test And Smoke Matrix

Local and CI evidence currently available:

- `bash scripts/run-quasar-program-tests.sh`
  - builds and tests:
    - `experiments/quasar-escrow`
    - `experiments/quasar-escrow-per`
    - `experiments/quasar-registry`
    - `experiments/quasar-reputation`
    - `experiments/quasar-attestation`
- `.github/workflows/quasar-program-tests.yml`
  - runs the compile/test loop for Quasar program paths.
- `npm run check:quasar:submission`
  - chains runtime compatibility, deployment inventory, demo readiness, and
    critical success guards.
- `npm run check:quasar:boundary-guard`
  - protects package/read-model lanes from unreviewed program-boundary changes.
- `npm run check:rap:naming`
  - validates RAP naming and claim wording.
- `git diff --check`
  - validates whitespace and patch hygiene.

Devnet, wallet, RPC, deploy, or mainnet evidence is not implied by these checks.
Those paths require explicit approval through the devnet approval gate.

## Missing Evidence And Audit Blockers

Blockers before an external "audit-ready contract handoff" claim:

- no current single-file audit manifest pins selected program ids, account
  layouts, and instruction ABI hashes;
- older parity reports need a current-date review for the selected active
  target set;
- `experiments/quasar-escrow` versus `experiments/quasar-escrow-per` target
  status must be decided explicitly;
- MagicBlock PER callback and delegation account expectations need a focused
  audit appendix;
- USDC and AUDD are not current custody rails and must not be represented as
  audited custody;
- SPL/AUDD custody threat modeling and token-account tests are not started;
- external audit reviewer, scope, and artifact bundle are not selected.

## Surfpool And Devnet Promotion State

#441 is complete as a promotion checklist. Its current effect is gatekeeping:

- metadata-only work may proceed without Surfpool/devnet when it stays read-only;
- instruction builders, transaction assembly, PDA/account-layout mutation,
  program behavior, local payment/reputation semantics, deploy scripts, or
  custody claims require local Surfpool evidence first;
- devnet wallet/RPC use requires an explicit `Devnet Approval Gate` section with
  command, wallet, endpoint, transaction count, spend limit, artifact directory,
  rollback plan, and Nissan approval;
- live/mainnet remains blocked.

## Future Program-Affecting PR Requirements

Every future program-affecting PR must include:

- issue number and parent epic;
- affected program(s), instruction(s), account(s), PDA seeds, and layouts;
- threat-model update;
- migration/backwards-compatibility notes;
- local unit tests and, when applicable, Surfpool evidence artifact path;
- reviewer approval that names the program-changing scope;
- explicit statement that devnet/mainnet, live payment, and custody expansion are
  not included unless separately approved;
- UI screenshots/video when UI changes expose rail, contract, or readiness state.

Minimum validation:

- `bash scripts/run-quasar-program-tests.sh` for program changes;
- `npm run check:quasar:submission` when runtime/deployment/readiness metadata
  changes;
- `npm run check:quasar:boundary-guard` for package/read-model exemptions;
- `npm run check:rap:naming`;
- `git diff --check`.

## External Audit Handoff Checklist

Before sending to an external auditor, prepare:

- selected program inventory and rationale;
- exact commit SHA and tag;
- selected program ids and deployment state;
- account-layout appendix;
- PDA and signer-authority matrix;
- instruction ABI and discriminator list;
- known parity deltas versus Anchor reference;
- threat model and trust-boundary summary;
- test matrix and latest passing artifacts;
- Surfpool/devnet evidence, if the audit scope includes runtime behavior;
- explicit non-goals: no AUDD custody, no USDC custody, no mainnet readiness, no
  settlement-finality claim unless those are added by a later approved scope;
- list of open blockers and product decisions.

## Current Conclusion

RAP has enough existing Solana/Quasar program work to begin an audit-readiness
handoff lane immediately. The soonest grant-satisfying path is:

1. freeze the active Quasar target set;
2. generate the current account/PDA/ABI appendix;
3. rerun Quasar program tests and readiness guards;
4. package the evidence for an external auditor;
5. keep AUDD first-class in the rail matrix as proof/payment-plan metadata while
   deferring AUDD custody to a separately audited future workstream.

This document does not claim the contracts are audited, deployed, mainnet ready,
custodial for AUDD/USDC, or settlement-final.
