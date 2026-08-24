# Quasar job-binding — design for closing the four Criticals

_Date:_ 2026-08-24 · _Status:_ design, pre-implementation
_Closes:_ CRITICAL-1, CRITICAL-2, CRITICAL-3, CRITICAL-4 from
`docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`
_Blocker list:_ items 1 (job/escrow binding) of the five in
`docs/QUASAR-PROGRAMS-SECURITY-AUDIT-RESPONSE-2026-05-06.md`

## The single root cause

All four Criticals are one bug wearing four hats: **`job_id` is a free-form
`u128` chosen by the caller, and nothing on-chain ties it to a real job or to
the parties who worked it.**

Every downstream account inherits that weakness:

| Program | PDA seeds today | Parties come from | Consequence |
|---|---|---|---|
| `quasar-reputation` | `[b"rating", job_id]` | `consumer_pk` / `specialist_pk` **instruction args** | C-1 squatting, C-4 grief |
| `quasar-attestation` | `[b"attestation", job_id]` | `consumer` **instruction arg** (judge-supplied) | C-2 self-confirmation, C-3 unbounded creation |

Verified still present in code as of `ee39cdf` (2026-08-24): `commit()` in
`experiments/quasar-reputation/src/instructions/commit.rs` still takes
`consumer_pk: Address, specialist_pk: Address`, and the `Commit` accounts
struct still contains no escrow account.

## The fix: the escrow account *is* the job record

`quasar-escrow` already holds exactly the facts the other two programs are
currently trusting the caller for:

```rust
#[seeds(b"escrow", payer: Address, escrow_id: u64)]
pub struct EscrowAccount {
    pub payer: Address,   // the consumer
    pub payee: Address,   // the specialist
    pub escrow_id: u64,
    pub amount: u64,
    pub status: u8,
    ...
}
```

It is created by `lock`, which requires the payer to sign and to move real
lamports, and its PDA is derived from `payer` — so it cannot be forged or
squatted. That makes it a sound canonical job record, with no new program or
account type required.

**The change, in one sentence:** reputation and attestation stop *accepting*
the parties and start *deriving* them from an escrow account passed in and
verified to be owned by `quasar-escrow`.

### Mechanism

The vendored framework already supports the required cross-program check:
`InterfaceAccount<T>` validates an account's owner against `T::owners()`
(`third_party/quasar/lang/src/accounts/interface_account.rs`), returning
`IllegalOwner` on mismatch. Each consuming program declares a local mirror of
the escrow layout whose `owners()` returns the pinned `quasar-escrow` program
ID and whose `check` enforces discriminator `10`.

This is the first use of `InterfaceAccount` in this repo, so the mirror type
and its owner/discriminator assertions need their own unit tests, not just
integration coverage.

### Per-program changes

**`quasar-reputation::commit`**
- Accounts gain `escrow: &'info InterfaceAccount<EscrowRef>` (read-only).
- Rating PDA seeds become `[b"rating", escrow_address]`.
- `consumer` ← `escrow.payer`; `specialist` ← `escrow.payee`.
- Instruction args `consumer_pk` / `specialist_pk` are **removed**.
- `job_id` stays in the commitment pre-image (preserving the audit-hardened
  `sha256(score ‖ salt ‖ job_id ‖ program_id)`) but is now *checked* against
  the escrow's identity rather than caller-chosen.

**`quasar-attestation::attest`**
- Same escrow account and owner check.
- Attestation PDA seeds become `[b"attestation", escrow_address]`.
- `consumer` ← `escrow.payer`; the judge-supplied `consumer` arg is **removed**.
- Existing `judge != consumer` guard retained as defence in depth.

**`quasar-reputation::expire`** — retain the participant-only caller check
already added in the May remediation.

### Why each Critical closes

| Finding | Closure argument |
|---|---|
| **C-1** rating-PDA squatting | The PDA cannot exist without an escrow, and the parties are read from it. An attacker cannot name themselves specialist for someone else's job — they would have to be `escrow.payee`, which only the payer can set, by locking real funds. |
| **C-2** judge self-confirmation | The judge no longer supplies `consumer`; it is `escrow.payer`. To confirm their own attestation a judge must be the payer of a real escrow — and the `judge != consumer` guard then rejects it. |
| **C-3** unbounded attestation creation | Each attestation now requires a distinct real escrow. Creation is bounded by escrows actually locked, at real lamport cost. |
| **C-4** reputation grief | Grief required squatting a rating against a victim (C-1). With parties derived from an escrow the victim is party to, a third party cannot open a rating against them at all. |

