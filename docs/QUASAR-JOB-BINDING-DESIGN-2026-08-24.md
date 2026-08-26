# Quasar job-binding — design for closing the four Criticals

_Date:_ 2026-08-24, corrected 2026-08-25 after independent review
_Status:_ **C-1 closed. C-2, C-3 and C-4 remain OPEN — rework required.**

> ⚠️ **Read the final section first.** This document's earlier sections argued
> that all four Criticals were closed. An independent review reproduced working
> exploits for C-2, C-3 and C-4 against the merged code. Every closure claim in
> this document other than C-1 is superseded by
> "Independent review — corrected status (2026-08-25)" at the end.

_Closes:_ **CRITICAL-1 only**, from
`docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`.
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

### Steps 4 and 6 must land together

After this change there are three versions of the interface in play:

| Surface | State |
|---|---|
| `experiments/quasar-*` source | **new** (escrow-bound) |
| `lib/quasar/instructions.ts`, demo agents | old — still derives the rating PDA from `jobId` (`instructions.ts:101`), and `demo.ts` still locks without the payee signing |
| Devnet programs at `nb9rLV…` / `CRGsWW…` | old — not yet redeployed |

The client and the chain still agree with each other, so **nothing is broken
today**; the source is simply ahead of both. That stops being true the moment
either one moves alone:

- TS client updated **before** the redeploy → new-format instructions sent to
  old programs → the demo fails.
- Redeploy **before** the TS client → old-format instructions sent to new
  programs → the demo fails.

So steps 4 and 6 ship as one change, not as two merges. The readiness guard
(`npm run check:quasar:submission`) will **not** catch this — it validates
program IDs and config, not ABI against source — so it passing is not evidence
the demo works.


---

# Payee consent at lock time (2026-08-25) — does NOT close C-4

> **Superseded.** This section originally claimed to close CRITICAL-4. It does
> not; see the final section. The *mechanism* below is real and landed, and it
> is worth keeping on its own merits — an escrow being a bilateral agreement is
> correct regardless. Only the closure claim was wrong.

Maintainer accepted the recommendation. `quasar-escrow::lock` now requires the
**payee's signature**.

## The change

`payee` was an unsigned `UncheckedAccount`; it is now a `Signer`. An escrow is
therefore a bilateral agreement rather than something a payer can create
unilaterally naming any wallet. The same change is applied to
`quasar-escrow-per::lock`, so the weaker of the two escrow programs cannot be
used as a way around the rule.

## Why this was believed to close CRITICAL-4 (wrong — see final section)

The grief required an escrow naming a victim who had never agreed to the job:
lock naming the victim as payee → open a rating against it → let it expire →
the victim absorbs the reputation penalty. That escrow can no longer be created,
so the attack has no starting point.

It also repairs the foundation of the whole job binding. `quasar-reputation` and
`quasar-attestation` read the job's parties from an escrow and trust it purely
because `quasar-escrow` owns it. That trust was only ever as strong as the
weakest escrow the escrow program would create — and before this, that was an
escrow one party never consented to. Consent at lock time is what makes the
owner check mean what the binding needs it to mean.

## Where the regression lives

The load-bearing test is with the rule it enforces:

    experiments/quasar-escrow/src/tests.rs
      -> test_audit_lock_without_payee_signature_rejected

It asserts the unsigned-payee lock fails and pairs it with a positive control on
the same fixtures.

The reputation-side tripwire that previously asserted the grief *succeeded* has
been **removed, not inverted**. Inverting it there would have been theatre: the
reputation tests fabricate escrow byte images directly rather than calling
`lock`, so no reputation-side test can create or reject an unconsented escrow.
What reputation still owes the guarantee is the owner check — that a forged
escrow cannot stand in for a real one — and that half stays pinned by
`test_audit_critical1_forged_escrow_rejected`,
`test_audit_critical1_wrong_escrow_discriminator_rejected`, and the
pinned-program-ID assertions in `quasar-escrow-ref`.

## Verification

