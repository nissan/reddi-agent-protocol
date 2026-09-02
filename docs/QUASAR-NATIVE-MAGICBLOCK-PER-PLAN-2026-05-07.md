# Quasar-native MagicBlock PER plan — 2026-05-07

> **2026-05-08 supersession note:** This plan is historical. PR #274 later proved bounded MagicBlock PER AgentVault settlement for the Quasar-owned agent-vault route (`artifacts/quasar-per-agent-vault-settlement-smoke/20260508T031640Z/summary.json`). Use this file for design lineage only; current submission copy must say arbitrary-wallet/private payee settlement remains unclaimed, not that MagicBlock is authorization-only or TEE-blocked.

## Executive summary

Nissan's constraint is correct: for the bounty, the final path should not fall back to Anchor-compiled Solana programs. The right plan is to port MagicBlock's PER lifecycle into the Quasar escrow program as low-level Solana CPI + client routing, using MagicBlock's docs and SDK byte layouts as compatibility fixtures.

**PER means Private Ephemeral Rollup.** It is MagicBlock's privacy-preserving version of Ephemeral Rollups: state is delegated from Solana base layer into an Ephemeral Rollup validator running in a TEE, with access control/permission accounts enforcing who can see private transaction logs, balances, messages, and account signatures. For our demo, the critical proof is: a Quasar escrow PDA is permissioned, delegated to the TEE validator, settled privately through `devnet-tee.magicblock.app`, and then committed/undelegated back without any Anchor program in the final on-chain path.

## Crawl / ingest evidence

Crawl output:

- Index: `ingests/magicblock-docs-2026-05-07/quasar-native-crawl/crawl-index.json`
- Raw markdown pages: `ingests/magicblock-docs-2026-05-07/quasar-native-crawl/raw-md/`
- Scope: four requested roots plus docs.magicblock.gg links two-deep, 36 pages fetched, 0 fetch errors.

Key root pages:

- PER quickstart: `pages_private-ephemeral-rollups-pers_how-to-guide_quickstart.md`
- PER access control: `pages_private-ephemeral-rollups-pers_how-to-guide_access-control.md`
- ER quickstart: `pages_ephemeral-rollups-ers_how-to-guide_quickstart.md`
- ER native Rust guide: `pages_ephemeral-rollups-ers_how-to-guide_rust-program.md`
- VRF quickstart: `pages_verifiable-randomness-functions-vrfs_how-to-guide_quickstart.md`
- Private Payments template/API: `pages_templates_private-payments.md` and `pages_private-ephemeral-rollups-pers_api-reference_per_*.md`

## What the docs imply

### 1. ER mechanics

MagicBlock ER requires program-side delegation lifecycle, not just a client-side Magic Router send:

1. Base-layer `delegate`: CPI to MagicBlock Delegation Program so a PDA becomes writable in ER.
2. ER execution: normal program instructions execute against the delegated account on the ER RPC.
3. ER `commit`: schedule state sync from ER back to base layer.
4. ER `commit_and_undelegate`: schedule sync + return account ownership.
5. Base-layer undelegate callback: the Delegation Program calls back into our program using exact discriminator `[196, 28, 41, 206, 48, 37, 51, 167]`.

Native Rust docs explicitly show this path without Anchor macros. That is our Quasar blueprint.

### 2. PER adds a permission lifecycle on top of ER

PER quickstart and access-control docs say a private delegation must do all three:

1. `CreatePermission` for the account being protected.
2. `DelegatePermission` for the permission account to the TEE validator.
3. Delegate the permissioned account itself to the same validator.

Undelegation is symmetric:

1. `CommitAndUndelegatePermission` via Permission Program.
2. `commit_and_undelegate` for the protected account via Magic Program intent.

The earlier `InvalidAccountForFee` rejection fits this: our escrow PDA was routed to TEE without being docs-conformantly permissioned/delegated.

### 3. TEE client side remains TypeScript-side

PER docs require:

- `verifyTeeRpcIntegrity(EPHEMERAL_RPC_URL)` against TDX attestation.
- `getAuthToken(teeUrl, wallet.publicKey, signMessage)`.
- Route private transactions to `https://devnet-tee.magicblock.app?token=${token}`.

This is compatible with Quasar: the client can use Web3.js / MagicBlock SDK for routing and auth while the on-chain programs remain Quasar-compiled.

### 4. VRF is useful, but not on the critical PER path

VRF docs add a separate verified-oracle callback model (`create_request_randomness_ix`, `VRF_PROGRAM_IDENTITY`). It can strengthen the demo later (e.g. private agent task sampling / randomized attestor selection), but it is not required to prove Quasar-native PER. Do not put VRF on the critical path before the bounty proof lands.

### 5. Private Payments API is a backup UX/reference, not the core bounty proof

Private Payments docs expose `/v1/spl/*` APIs for challenge/login/deposit/private-balance/transfer/withdraw/swap. This proves MagicBlock has a productized private payments pattern, but using only the hosted API would weaken our Quasar-native claim because it bypasses our Quasar escrow program. Use it only as comparison/reference evidence, not the main integration.