### What this does *not* close — stated plainly

- **HIGH-3 reputation laundering.** A payer can still lock an escrow to a
  wallet they control and farm a mutual rating. Binding raises the price (a
  real escrow, real lamports) but does not eliminate self-dealing. Needs an
  economic/policy answer, tracked separately. A cheap partial step worth
  taking in the same change: reject `escrow.payer == escrow.payee`.
- **HIGH-7 split registries** — unchanged by this work.
- **HIGH-2 payee dispute path** — unchanged by this work.

Blockers 2–4 of the five in the audit response therefore remain open after
this change. This closes blocker 1 only, and blocker 5 (re-review) becomes
due.

## Blast radius

This is a **breaking on-chain interface change**, and the cost is mostly
downstream of the programs themselves:

1. **PDA seeds change** → existing devnet rating/attestation accounts are
   orphaned. Acceptable (devnet, demo data), but must be stated in the
   redeploy note rather than discovered.
2. **Instruction args change** → TS clients must be updated:
   `lib/quasar/instruction-builders.ts`, `lib/quasar/instructions.ts`, and the
   seed/discriminator mirrors in `lib/program.ts`.
3. **Call ordering changes** → an escrow must exist *before* a rating or
   attestation. Any demo or test that exercised reputation standalone must
   now lock an escrow first (`packages/demo-agents`).
4. **Redeploy required** for reputation + attestation; `config/quasar/deployments.json`
   needs new evidence entries.
5. **Audit handoff re-freeze** — `docs/SOLANA-EXTERNAL-AUDIT-HANDOFF-2026-06-24.md`
   pins input commit `3561dc5`; it must be re-pinned post-fix, and the ABI
   appendix regenerated (seeds and instruction args both change).

## Sequencing

1. Escrow mirror type + pinned program-ID constant, with owner/discriminator unit tests. ← *first slice*
2. `quasar-reputation` binding + regression tests that **reproduce C-1 and C-4 as negative tests** (the squat must now fail).
3. `quasar-attestation` binding + negative tests for C-2 and C-3.
4. TS client + `lib/program.ts` mirror updates; jest green.
5. `packages/demo-agents` ordering fix; BDD/evidence regeneration.
6. Devnet redeploy + `deployments.json` evidence.
7. Re-freeze the audit handoff; regenerate the ABI appendix.

Steps 1–3 are self-contained and independently verifiable with
`bash scripts/run-quasar-program-tests.sh`. Steps 4–7 are the integration
tail and should not start until 1–3 are green.

## Open decision for the maintainer

Redeploying replaces the devnet programs the demo evidence was captured
against. Two options:

- **Redeploy in place** (same program IDs, upgrade authority) — evidence
  regenerates, old artifacts become historical. Simpler.
- **Deploy alongside** as new IDs and cut over — keeps the old demo path
  reproducible during the transition, at the cost of a second program set.

Recommendation: redeploy in place. The demo target is devnet, the evidence is
regenerable, and carrying two program sets adds exactly the sort of
config ambiguity the audit-prep work has been removing.

---

# Implementation outcome (2026-08-24)

Steps 1–3 of the sequence are complete and verified. Full loop green via
`bash scripts/run-quasar-program-tests.sh` — **102 tests**: escrow 8,
escrow-per 40, registry 10, reputation 20, attestation 19, escrow-ref 5.

## What actually closed

| Finding | Status | Evidence |
|---|---|---|
| **C-1** rating-PDA squatting | **Closed** | `test_audit_critical1_attacker_cannot_elect_self_specialist`, `..._forged_escrow_rejected`, `..._wrong_escrow_discriminator_rejected` |
| **C-2** judge self-confirmation | **Closed** | `test_audit_critical2_judge_as_consumer_rejected`, `..._judge_as_specialist_rejected` |
| **C-3** unbounded attestation creation | **Closed** | `test_audit_critical3_forged_escrow_rejected`, `..._wrong_escrow_discriminator_rejected`, `..._attestation_is_bound_to_its_escrow` |
| **C-4** reputation grief | **Mitigated, not closed** | see below |

Every negative test asserts the **exact** `InstructionError` rather than mere
failure, and the shared-fixture ones are paired with a positive control, so a
rejection cannot pass for an incidental reason (a missing account would also
produce `is_err()`). Observed: forged/self-owned escrow → `IllegalOwner`;
escrow-owned wrong type → `InvalidAccountData`; wrong signer, judge conflict or
self-dealt escrow → `InvalidArgument`; mismatched escrow/PDA →
`QuasarError::InvalidPda`.

## Two things the design did not anticipate

