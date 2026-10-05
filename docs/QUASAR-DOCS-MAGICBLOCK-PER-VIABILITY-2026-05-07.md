# Quasar docs analysis for MagicBlock PER viability — 2026-05-07

> **Dated historical analysis — qualification added 2026-10-05; superseded 2026-10-02.** The crawl findings and feasibility recommendation below are preserved as 2026-05-07 technical analysis, not an active implementation or deployment plan and not execution authority. Quasar is frozen. See [`QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md`](./QUASAR-EXPERIMENTAL-FREEZE-2026-10-02.md).

## Purpose

Validate whether the Quasar-native MagicBlock PER plan is actually viable after crawling Quasar docs, rather than assuming Anchor-like behavior is available.

## Crawl / ingest

Quasar docs were crawled from `https://quasar-lang.com/docs` and the docs index, then followed through docs-internal links two-deep.

Artifacts:

- Full docs crawl index: `ingests/quasar-docs-2026-05-07/full-docs-plus-two-deep/crawl-index.json`
- Raw MDX pages: `ingests/quasar-docs-2026-05-07/full-docs-plus-two-deep/raw-mdx/`
- Coverage: 32 pages fetched, 0 errors.
- Earlier literal `/docs` two-deep crawl retained for traceability: `ingests/quasar-docs-2026-05-07/two-deep/`.

Most relevant pages:

- `docs_core-concepts_cpi.mdx`
- `docs_core-concepts_pda.mdx`
- `docs_core-concepts_instructions.mdx`
- `docs_features_remaining-accounts.mdx`
- `docs_references_account-types.mdx`
- `docs_references_account-constraints.mdx`
- `docs_getting-started_migrating-from-anchor.mdx`
- `docs_guides_build-an-escrow.mdx`

## Viability verdict

**The Quasar-native MagicBlock PER plan is viable, with one implementation constraint:** use Quasar's explicit CPI primitives and account parsing, not Quasar IDL-generated typed CPI, for MagicBlock's Permission/Delegation/Magic programs.

Reason:

- Quasar supports PDA derivation, bump storage, and PDA signing via generated `bumps.<field>_seeds()` helpers.
- Quasar supports CPI with `.invoke_signed()` and `.invoke_with_signers()`.
- Quasar supports unchecked/manual CPI passthrough accounts through `UncheckedAccount` and `RemainingAccounts`.
- Quasar supports custom instruction wire formats with explicit discriminators and tail `&[u8]` arguments.
- The vendored Quasar runtime has `DynCpiCall`, a stack-allocated dynamic CPI builder with runtime account/data length and PDA signing. This is exactly what we need for MagicBlock CPIs with optional validator and variable members payloads.

What is **not** viable / not recommended:

- Do not try to use Anchor MagicBlock macros (`#[ephemeral]`, `#[delegate]`, `#[commit]`) in the Quasar final path.
- Do not rely on `declare_program!` for MagicBlock unless we have compatible IDLs and only primitive/address args. Quasar docs say `declare_program!` supports primitive/address CPI args; MagicBlock permission member vectors are more complex.
- Do not pass arbitrary unbounded member lists. Keep the PER member set bounded and encode it manually.

## Quasar feature mapping to MagicBlock PER

| MagicBlock requirement | Quasar support | Plan adjustment |
| --- | --- | --- |
| Escrow PDA must sign permission/delegation CPI | PDA docs: stored bumps + `*_seeds()` + `.invoke_signed()` | Use `bumps.escrow_seeds()` for every MagicBlock CPI that needs escrow PDA authority. |
| Create/delegate permission account | CPI docs + `UncheckedAccount`/`Program<T>` account types | Define MagicBlock program marker IDs and manual account structs; encode instruction bytes from SDK fixture. |
| Delegate escrow PDA to TEE validator | CPI + account constraints + remaining accounts | Pass delegation buffer/record/metadata and optional validator explicitly; validate expected MagicBlock program IDs. |
| TEE release while delegated | Quasar instructions are normal Solana instruction handlers | Reuse `take` if delegated account ownership/routing accepts it; otherwise add `release_private` discriminator with same semantics. |
| Commit / commit-and-undelegate | Manual CPI to Magic Program / Permission Program | Build Magic intent CPIs manually using byte layouts; use `DynCpiCall` if data/account counts vary. |
| Undelegate callback discriminator | Quasar explicit instruction discriminators | Use a multi-byte discriminator `[196, 28, 41, 206, 48, 37, 51, 167]` if Quasar permits same-length discriminator set for the program; otherwise add a thin raw-dispatch compatibility shim. |
| Optional validator account | Account types include `Option<&T>` and remaining accounts | Prefer typed `Option<&UncheckedAccount>` if macro supports it cleanly; otherwise use `CtxWithRemaining` and explicit validation. |
| Variable permission members | Quasar dynamic args / tail args exist, but no heap | For hackathon, use a fixed minimal members payload first; optionally accept tail `&[u8]` for pre-encoded `MembersArgs`. |