## Quasar compatibility finding

Quasar already has the primitive we need:

- `third_party/quasar/lang/src/cpi/mod.rs` exposes fixed `CpiCall` with `invoke_signed` / `invoke_with_signers`.
- `third_party/quasar/lang/src/cpi/dyn_cpi.rs` exposes `DynCpiCall` for variable account/data CPI with `invoke_signed`.
- Existing Quasar escrow code already uses Quasar accounts, PDAs, bumps, and system CPI in `experiments/quasar-escrow/src/instructions/lock.rs`.

So we do **not** need Anchor macros. We need Quasar-native equivalents of the MagicBlock macro output:

- `#[delegate]` macro replacement: explicit accounts + delegate CPI builder.
- `#[commit]` macro replacement: explicit `magic_context` + `magic_program` accounts + intent CPI.
- `#[ephemeral]` macro replacement: exact undelegate callback discriminator + processor.

## Target architecture

### On-chain: Quasar escrow PER extension

Add these Quasar instructions to `experiments/quasar-escrow`:

1. `delegate_per(escrow_id, members)` — base layer
   - Accounts: payer, escrow PDA, permission PDA, permission buffer, permission delegation record, permission delegation metadata, escrow delegation buffer/record/metadata, owner program, permission program, delegation program, system program, optional validator.
   - CPIs:
     1. Create permission account if empty.
     2. Delegate permission account if not already delegated.
     3. Delegate escrow PDA if not already delegated.
   - Validator: default to MagicBlock devnet TEE validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`; allow explicit override for local ER/TEE tests.

2. `release_private(escrow_id)` — ER/TEE
   - Same escrow release semantics as current Quasar `take`, but sent via TEE RPC while escrow account is delegated.
   - Option A: reuse current `take` instruction unchanged if delegated execution accepts it.
   - Option B: add a PER-specific release instruction that additionally records a PER proof marker/event.

3. `commit_private(escrow_id)` — ER/TEE
   - CPI to Magic Program intent builder equivalent: commit escrow PDA while remaining delegated.
   - Useful for intermediate visibility/evidence without closing the PER session.

4. `undelegate_per(escrow_id)` — ER/TEE
   - CPI to Permission Program `CommitAndUndelegatePermission`.
   - CPI to Magic Program `commit_and_undelegate` for escrow PDA.

5. `undelegate_callback(pda_seeds)` — base layer callback
   - Exact discriminator `[196, 28, 41, 206, 48, 37, 51, 167]`.
   - Validate callback is from Delegation Program where possible.
   - Restore expected account ownership / state marker. Native Rust docs are clear this callback must exist without relying on Anchor `#[ephemeral]`.

### On-chain helper modules

Add Quasar-native helpers instead of importing Anchor:

- `experiments/quasar-escrow/src/magicblock/constants.rs`
  - Permission Program: `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`
  - Delegation Program: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
  - Magic Program: `Magic11111111111111111111111111111111111111`
  - Magic Context: `MagicContext1111111111111111111111111111111`
  - Devnet TEE validator: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`

- `experiments/quasar-escrow/src/magicblock/layout.rs`
  - Encode `CreatePermission`, `DelegatePermission`, `CommitAndUndelegatePermission`, `DelegateAccount`, `Commit`, `CommitAndUndelegate` instruction data.
  - Unit test against `artifacts/magicblock-cpi-layout/latest.json` generated from the MagicBlock JS SDK.

- `experiments/quasar-escrow/src/magicblock/cpi.rs`
  - Use Quasar `DynCpiCall` for the MagicBlock CPIs because permission member lists and optional validator make account/data shape variable.
  - Use `invoke_signed` with escrow PDA seeds so the permissioned account / escrow PDA can authorize the CPIs.

### Client/demo changes

Add a new fail-closed demo lane in `packages/demo-agents/src/demo.ts`:

`HACKATHON_DEMO_TARGET=quasar` + `MAGICBLOCK_PER_MODE=quasar-native`

Flow:

1. Initialize/lock Quasar escrow on base devnet.
2. Call Quasar `delegate_per` on base devnet.
3. Verify TEE RPC integrity and request auth token.
4. Send Quasar `release_private`/`take` to `https://devnet-tee.magicblock.app?token=...` using `ConnectionMagicRouter` or direct TEE connection.
5. Capture TEE signature status.
6. Check public devnet status invisibility/lag while TEE sees it.
7. Call Quasar `undelegate_per` on TEE.
8. Verify base-layer committed state after finalization.
9. Emit evidence pack:
   - program IDs are Quasar escrow/registry/reputation/attestation IDs,
   - no Anchor program ID in final demo path,
   - permission/delegation account addresses,
   - TEE auth attestation metadata redacted,
   - TEE tx signature/status,
   - public devnet contrast,
   - final base-layer state readback.

## Work plan

### Phase 0 — freeze findings / guardrails (0.5 day)