**1. The escrow is destroyed at settlement.** `quasar-escrow::release` and
`::cancel` both carry `close = payer`, so the escrow account only exists while
`Locked`. Consequences:

- Ratings and attestations must be opened against a *live* escrow. The call
  order is **lock → commit/attest → release → reveal/confirm**.
- Only `commit` and `attest` can owner-check the escrow. `reveal`, `expire`,
  `confirm` and `dispute` take the escrow as a **seed-only** `UncheckedAccount`
  and place no trust in it — the PDA constraint already proves it is the escrow
  the record was bound to, and the bound address is stored on-chain.
- Requiring `status == Released` as proof of settled work is therefore
  impossible without a receipt account that outlives the escrow. Not attempted
  here; worth considering separately.

**2. `lock` accepts an unconsented payee — so C-4 survives in reduced form.**
`quasar-escrow::lock` declares `payee` as an unsigned `UncheckedAccount`, so a
payer may name any wallet. A griefer can therefore lock an escrow naming a
victim as payee, commit as consumer, and expire the rating after the window to
deduct the victim's reputation. The victim never agreed to anything.

Binding raises the cost from rating rent (~1500 lamports) to a funded escrow
held for the full seven-day window, which is a real improvement, but it does not
eliminate the path. **The design's original C-4 closure argument — "a third
party cannot open a rating against them at all" — was wrong on this point**: a
payer is not a third party to an escrow they created, even when the payee never
consented.

This is pinned by `test_known_residual_critical4_unconsented_payee_can_be_griefed`,
which deliberately asserts the grief *succeeds*. It is a tripwire: when the fix
lands, that test must be inverted.

Two candidate closures, both outside this change's scope:

- **Payee consent at lock time** — require the payee's signature in
  `quasar-escrow::lock`, or add an explicit accept step. Fixes the root cause,
  but changes the escrow interface and the demo flow.
- **Two-signature rating open** — require both parties to sign the call that
  creates the rating account. The audit's "weaker fix" for C-1, which happens to
  close this residual too. Cheaper, but splits `commit` into open-then-commit.

Recommendation: payee consent, because the unconsented payee is a defect in its
own right regardless of reputation — an escrow can currently be created naming
anyone. This should be filed as a new finding against `quasar-escrow`, not
carried as reputation debt.

## Deviations from the design as written

- **Commitment pre-image is domain-separated on the escrow address, not
  `job_id`.** The design said `job_id` would stay in the pre-image and be
  "checked against the escrow's identity". Implemented as
  `sha256(score ‖ salt ‖ escrow_address ‖ program_id)` instead: `escrow_id` is
  only unique *per payer*, so it is a weaker separator than the escrow address,
  which is globally unique and unforgeable. `job_id` is retained as a derived
  account field (`escrow.escrow_id` widened) for parity and indexers, but is no
  longer an instruction argument anywhere.
- **The escrow mirror is a shared crate**, `experiments/quasar-escrow-ref`, not
  a per-program type. Two hand-maintained copies of a foreign account layout is
  exactly the drift risk the layout assertions exist to catch, so there is one
  canonical definition with one set of offset tests, consumed by both programs
  and exercised by the test runner.
- **`#[account]` cannot generate the mirror.** The macro hardcodes
  `impl Owner { const OWNER: Address = crate::ID; }`, so a mirror declared that
  way would claim the *consuming* program as owner. The traits are hand-written,
  following the `quasar-spl` `Token`/`Mint` precedent. `impl_program_account!` is
  crate-local to `quasar-spl` and not exported, so it could not be reused.
- **Extra attestation guards.** `judge != escrow.payee` (a judge must not grade
  their own work) and `payer != payee` were added — both only became checkable
  once the escrow named the parties.

## Still open after this change

- **HIGH-3 reputation laundering** — a payer can still use a second wallet they
  control. `payer != payee` blocks only the degenerate case. Needs an economic
  answer.
- **HIGH-7 split registries**, **HIGH-2 payee dispute path** — untouched.
- **C-4 residual** — as above.

Blocker 1 of the five in the audit response is closed for C-1/C-2/C-3 and
partially for C-4. Blockers 2–4 remain; blocker 5 (re-review) is now due.

## Remaining sequence

Steps 4–7 are unchanged and not started: TS client + `lib/program.ts` mirrors,
`packages/demo-agents` call ordering (an escrow must now be locked before any
rating or attestation), devnet redeploy **in place** (maintainer-approved), and
the audit handoff re-freeze with a regenerated ABI appendix. Note for step 4:
account order changed in every affected instruction, not just the argument list.
