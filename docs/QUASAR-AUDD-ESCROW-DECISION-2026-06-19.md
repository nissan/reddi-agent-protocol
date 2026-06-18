# AUDD / Quasar Escrow Decision Spike

Date: 2026-06-19

Issue: #392

## Decision

Keep AUDD support adapter/proof based for RAP v0.1. Do not change Quasar, Anchor, or SPL custody programs for the first AUDD rollout.

The v0.1 path is:

1. Sellers publish AUDD/Solana quote metadata through `reddi.audd-payment-plan.v1`.
2. Buyers run local fail-closed preflight against explicit network, mint, payee, settlement account, evidence, approval, expiry, and budget limits.
3. Live payment remains disabled unless the operator explicitly approves it.
4. Settlement evidence is represented as receipt/proof metadata, then bound to EvidenceArchive and attestation/reputation records.
5. On-chain custody remains out of scope until a later mainnet custody issue proves it is needed.

## Evidence Inspected

Current package surfaces:

- `packages/agent-protocol/src/audd-payment-plan.ts`
  - Defines AUDD/Solana payment plans with `network`, `mint`, `payee`, `settlementAccount`, `amount`, expiry, evidence policy, refund/failure policy, and dry-run/live mode.
  - Rejects malformed plans, credential-bearing metadata, circular structures, quote/payment-plan mismatches, expired quotes, missing buyer policy, missing operator approval, and unapproved live payments.
  - Does not submit wallet, RPC, SPL transfer, Quasar, or hosted registry actions.
- `packages/x402-solana/src/payment.ts`
  - Verifies real Solana receipts only when `allowRealPayment` is set.
  - Supports SOL transfer proof and USDC/SPL-token transfer proof by checking parsed transaction data, mint, token account, destination owner, amount, payee, network, and nonce.
  - `sendPayment` remains a mock/test stub and does not submit transactions.
- `programs/escrow/src/state.rs`
  - `EscrowAccount.amount` is `u64` lamports.
  - The account stores `payer`, `payee`, `amount`, `nonce`, status, timestamps, PER delegation flag/session key, and bump.
  - There is no token mint, token program, escrow token account, or settlement token account field.
- `programs/escrow/src/instructions/lock_escrow.rs`
  - Uses `system_program::transfer` from payer to escrow PDA.
  - This is native SOL/lamports custody only.
- `programs/escrow/src/instructions/release_escrow.rs`
  - Moves lamports from escrow PDA to payee and closes escrow to payer.
- `programs/escrow/src/instructions/cancel_escrow.rs`
  - Moves lamports from escrow PDA back to payer after the cancel window.

## Assessment

Current Quasar/Anchor escrow supports native lamports custody, not SPL token custody.

Current package-level payment proof support is enough for RAP v0.1 AUDD because AUDD can be treated as an SPL-token settlement rail represented by:

- explicit mint allowlist,
- explicit payee allowlist,
- explicit settlement account allowlist,
- transaction receipt/proof reference,
- local buyer policy decision,
- EvidenceArchive binding,
- attestation/reputation outcome.

This preserves payment-rail neutrality and avoids forcing an audited on-chain custody change before the protocol has a complete local no-spend workflow, readiness gate, listing review, and proof chain.

## Rejected Options

### Add AUDD/SPL custody to existing escrow now

Rejected for v0.1.

Reasons:

- Existing escrow state layout is lamports-only.
- SPL custody would require token accounts, mint validation, token program ownership checks, associated-token-account handling, close/refund semantics, and migration/audit work.
- It would mix custody risk into a package-level adapter milestone that was intentionally metadata/preflight only.
- Existing Quasar security notes already treat program changes as audit-scoped work, not a small adapter follow-up.

### Route AUDD through Quasar AgentVault/PER now

Rejected for v0.1.

Reasons:

- Prior MagicBlock/PER work intentionally bounded claims to Quasar-owned vault/private execution paths.
- AUDD rollout does not need private delegated custody yet.
- PER would add new operational and proof complexity before marketplace readiness can consume the simpler receipt/evidence path.

## Recommended Follow-Ups

Create these only when live AUDD custody becomes a committed product milestone:

1. Threat model for AUDD/SPL custody.
   - Include mint spoofing, token-account owner spoofing, decimals/amount units, delegate/close authority, frozen accounts, ATA creation, replay, partial payment, refund/dispute, and custodian upgrade/migration risks.
2. SPL escrow account-layout design.
   - Decide whether to extend current escrow, create a separate SPL escrow program/account, or keep custody outside Quasar with proof-only binding.
3. Migration and compatibility plan.
   - Define how existing lamports escrows, receipt proofs, EvidenceArchive records, and reputation links coexist with SPL custody records.
4. Test and audit scope.
   - Add local Solana token-program tests, malformed mint/token-account negative tests, receipt/evidence binding tests, and external audit checklist before mainnet.
5. Indexer/proof binding implementation.
   - Before custody, land a receipt/evidence binding primitive that can link AUDD transaction proofs to discovery candidate, quote, buyer/seller challenge, evidence archive, attestation, and reputation records.

## v0.1 Acceptance Decision

For RAP v0.1, AUDD should stay adapter/proof based:

- No new Quasar program.
- No SPL custody program changes.
- No mainnet/live settlement default.
- No wallet/RPC transfer helpers in `@reddi/agent-protocol`.
- Continue through #368/#357 local no-spend demo, #377 readiness gate, #386 UI readiness, and #393 receipt/evidence binding using proof metadata first.

This decision should be revisited only if a product requirement demands escrowed AUDD custody instead of receipt/proof-based settlement evidence.
