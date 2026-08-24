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