`bash scripts/run-quasar-program-tests.sh` — **103 tests green**: escrow 9
(+1 consent regression), escrow-per 40, registry 10, reputation 20,
attestation 19, escrow-ref 5.

## Consequence: lock becomes a two-signature transaction

This is a real interface change, not just a guard. Every caller that builds a
`lock` instruction must now mark `payee` as a signer and have the payee sign.

`packages/demo-agents/src/demo.ts:380` currently signs with `[AGENT_A_KEYPAIR]`
only, and marks `payee` `isSigner: false`. `AGENT_B_KEYPAIR` is already imported
in that file, so the fix is small — but it is a **client** change, and per the
step 4/6 rule below it ships with the redeploy, not before it. Updating it now
would break the demo against the currently deployed programs.

For any flow where the payee is a remote agent that cannot co-sign
interactively, the alternative shape is a separate `accept` instruction the
payee calls after `lock`, with reputation and attestation gated on an
`accepted` flag. That was not chosen here — "consent at lock time" is the
stronger and simpler rule — but it is the fallback if a future non-interactive
hiring flow needs one.

## Still open

Unchanged by this: **HIGH-3** reputation laundering (a payer can still use a
second wallet they control — `payer != payee` blocks only the degenerate case),
**HIGH-7** split registries, **HIGH-2** payee dispute path.


---

# Independent review — corrected status (2026-08-25)