- Keep this crawl artifact and plan in repo.
- Add a BDD row: “Quasar-native PER settlement does not use Anchor program IDs.”
- Add a source-conformance guard that fails if `MAGICBLOCK_PER_MODE=quasar-native` references `programs/escrow` or Anchor program ID `794n...`.

Exit: docs + guards merged; no live mutation.

### Phase 1 — Quasar MagicBlock CPI codec (0.5–1 day)

- Move current non-mutating MagicBlock byte-layout tests from legacy Anchor module into Quasar experiment/tests.
- Implement Quasar-native instruction encoders for permission/delegation/magic intent CPIs.
- Test against `artifacts/magicblock-cpi-layout/latest.json`.

Exit: local Quasar tests prove byte-for-byte SDK parity for required MagicBlock instructions.

### Phase 2 — local Quasar PER lifecycle in tests (1–2 days)

- Add Quasar accounts/instructions for `delegate_per`, `commit_private`, `undelegate_per`, callback discriminator.
- Use QuasarSVM/LiteSVM where possible for account parsing and CPI shape tests.
- Use Surfpool/local ER stack if available to test real delegation locally without devnet token risk.

Exit: `scripts/run-quasar-program-tests.sh` covers PER instruction parse + CPI layout + state transition guards.

### Phase 3 — devnet deploy of Quasar escrow PER extension (0.5 day, approval-gated)

- Build SBF with the repository-pinned Anza/Agave toolchain from `docs/SOLANA-TOOLCHAIN-BASELINE.md`.
- Deploy upgraded/new Quasar escrow program to devnet.
- Update `config/quasar/deployments.json` only after successful deploy.

Exit: devnet Quasar PER-enabled escrow program ID recorded; old non-PER Quasar path remains stable/fail-closed.

### Phase 4 — live TEE happy path (0.5–1 day, approval-gated)

- Run bounded live devnet script:
  - create tiny escrow,
  - delegate PER to devnet TEE validator,
  - release/settle over tokenized TEE endpoint,
  - commit/undelegate,
  - read back base layer.
- Capture all artifacts under `artifacts/quasar-magicblock-per/<timestamp>/`.
- Redact auth token/signature payloads; do not store secrets.

Exit: successful Quasar-native PER settlement evidence pack.

### Phase 5 — bounty/judge presentation / current boundary (0.5 day)

- Historical original target: update homepage ecosystem proof map for Quasar-native permission/delegation only. Superseded current target: homepage ecosystem proof map says bounded AgentVault settlement is proven, while arbitrary-wallet/private payee settlement is unclaimed.
- Update judge packet and final operator checklist to cite `docs/MAGICBLOCK-QUASAR-TEE-REPRO-2026-05-07.md`.
- Add one screenshot/video capture if available.

Historical exit criterion, superseded: bounty submission can now honestly claim bounded Quasar-owned AgentVault settlement through MagicBlock PER. It still cannot claim arbitrary-wallet/private payee settlement unless a later loop implements and validates that separate route.

## Risks / mitigations

1. **MagicBlock Rust SDK may not compile with Quasar/Solana dependency graph.**
   - Mitigation: do not depend on SDK on-chain; use SDK only offline to generate byte-layout fixtures. Implement Quasar CPI manually.

2. **Variable `members` layout may be tricky.**
   - Mitigation: start with fixed minimal members list: payer/escrow authority with `AUTHORITY | TX_LOGS | TX_BALANCES` as required. Expand only after happy path.

3. **TEE rejects account fee/ownership again.**
   - Mitigation: add explicit delegation-status checks after `delegate_per`; fail before TEE send if permission or escrow account is not delegated to TEE validator.

4. **Undelegate callback semantics in Quasar differ from native Rust sample.**
   - Mitigation: implement exact discriminator first; keep callback minimal; validate against MagicBlock native Rust guide and local ER stack before live devnet.

5. **Devnet deploy/live mutation is approval-gated.**
   - Mitigation: phases 0–2 are safe local/offline work; phases 3–4 need Nissan approval.

## Recommendation

Proceed with Phases 0–2 immediately on the existing MagicBlock branch. Do not spend time making the legacy Anchor PER path work unless we need a comparison artifact. The critical path is now clear: Quasar-native explicit MagicBlock CPI lifecycle + TEE client routing + evidence pack.

## Quasar docs viability addendum

Follow-up Quasar docs crawl/analysis is captured in `docs/QUASAR-DOCS-MAGICBLOCK-PER-VIABILITY-2026-05-07.md` with raw ingest under `ingests/quasar-docs-2026-05-07/full-docs-plus-two-deep/`.

Conclusion: the plan remains viable, but the PER-enabled Quasar escrow ABI must account for MagicBlock's exact 8-byte undelegate callback discriminator `[196, 28, 41, 206, 48, 37, 51, 167]`. Since Quasar docs say all instruction discriminators in one program must have the same byte length, the clean hackathon path is a new PER-specific Quasar escrow program using 8-byte discriminators, rather than trying to bolt the callback onto the existing single-byte Quasar escrow ABI.
