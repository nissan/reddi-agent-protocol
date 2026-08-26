# CRITICAL-4 — durable job record

_Date:_ 2026-08-26 · _Status:_ design, pre-implementation
_Closes:_ CRITICAL-4 (reputation grief) from
`docs/QUASAR-PROGRAMS-SECURITY-AUDIT-2026-05-06.md`
_Supersedes:_ the C-4 closure arguments in
`docs/QUASAR-JOB-BINDING-DESIGN-2026-08-24.md`, both of which were wrong.

## Read this first: two closure arguments have already failed here

C-4 has been declared closed twice and was exploitable both times. The failures
were not implementation bugs — the code did what it was written to do. They were
reasoning errors, and both are worth naming, because this design has to survive
the same scrutiny.

1. **Job binding (#642).** Argument: "a third party cannot open a rating against
   someone they have no relationship with." Wrong because a *payer* is not a
   third party to an escrow they created, and `lock` let them name any payee.
2. **Payee consent (#643).** Argument: "the victim never agreed to anything, and
   now they must." Wrong because consent was never the load-bearing property.
   The victim in the live attack *does* consent — to an ordinary job.

The actual property C-4 depends on has been the same all along and was missed
twice: **can one party unilaterally deny the other the ability to rate them?**
Every candidate fix below is judged against that question and no other.

## The live attack

`quasar-escrow::release` is payer-only, carries `close = payer`, and has no
time-lock. `quasar-reputation::commit` requires a **live** escrow (it reads the
parties through `InterfaceAccount`, which fails `IllegalOwner` on a closed
account), while `expire` needs only the escrow *address* as a PDA seed and works
fine against an account that no longer exists.

That asymmetry is the bug. In one transaction the payee cannot influence:

    lock(payer=P, payee=V)   -- V signs; an ordinary, fully consented job
    commit(role=0)  by P     -- rating created, state = Pending
    release         by P     -- escrow closed, zeroed, reassigned to system

V can never commit. After `RATING_EXPIRE_SLOTS`, P calls `expire` and V takes the
penalty. Cost to P: rating rent only (~0.00232 SOL); the escrow rent and the
principal both come back via `release` in the same transaction.

Reproduced by `test_known_open_critical4_settlement_race_grief`.

**The same shape exists via `cancel`**, which also carries `close = payer`. Its
7-day `CANCEL_WINDOW_SLOTS` makes it slower, not safe — and the rating expiry
window is the same 7 days, so the two overlap.

## The fix: the escrow account stops being destroyed

**`release` and `cancel` set a terminal status and keep the account.** That is
the whole change.

```rust
// release.rs and cancel.rs
#[account(mut, has_one = payer, seeds = ..., bump = escrow.bump)]  // no `close = payer`
pub escrow: &'info mut Account<EscrowAccount>,
```

Lamport flow is otherwise unchanged: `release` still pays `amount` to the payee,
`cancel` still refunds it to the payer. What changes is that the rent-exempt
minimum stays in the account instead of being swept, so the record survives.

### Why this closes C-4

Against the property that actually matters — *can one party unilaterally deny
the other the ability to rate them?* — the answer becomes no, because the
denial mechanism was the account's destruction and there is no longer any
instruction that destroys it. Not "harder", not "more expensive": absent.

Concretely: every escrow account is created by `lock` (both parties sign) and
from then on exists forever. `commit` therefore succeeds for either party at any
time, in any status. The payer has no lever over the payee's ability to rate.

### Why not the alternatives

**A separate receipt account written by `release`.** Considered and rejected.
It adds an account type, a second set of PDA seeds, a new binding target for
both consuming programs, and a client change to every rating and attestation
derivation — to achieve exactly what not-closing achieves. Its one advantage is
reclaimable escrow rent, which the optional follow-on below recovers anyway.

**Enrolling the rating at `lock` time.** Forces rent for a rating on every job
whether or not anyone rates, and does not by itself stop `release` from closing
the escrow that `reveal`/`expire` still reference.

**Blocking `expire` when the escrow is gone.** Treats the symptom. The payee is
still locked out of `commit`, so the rating is dead either way — it converts a
reputation attack into a denial-of-rating, which is the same finding wearing a
third hat.

## What this does *not* close — stated before anyone asks

- **The payer can withhold settlement.** A payer who never releases and never
  cancels leaves the escrow `Locked`. Under this design that does **not** block
  rating — `commit` works in any status — so it is not a C-4 residual. It is
  HIGH-2 (no payee dispute path), already open, and this design neither helps
  nor harms it.
- **HIGH-3 laundering.** Untouched. A payer with two wallets can still farm.
- **C-2 / C-3.** Untouched by this design. See the follow-on note below.
- **Rent.** Every settled job now permanently costs the payer the escrow's
  rent-exempt minimum (~0.0016 SOL). This is a real, recurring cost and it is
  the price of the fix.

## The state matrix — enumerated, because this is where holes hide

With the account permanently alive, `escrow.status` no longer gates anything for
*safety*; it is available for policy. The proposal is that reputation ignores it:

| `escrow.status` | `commit` | `reveal` | `expire` |
|---|---|---|---|
| `Locked` (0) | allowed | allowed | allowed |
| `Released` (1) | allowed | allowed | allowed |
| `Cancelled` (2) | allowed | allowed | allowed |

Deliberately uniform. The reasoning: any status-gate reintroduces a lever for
whichever party controls that status transition — and both transitions are
payer-only. Gating `commit` on `Released` would hand the payer a fresh denial
mechanism (withhold release, never be rated), which is the exact bug class this
document exists to close.

**This is the design's most contestable choice**, because it means a rating can
be opened against a job that was later cancelled and never performed. The
counter-argument is that `expire` exists precisely to record a party who did not
engage, and cancellation is often *evidence* of that. If the maintainer prefers
reputation to reflect only settled work, the safe form is to gate `reveal`
finalisation rather than `commit` — never the instruction that opens the record.

## Optional follow-on: reclaiming the rent

If the permanent rent is unacceptable, add `close_settled_escrow` to
`quasar-escrow`, callable by the payer, gated on:

- `status != Locked`, and
- a `RatingAccount` passed in, owner-checked against `quasar-reputation`, whose
  PDA derives from this escrow's address, in a terminal state (`Revealed` or
  `Expired`), **or** the rating account not existing and the expiry window
  having elapsed.

This inverts the current dependency direction — escrow would import a mirror of
reputation's account — so it needs its own review. Not part of the C-4 fix; the
fix is correct without it.

## Follow-on this design enables (C-2 / C-3)

A permanent escrow is also the natural home for a **judge nomination**: a
`judge: Address` field written at `lock` time, when both parties already sign.
`attest` would then require `judge == escrow.judge` instead of merely
`judge != payer && judge != payee`, which closes C-2 (the judge is chosen by the
job, not self-selected) and C-3's squatting half (only the nominated judge can
create the attestation).

