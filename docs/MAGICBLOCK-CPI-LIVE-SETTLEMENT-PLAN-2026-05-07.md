# MagicBlock CPI Live Settlement Plan — 2026-05-07

## Purpose

Convert the current MagicBlock PER/TEE boundary proof into an honest successful live PER settlement proof.

Current state: the demo can authenticate to MagicBlock TEE, lock devnet escrow, route a settlement attempt to TEE with fallback disabled, and show public-RPC invisibility for a submitted TEE signature. It does **not** yet make the escrow PDA a MagicBlock-delegated account, so TEE rejection with `InvalidAccountForFee` is expected.

## Recommendation

Target the legacy Anchor escrow program first. Do **not** attempt Quasar-native MagicBlock PER before submission unless there is substantially more time.

Why:

- Existing failed proof path is in `archive/anchor-escrow` / `packages/demo-agents`.
- MagicBlock's docs and SDK expect permission/delegation hooks for account state.
- The escrow account is a PDA, so the program must sign MagicBlock CPI instructions via `invoke_signed`.
- Quasar CPI/signing semantics need separate investigation and are too risky for this sprint.

## Implemented non-mutating scaffolding

`archive/anchor-escrow/src/magicblock_cpi.rs` now pins the SDK-derived constants and instruction data serializers for the legacy Anchor escrow path. This does **not** invoke MagicBlock programs and does **not** change live settlement semantics yet; it gives the next implementation slice byte-accurate Rust layouts.

Validation:

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test -p escrow magicblock_cpi -- --nocapture
```

Result: 2/2 tests passed, asserting Rust layouts match the JS SDK fixture for permission and delegate-account instruction data.

## Required remaining program changes

### 1. Add MagicBlock PDA helpers

Derive/check these addresses in Rust or pass them as accounts and validate against deterministic derivation:

- Permission PDA for escrow account:
  - seed prefix from SDK: `PERMISSION_SEED`
  - account: `escrow_pda`
  - program: `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`
- Delegation buffer PDA for escrow + owner program
- Delegation record PDA for escrow
- Delegation metadata PDA for escrow
- Equivalent delegation PDAs for the permission account if delegating permission alongside state

### 2. Add `create_escrow_permission`

CPI to MagicBlock Permission Program `createPermission`.

Expected account shape:

```rust
#[derive(Accounts)]
pub struct CreateEscrowPermission<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, payer.key().as_ref(), escrow.nonce.as_ref()],
        bump = escrow.bump,
        has_one = payer @ EscrowError::UnauthorisedSigner,
    )]
    pub escrow: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: MagicBlock permission PDA; validated by seeds/program before CPI.
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: MagicBlock Permission Program.
    pub permission_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
```

The escrow PDA must sign via:

```rust
let signer_seeds: &[&[u8]] = &[
    ESCROW_SEED,
    payer.key.as_ref(),
    escrow.nonce.as_ref(),
    &[escrow.bump],
];
```

### 3. Add `delegate_escrow_to_per`

CPI sequence:

1. Permission Program `delegatePermission` if required by MagicBlock's current private-PER guide.
2. Delegation Program `delegate` for the escrow PDA.
3. Store local state:
   - `delegated_to_per = true`
   - `per_session_key` or validator/session marker
   - ideally `per_validator`, `per_delegated_at_slot`, `per_commit_frequency_ms`

Expected validator for devnet TEE:

```text
MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo
```

Before live run, confirm this against current MagicBlock docs because older repo notes may mention a different validator.

### 4. Add `release_escrow_per_live`

Keep settlement semantics close to existing `release_escrow_per`, but run on a truly delegated escrow account.

Sequence:

1. Require escrow locked and delegated.
2. Transfer lamports from escrow PDA to payee.
3. CPI commit/undelegate permission/account via MagicBlock Permission/Magic Program context.
4. Clear delegation state.
5. Close escrow to payer if still desired.

Expected extra accounts:

```rust
pub permission: UncheckedAccount<'info>,
pub magic_program: UncheckedAccount<'info>,
pub magic_context: UncheckedAccount<'info>,
pub permission_program: UncheckedAccount<'info>,
```

### 5. Add emergency `undelegate_escrow_per_fallback`

Needed because live PER failures can strand an escrow in delegated state. This should be payer-authorized and conservative.

## Dependency rule

Do **not** add MagicBlock Rust SDK for this sprint. Earlier compatibility evidence shows the Rust SDK conflicts with the current Anchor stack.

Use raw Solana CPI construction only:

```rust
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
```

Byte layouts should be copied from the installed JS SDK helpers in `packages/per-client/node_modules/@magicblock-labs/ephemeral-rollups-sdk/lib/instructions/*`.

## Offline CPI layout fixture

A non-mutating fixture generator now derives the MagicBlock instruction layouts from the installed JS SDK:

```bash
npm run evidence:magicblock:cpi-layout
```

Output:

```text
artifacts/magicblock-cpi-layout/latest.json
```

The fixture includes:

- MagicBlock program constants.
- Devnet TEE validator key.
- Sample permission/delegation PDAs.
- Account metas and instruction data hex for:
  - `createPermission`
  - `delegatePermission`
  - `delegateEscrow`
  - `commitAndUndelegatePermission`

Important finding from the fixture: all MagicBlock state/permission operations expect the escrow account as a signer for the delegated-account path. Because the escrow is a PDA, the legacy program must use `invoke_signed`; client-only instruction construction is not enough.

## Tests and validation gates

### Local tests

- MagicBlock PDA derivation matches JS SDK output.
- CPI instruction data matches JS SDK helper output for:
  - `createCreatePermissionInstruction`
  - `createDelegateInstruction`
  - `createDelegatePermissionInstruction`
  - `createCommitAndUndelegatePermissionInstruction`
- Wrong payer rejected.
- Non-locked escrow rejected.
- Delegated flag set only after successful CPI construction/invocation.
- PER release clears delegated flag.

### Live smoke

Run only after explicit approval for redeploy/live devnet mutation:

```bash
NETWORK_PROFILE=devnet \
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com \
NEXT_PUBLIC_PER_RPC=https://devnet-tee.magicblock.app \
DEMO_SETTLEMENT_MODE=magicblock_per \
DEMO_ALLOW_FALLBACK=false \
npm run test:per:happy
```

Pass criteria:

- Permission account created.
- Escrow PDA delegated to MagicBlock TEE validator.
- PER release submitted via `ConnectionMagicRouter`.
- TEE status finalized with `err: null`.
- Payee balance increases.
- Escrow closes or is undelegated.
- No public mempool visibility before finalization claim, where observable.

## Risks

- CPI account metas must match SDK order exactly.
- Validator identity drift can cause rejection.
- Escrow state size changes require redeploy and fresh devnet escrows; existing accounts may not fit added fields.
- Full repo TypeScript checks currently have unrelated pre-existing failures, so validation must rely on focused tests plus CI.
- Anchor-only success is not Quasar-native success. Judge wording must keep that boundary clear.

## Feasibility call

- **Feasible with risk:** legacy Anchor live PER proof, if several focused hours and explicit approval for redeploy/live devnet mutation are available.
- **Not feasible as a quick sprint:** Quasar-native MagicBlock PER proof.

Recommended plan for the submission window:

1. Keep current judge-safe MagicBlock boundary wording in the main bounty materials.
2. If MagicBlock prize weighting is high enough, run an Anchor-only CPI sprint in a separate branch/PR.
3. Do not weaken the final Quasar claim by implying MagicBlock success unless the live smoke passes under the criteria above.
