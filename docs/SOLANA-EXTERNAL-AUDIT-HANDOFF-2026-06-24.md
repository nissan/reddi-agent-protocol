# Solana External Audit Handoff

Date: 2026-06-24

Issue: #530

> **Readiness reconciliation note (2026-08-31):** this packet predates the
> job-binding series (#642-#645). Do not send it to an external auditor as-is.
> Current code binds reputation and attestation to `experiments/quasar-escrow`
> (`VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW`) via `quasar-escrow-ref`;
> `experiments/quasar-escrow-per` is a separate MagicBlock PER proof lane and is
> outside that current job-binding trust boundary unless a later approved issue
> reselects it.

Input evidence:

- #526 / PR #527: `docs/SOLANA-CONTRACT-AUDIT-READINESS-2026-06-24.md`
- #531 / PR #532: `docs/SOLANA-CONTRACT-AUDIT-APPENDIX-2026-06-24.md`
- #388 Solana/Quasar program boundary.
- #441 Quasar/Surfpool/devnet promotion checklist.

## Handoff Boundary

This handoff package prepares evidence for an external Solana contract auditor.
It does not select or pay an auditor, send external submissions, deploy
programs, start Surfpool/devnet, call RPC, use wallets, does not approve transaction submission, activate live payments, claim mainnet readiness, expand custody, or claim settlement finality.

Any paid auditor selection, external email/submission, spend, deploy,
Surfpool/devnet run, wallet/RPC/provider call, transaction submission, live
payment, mainnet, custody expansion, or settlement-finality claim requires explicit Nissan approval.

## Auditor-Facing Scope

In scope for handoff:

- Active Quasar targets for the current devnet job-binding boundary:
  - `experiments/quasar-registry`
  - `experiments/quasar-attestation`
  - `experiments/quasar-reputation`
  - `experiments/quasar-escrow`
- Separate Quasar proof lane, not the current reputation/attestation escrow boundary:
  - `experiments/quasar-escrow-per`
- Legacy/reference targets:
  - `programs/escrow`
- Active client and instruction-builder surfaces:
  - `lib/quasar/instruction-builders.ts`
  - `lib/quasar/instructions.ts`
  - `lib/register/registration-instruction.ts`
  - `packages/demo-agents/src/registration-instruction.ts`
  - `packages/per-client/src/client.ts`
- Scripted proof lanes:
  - `scripts/run-quasar-program-tests.sh`
  - `scripts/check-quasar-boundary-guard.mjs`
  - `scripts/check-quasar-runtime-compatibility.mjs`
  - `scripts/check-quasar-deployment-inventory.mjs`
  - `scripts/run-quasar-per-agent-vault-delegation-smoke.mjs`
  - `scripts/run-quasar-per-agent-vault-settlement-smoke.mjs`
  - `scripts/run-surfpool-critical-smoke.sh`

Explicitly out of scope unless a later approved issue changes scope:

- AUDD or USDC custody.
- Mainnet deployment or mainnet readiness.
- Settlement-finality proof.
- Production Pay.sh activation or live payment.
- Marketplace publication.
- Trust/reputation mutation.
- Any wallet/RPC/provider-backed execution.

## Frozen Handoff Inputs

- Input evidence commit: `3561dc5da0700367ed8ef95ab2dd091560280591`
- Evidence pack at input evidence commit:
  `docs/SOLANA-CONTRACT-AUDIT-READINESS-2026-06-24.md`
- Account/PDA/ABI appendix at input evidence commit:
  `docs/SOLANA-CONTRACT-AUDIT-APPENDIX-2026-06-24.md`
- Final handoff source commit: the merge commit for PR #534, to be recorded in
  #530 before any external auditor submission.
- Current active escrow target for reputation/attestation job binding: `experiments/quasar-escrow`
- Current MagicBlock PER proof lane outside that boundary: `experiments/quasar-escrow-per`
- Current Anchor reference: `programs/escrow`
- Current AUDD posture: first-class payment-plan/proof metadata only.
- Current USDC posture: package/proof/helper rail only, not Quasar or Anchor
  custody.
- Current SOL posture: lamports custody appears only in selected escrow/vault
  program surfaces and remains promotion-gated.

## Required Artifact Manifest

Auditor packet must include:

- Exact input evidence commit SHA and final handoff source tree pointer.
- Program ids from the selected source files.
- Account/PDA/layout matrix.
- Instruction ABI and discriminator list.
- Active client/instruction-builder inventory.
- Scripted proof lane inventory.
- Threat model and trust-boundary summary.
- Known blockers and product decisions.
- Latest test/smoke evidence.
- Surfpool/devnet promotion state from #441.
- Explicit non-goals for mainnet, custody expansion, live payment, external
  submission, and settlement-finality claims.
- Grant-facing reporting summary that separates readiness evidence from an
  audit-complete claim.

## Auditor Questions

Expected questions and owner lanes:

- Program target selection:
  - Owner lane: #388 / #441.
  - Required answer: which Quasar targets are active, which are legacy/proof-only, and why; current job-binding code selects `quasar-escrow`, not `quasar-escrow-per`.
- ABI, PDA, and account layout:
  - Owner lane: #531.
  - Required answer: account names, discriminators, field order, byte sizes,
    PDA seeds, signer/writable flags, and Anchor-vs-Quasar deltas.
- PER and MagicBlock callback behavior:
  - Owner lane: #388 / #441.
  - Required answer: delegation accounts, callback expectations, approval gates,
    and which evidence is local-only versus devnet-backed.
- Payment rails:
  - Owner lane: #338 / #334 / #525.
  - Required answer: SOL custody scope, USDC proof scope, AUDD proof-metadata
    scope, and no current AUDD/USDC custody.
- Client handoff path:
  - Owner lane: #526 / #531.
  - Required answer: which builders assemble instruction data, which assemble
    `TransactionInstruction` objects, and which scripts would require approval
    before transaction submission.

## Triage And Remediation Flow

Severity handling:

- Critical:
  - Blocks audit handoff and any grant-facing audit-ready claim.
  - Requires immediate issue, remediation PR, reviewer re-gate, and parent issue
    refresh.
- High:
  - Blocks affected program/client surface from handoff.
  - Requires remediation PR and targeted validation before re-review.
- Medium:
  - May proceed only if documented as an accepted audit caveat with issue owner,
    risk, and follow-up.
- Low:
  - May be tracked as cleanup when it does not affect custody, authority,
    transaction construction, or claim safety.

Remediation PR flow:

1. Open or update a GitHub issue with description, acceptance criteria,
   dependencies, reverse dependencies, and boundary.
2. Use an isolated worktree and feature branch.
3. Patch only the affected program, client, proof-lane, or documentation surface.
4. Run the validation set named by the issue and this handoff packet.
5. Open a PR with validation evidence and explicit non-goals.
6. Request read-only review.
7. Merge only after review is ready to approve and GitHub checks are green.
8. Refresh affected parent/dependency issues after merge.

Re-review flow:

- Reviewer findings must cite file/line references and severity.
- Blockers require a remediation commit and a new review pass.
- Non-blocking notes must either be accepted in the PR body or converted to a
  follow-up issue before final handoff.
- Any change touching UI must include screenshots and/or video evidence.

## Grant-Facing Reporting

Allowed grant-facing statement after this packet lands:

- RAP has prepared a Solana contract audit-readiness handoff packet covering
  active Quasar targets, legacy Anchor reference, account/PDA/ABI appendix,
  client/instruction-builder surfaces, proof lanes, threat model, and known
  blockers.

Forbidden grant-facing statements until later approved evidence exists:

- Contracts are audited.
- Contracts are deployed or mainnet ready.
- AUDD or USDC custody is supported by current Quasar or Anchor contracts.
- Settlement finality is proven.
- A live payment, wallet/RPC run, Surfpool/devnet execution, or external audit
  submission has occurred.

## Validation

Run before handoff packet PR review:

- `npm run check:solana:audit-handoff`
- `npm run check:solana:audit-appendix`
- `npm run check:rap:naming`
- `git diff --check`

If BDD docs change, also run:

- `npm run test:bdd:index`

If package/read-model files change, also run:

- `npm run check:quasar:boundary-guard -- --changed`