## The important discriminator caveat

Quasar docs state all instruction discriminators in a program must have the same byte length. Current Quasar escrow uses single-byte discriminators (`0`, `1`, `2`). MagicBlock native ER callback requires exact 8-byte discriminator `[196, 28, 41, 206, 48, 37, 51, 167]`.

This is the only real design wrinkle.

Options:

1. **Migrate Quasar escrow to 8-byte discriminators**
   - Cleanest protocol-level match.
   - More client changes because current Quasar instruction builders use single-byte discriminators.
   - Best if we are deploying a new PER-enabled Quasar escrow program ID anyway.

2. **Add a minimal raw-dispatch compatibility shim before Quasar dispatch**
   - Detect the exact 8-byte MagicBlock callback discriminator and handle it separately.
   - Let normal Quasar single-byte instructions continue unchanged.
   - More framework-adjacent/hacky, but lowest demo disruption if Quasar macro enforces same discriminator length.

3. **Ask MagicBlock if callback discriminator can be configured**
   - Lowest code if yes, but too risky for hackathon timing.

Recommendation: **Option 1 for correctness if we deploy a new PER-specific escrow program; Option 2 only if we need to preserve existing single-byte deployed Quasar program ABI.**

## Stack / data sizing check

Vendored `DynCpiCall` enforces:

`56 * MAX_ACCTS + 24 * MAX_ACCTS + MAX_DATA + 24 <= 3072`

So:

- 12 accounts leaves ~2,088 bytes for instruction data.
- 16 accounts leaves ~1,768 bytes.
- MagicBlock permission/delegation instruction data for a bounded hackathon member list should fit comfortably.

If we need many members, encode members off-chain into a bounded tail payload and cap member count hard. For the bounty proof, a single payer/authority member with required visibility flags is enough.

## Implementation recommendation update

Update the prior Quasar-native PER plan as follows:

### Phase A — Quasar PER ABI decision

Before coding MagicBlock CPI, decide whether the PER-enabled Quasar escrow program gets a new 8-byte discriminator ABI. My recommendation is **yes**:

- Use new PER-specific Quasar escrow program ID.
- Keep existing deployed Quasar escrow stable for current demo.
- Make all PER program instructions use 8-byte discriminators so the MagicBlock undelegate callback is natively representable.

### Phase B — Manual MagicBlock CPI codec

Implement `experiments/quasar-escrow/src/magicblock/`:

- `constants.rs` — MagicBlock program IDs, validator IDs, seed tags.
- `layout.rs` — instruction data encoders tested against `artifacts/magicblock-cpi-layout/latest.json`.
- `cpi.rs` — manual `DynCpiCall` builders with explicit account meta flags and `invoke_signed`.

### Phase C — Account structs

Use Quasar typed validation where stable:

- `payer: &mut Signer`
- `escrow: &mut Account<EscrowAccount>` with `seeds` and `bump = escrow.bump`
- MagicBlock accounts as `UncheckedAccount` plus manual address/owner/writable checks
- MagicBlock executable programs as `Program<PermissionProgram>` / `Program<DelegationProgram>` / `Program<MagicProgram>` if marker types are straightforward, otherwise `UncheckedAccount` with explicit executable/address checks.

### Phase D — Local tests first

Add local tests for:

- instruction byte layout parity vs SDK fixture,
- PDA seed helper use for escrow signer,
- account list order/flags for CreatePermission, DelegatePermission, DelegateAccount, CommitAndUndelegatePermission, Magic commit-and-undelegate,
- 8-byte callback discriminator dispatch.

### Phase E — Live devnet only after approval

Only after local compile/tests pass:

- deploy PER-enabled Quasar escrow program,
- run bounded devnet TEE flow,
- capture evidence pack.

## Final confirmation

The plan is viable **if** we treat Quasar as a low-level Solana framework with explicit CPI and no heap, not as a drop-in Anchor macro environment. The only material adjustment is handling MagicBlock's exact 8-byte undelegate callback discriminator. A new PER-specific Quasar escrow ABI avoids that conflict cleanly and is the path I recommend for the hackathon proof.