Noted here because the durable record is a prerequisite. Designed separately.

## Blast radius

1. **`quasar-escrow`** — `release.rs` and `cancel.rs` drop `close = payer`.
   `quasar-escrow-per` has the same `close = payer` on its release and needs the
   same treatment, or it remains a way around the rule.
2. **Lamport assertions change.** Tests and demo scripts that assert the payer
   is made whole on release/cancel, or that the escrow account disappears, will
   need updating — `test_lock_and_release`, `test_lock_and_cancel`,
   `test_release_after_cancel_fails` at minimum.
3. **No PDA or instruction-argument changes.** The rating PDA stays
   `[b"rating", escrow_address]`; attestation stays `[b"attestation", escrow_address]`.
   No TS client change is required by this fix. That is a deliberate property of
   choosing "stop closing" over "add a receipt".
4. **`test_known_open_critical4_settlement_race_grief` must be inverted** — it
   currently asserts the grief succeeds.
5. **Redeploy** of `quasar-escrow` (+ `escrow-per`), joining the existing
   step 4/6 batch. Note the ordering hazard already recorded: the escrow on
   devnet still accepts an unsigned payee, so escrow must be redeployed **with
   or before** reputation/attestation.

## Pre-mortem: how this design could still be wrong

Written deliberately, given the record. Each is a question a reviewer should
attack rather than take on trust:

- **Is there any other instruction that can destroy or repurpose an escrow
  account?** The fix rests entirely on "no instruction closes it". This must be
  re-checked across *both* escrow programs, including any future upgrade —
  `close`, `set_lamports` to zero on a non-rent-exempt balance, or a realloc.
- **Can lamports be drained to below rent-exemption?** `release` subtracts
  `amount` from the escrow's balance. If `amount` could ever equal the full
  balance including rent, the account would be garbage-collected and the whole
  fix evaporates. The invariant `escrow_lamports - amount >= rent_exempt_minimum`
  must be asserted in `release`, not assumed from how `lock` funds it.
- **Does the upgrade authority reopen it?** The owner check pins a program
  *address*, not a code hash. Whoever holds `quasar-escrow`'s upgrade authority
  can reintroduce a closing instruction and restore the attack, silently, with
  every test green. This is a standing trust dependency, not specific to C-4.
- **Is "any status" really safe?** The uniform matrix is argued above from the
  denial-lever principle, but it is the choice most likely to be wrong. A
  reviewer should try to construct a case where allowing `commit` on a
  `Cancelled` escrow produces an unfair penalty.

## Verification plan

- Invert the settlement-race tripwire: the payee's `commit` after `release` must
  now succeed, and the previously-griefed `expire` must find a `BothCommitted`
  rating rather than a lockout.
- New regression: `release` leaves the escrow readable, with `status == Released`
  and a balance at or above rent-exemption.
- New regression: the same for `cancel`.
- New negative: assert no instruction in either escrow program closes an escrow
  — enforced by test, since the fix depends on it.
- Full loop via `bash scripts/run-quasar-program-tests.sh`.
- **Independent review before any closure claim.** Non-negotiable at this point:
  two self-reviewed closure claims for this finding have already failed.