An independent reviewer, with no part in writing the change, reviewed
`git diff ee39cdf 2c9e4e3` (PRs #642 and #643 together) and produced runnable
proof-of-concepts. **All three were re-run against the merged tree and
reproduce.** This section supersedes every closure claim above except C-1.

| Finding | Previously claimed | Actual |
|---|---|---|
| **C-1** rating-PDA squatting | Closed | **Closed** — independently confirmed |
| **C-2** judge self-confirmation | Closed | **OPEN** |
| **C-3** unbounded attestation creation | Closed | **HALF OPEN** — creation bounded, squatting untouched |
| **C-4** reputation grief | Closed | **OPEN** — settlement race |

## C-4 — the settlement race

`quasar-escrow::release` is payer-only, carries `close = payer`, and has no
time-lock. The payer therefore controls, unilaterally, the window in which the
payee can open a rating. In a single transaction the payee cannot influence:

1. `lock(payer=P, payee=V)` — V signs; a fully consented, ordinary job.
2. `commit(role=0)` by P — rating created, `state = Pending`.
3. `release` by P — escrow closed and reassigned to the system program.

V can then never commit: `commit` requires a live escrow via `InterfaceAccount`,
which returns `IllegalOwner` on the dead account. `expire` takes the escrow as a
**seed-only** account and does not need it to exist, so after the window P
expires the rating and V is penalised.

    specialist commit after release -> Err(IllegalOwner)
    specialist reputation 1000 -> 500, jobs_failed 1

Cost to the griefer is rating rent alone (~0.00232 SOL, unreclaimable — `expire`
does not close the rating). The escrow rent and principal return via `release`
in the same transaction, so the "must hold a real escrow for the full expiry
window" argument above is wrong on economics as well as mechanism.

**Corollary — a regression this work introduced.** Reputation coverage is now at
the payer's discretion: any payer can guarantee they are never rated by
releasing before the counterparty commits. Before the binding, either party
could open a rating at any time. The original audit does not cover this.

Pinned by `test_known_open_critical4_settlement_race_grief` in
`experiments/quasar-reputation/src/tests.rs`, which deliberately asserts the
grief **succeeds**. Invert it when the fix lands.

## C-2 — address distinctness is not actor distinctness

`attest.rs` rejects `escrow.payer == judge` and `escrow.payee == judge`. A judge
does not need to *be* the payer — only to hold the payer's key. With two
throwaway keypairs the judge signs `lock` for both (payee consent is satisfied;
the judge owns that key), attests, and confirms. Every guard passes.

    after 12 cycles: judge reputation_score = 7173, attestation_accuracy = 10000

Marginal cost is attestation rent only; the audit priced pre-fix C-2 at
~0.002 SOL per cycle, so **the cost is unchanged**.

This is the identical mechanism to **HIGH-3**, which this document already lists
as open. If HIGH-3 is open, C-2 is open — an internal inconsistency that should
have been caught before the closure was claimed.

## C-3 — only half the finding was addressed

The audit lists two impacts. "Unbounded creation" is genuinely bounded now.
"Squatting / DoS on legitimate attestations" is untouched: nothing checks that
the judge was hired for the job, so any eligible judge can front-run any real
escrow, and `init` then permanently blocks the real judge.

    squatter attests a job it was never hired for -> Ok
    legit judge attest -> Err(AccountAlreadyInitialized)

Binding the PDA to a real escrow narrowed the target set from "all u128" to
"every real job" — which is the set an attacker actually wants.

## The mirror layout guard was circular — FIXED 2026-08-26

`EscrowRefData` was byte-exact, but `layout_matches_escrow_account` asserted it
against hardcoded integers — against itself — and `quasar-escrow-ref` could not
depend on `quasar-escrow` because that crate's `mod state` was private. Adding a
field upstream would have left every test green while `payer`/`payee` were read
from the wrong offsets.

**Fixed.** `quasar-escrow`'s `state` is now public, `quasar-escrow-ref` takes it
as a **dev-dependency** (test-time only — the mirror still links nothing at
runtime, which is its reason for existing), and
`layout_matches_real_escrow_account` asserts the mirror against the real
generated `EscrowAccountZc`: total size against `<EscrowAccount as Space>::SPACE`,
payload size, the discriminator, per-field `offset_of!` equality, and a
trailing-field check.

The guard was verified to actually fail, not merely to pass — a passing guard
proves nothing, which is how the circular version survived. Two drift shapes were
simulated upstream and both were caught:

| Drift | Caught |
|---|---|
| Field inserted mid-struct (shifts `payee`) | ✅ |
| Field appended after `bump` (all existing offsets still valid) | ✅ |

## The owner check pins an address, not code

`QUASAR_ESCROW_PROGRAM_ID` pins a program deployed under an upgradeable loader.
Whoever holds the escrow upgrade authority can change what `payer`/`payee` mean
for both consuming programs. Reputation and attestation therefore carry a trust
dependency on that upgrade authority, which the external auditor needs told.

Related deployment hazard: the escrow program **currently on devnet still
accepts an unsigned payee**. Redeploying reputation/attestation before escrow
would leave the old C-4 variant open with CI fully green.

## Verified sound — not to be re-litigated

The mechanism-level work held up: the `InterfaceAccount` owner and discriminator
check; PDA binding for seed-only accounts (both `bump` forms reach the same
`verify_program_address`, so a substituted escrow requires a PDA collision); the
mirror layout itself; absence of PDA aliasing; `init_if_needed` re-entry; the
zero-`escrow` sentinel; arithmetic bounds; and that `&Signer` genuinely enforces
a signature. **C-1 genuinely closes.**

The failures were in the closure *arguments*, not the plumbing: two of them
treated "is not this address" as equivalent to "is not this actor", and one
treated an account the attacker can destroy on demand as a durable binding.

## Rework required

- **C-4** — a job record that outlives settlement (have `release` write a
  receipt rather than closing the escrow, and bind ratings to that), or enrol
  the rating at `lock` time inside the bilateral transaction. The receipt option
  also unblocks the `status == Released` check this document earlier concluded
  was impossible.
- **C-2 / C-3** — judge nomination recorded on the job record at lock time,
  signed by both parties. Address-distinctness is not a defence against a single
  operator holding two keys.
- ~~**Mirror guard**~~ — **done 2026-08-26**, see above.

Blocker 1 of the five in the audit response is therefore **not** closed for
C-2/C-3/C-4. Blocker 5 (external re-review) must not be scheduled against the
current state under a "four Criticals closed" label.
