# V1 program (Pinocchio)

The Reddi Agent Protocol on-chain program: escrow, registry, and ratings and
judge attestations of jobs paid through escrow, built with
[Pinocchio](https://github.com/anza-xyz/pinocchio).

**Status.** This is the V1 program source (owner decision, 21 November 2026).
It replaces the Anchor program, which is archived in `archive/anchor-escrow/`
and kept as the behavioural reference its 13 escrow and registry instructions
are tested against. It has
not been deployed and has not had an independent security review. The program
on devnet today is still the Anchor build (`DEPLOY.md`). Nothing in this
directory deploys, creates keys or signs anything.

## What it is

One program, one mainnet build. The default build has 23 instructions:

| Area | Instructions |
|---|---|
| SOL escrow | `lock_escrow`, `lock_metered_escrow`, `release_escrow`, `settle_escrow`, `cancel_escrow` |
| Token escrow (USDC, AUDD, PYUSD, USDG) | `lock_token_escrow`, `lock_metered_token_escrow`, `release_token_escrow`, `settle_token_escrow`, `cancel_token_escrow` |
| Registry | `register_agent`, `update_agent`, `deregister_agent` |
| Ratings of jobs paid through escrow | `open_rating`, `accept_rating`, `commit_rating`, `reveal_rating`, `expire_rating`, `close_rating` |
| Judge attestations | `attest_quality`, `confirm_attestation`, `dispute_attestation`, `close_attestation` |

The first 13 are the Anchor program's, with the same interface. The other
ten are this program's own: see [Ratings and attestations](#ratings-and-attestations)
and [Interface of the rating and attestation instructions](#interface-of-the-rating-and-attestation-instructions).

Not part of V1: MagicBlock PER tracking (`delegate_escrow`,
`release_escrow_per`). It sits behind the `per` Cargo feature, which is off by
default and never used for a mainnet build; the default build answers neither
selector. It is unfinished work for after the launch (issue #839): the PER
release takes no protocol fee and emits no settlement event yet.

Who may end an escrow, for SOL and tokens alike:

| Call | Who | When | Pays |
|---|---|---|---|
| Release | Payer | Any time | The whole locked amount, less the fee |
| Release (claim) | Payee | After the escrow's claim window | The whole locked amount, less the fee |
| Settle | Payee only | Any time, metered escrows only | The amount the payee names, at most the maximum, less the fee; the rest returns to the payer |
| Cancel (decline) | Payee | Any time | Everything back to the payer, no fee |
| Cancel (refund) | Payer | After the escrow's cancel window | Everything back to the payer, no fee |

The payer never chooses a smaller payout: a payer who signs a settle is
refused. A lock is not a payment until one of these calls ends it.

### Windows

Each lock names its two windows, in slots from the lock (a nominal 400 ms
each), after the amount and the nonce: `claim_window_slots` and
`cancel_window_slots`. They are stored on the escrow and nothing else decides
the timing, so a job that takes seconds can use windows of seconds. A lock is
refused with `InvalidWindows` (6031) unless

- the claim window is at least one slot,
- the claim window is no later than the cancel window, so a payee who did the
  work can always claim before, or at the latest when, the payer can refund,
- the cancel window is at most `MAX_ESCROW_WINDOW_SLOTS` (6,480,000 slots,
  about 30 days), so a payer is never kept waiting without limit.

The program has no default. Clients that name none use
`DEFAULT_CLAIM_WINDOW_SLOTS` (1,500, about 10 minutes) and
`DEFAULT_CANCEL_WINDOW_SLOTS` (4,500, about 30 minutes).

Two things follow, and both sides should know them.

For buyers: the claim opens first. On a fixed-price escrow there is no refund
route before the payee can claim, so a payee can claim once the claim window
opens, delivered or not, and a payer who does nothing pays. The lock is the
payer's commitment up to the locked amount. A buyer who wants time to judge the
work before the payee can take the money names a claim window long enough for
that, and releases early when satisfied; a buyer paying per call uses a metered
lock, where the payee is paid for what it reports and the rest returns.

For sellers: once the cancel window has elapsed the payer can refund, so the
seller's settle or claim has to land before then. What counts is the time
left when the request arrives, not the window named at lock: a buyer can lock,
wait out most of the window, and only then make the call. Before doing the
work a seller reads the escrow and the current slot and checks that
`created_slot + cancel_window_slots - current_slot` is at least its own
minimum, and serves nothing when either cannot be read.
`SELLER_MIN_CANCEL_WINDOW_SLOTS` in `packages/x402-solana` (1,500 slots, about
10 minutes left) is the floor the in-repo sellers apply, which is why client
defaults name a longer refund window than that.

### Accounts a payout can reach

A lock is refused when the money could not be paid out of it again:

- **Token escrow.** The lock is refused (`InvalidTokenAccount`) when the
  payer's source account or the payee's recipient account is frozen.
- **SOL escrow.** The runtime refuses a payout that leaves the payee's account
  holding something but less than its rent-exempt minimum. A fixed-price lock
  is refused with `PayeeNotRentExempt` (6032) unless what the payee holds plus
  the amount less the fee reaches that minimum. A metered lock pays whatever
  the payee later reports, so its payee must already hold the minimum. The
  check is made at lock; a payee that empties its wallet afterwards can still
  block its own payout until it is funded again.

Who chooses where a token payout lands:

- The payer's release pays only the recipient token account recorded at lock.
- The payee's own claim or settle may name any token account of the escrow mint
  that the payee owns, so a recorded recipient that was closed or frozen after
  the lock does not keep the payee from its money. Nobody else can redirect a
  payout, and the fee and the refund go where they always do.

Token-2022 only: tokens sent to a vault while the issuer charges a transfer fee
leave withheld fees on the vault, and a vault holding withheld fees cannot be
closed. Every exit takes the mint as a read-only account, and then such a vault
is left open, empty, with its rent. When the caller passes the mint writable,
the program first moves the withheld fees to the mint
(`HarvestWithheldTokensToMint`, which anyone may do), closes the vault and
returns its rent to the payer. Clients pass the mint writable only when a vault
has withheld fees, because a writable mint makes every such transaction contend
for one account (`harvestWithheldFees` in `packages/x402-solana`).

Not changed: a transfer hook the issuer activates after a lock still stops
every exit in that mint until it is removed or the program is upgraded. A lock
while a hook is active already fails, because no hook accounts are passed. The
daily mint watch (`scripts/check-token2022-mint-posture.mjs`) is the control.

### Layouts

The windows changed two account layouts. A SOL escrow is 165 bytes, with the
two windows after `created_slot`; a token escrow is 219 bytes, with them at the
end. An escrow written by an earlier build is shorter (149 and 203 bytes) and
both builds refuse it by its size, before reading a field, with
`AccountDidNotDeserialize` (3003), so open escrows on a program that is upgraded in place should be ended
(the payee can decline at any time) before the upgrade. The decoders in
`lib/sandbox/escrow.ts` and `packages/x402-solana` read both sizes.

Each escrow has one flag byte, the byte that has always held `metered`: at
offset 132 of a SOL escrow (164 when a PER session key is stored, `per` builds
only) and at offset 202 of a token escrow. Bit `0x01` is metered, bit `0x02`
is rated. An escrow that is not rated stores 0 or 1 there, as before, so
nothing changes for it. A client that reads the byte must test the bits: a
rated metered escrow stores 3, and a decoder that compares the byte with 1, or
reads it as a Borsh `bool`, gets it wrong or fails.

It is not a line-by-line port. The goal is the same outcome for every
transaction, built the way a Pinocchio program is built:

- **No framework, no heap.** `no_std`, `no_allocator!`, a single `match` on the
  instruction selector. Nothing allocates, including error reporting and
  events (events are assembled in a stack buffer).
- **Zero-copy account records.** Each record is a `repr(C)`, alignment-1
  struct read and written in place (`program/src/state.rs`), instead of being
  deserialised into an owned value and serialised back.
- **Explicit checks, one place each.** Signer, writable, owner, derived-address
  and token-account checks are small shared functions
  (`program/src/checks.rs`, `program/src/token.rs`). A rating or attestation
  account is only ever read through one loader that checks its owner, its
  discriminator, its size and that it sits at the address derived from the
  escrow it names (`program/src/state.rs`). The settlement
  instructions of the token escrow share one validated `Open` value and one
  `drain` routine, so release, claim, settle, refund and decline differ only
  in who may call them and how the vault is split.
- **One token path for both token programs.** Classic SPL Token and Token-2022
  accounts are parsed by the same reader; transfers go through
  `TransferChecked` to whichever program the escrow's mint belongs to.
- **Overflow checks on, panics impossible by construction** in the instruction
  paths: arithmetic is checked or bounded by an earlier `require`.

## The contract it keeps

For the 13 escrow and registry instructions, on an escrow that is not opted
into rating, the program is a drop-in for the Anchor one at the wire level, so
the existing clients, IDL, tests and scripts work against it unchanged:

- the same 8-byte instruction selectors and argument encoding;
- the same accounts in the same order (accounts after them are ignored);
- the same derived addresses (`escrow`, `token-escrow`, `token-vault`, `agent`);
- the same account layouts, including the 8-byte account discriminators, so
  `program.account.*.fetch` and `lib/program.ts` read them;
- the same events, byte for byte, on the `Program data:` log channel;
- the same error numbers: 6000+ for program errors and Anchor's framework
  numbers (2000s, 3000s) for account failures, each with a log line in the
  shape Anchor clients parse;
- the same program id declaration and fee rules (2.5% of the amount paid,
  rounded down, from the payee's share, capped at 0.1 SOL for SOL only, paid to
  the Squads vault).

The rating and attestation instructions, and the exits of a rated escrow, are
not in the Anchor IDL. The Anchor program has instructions with some of the
same names (`commit_rating`, `attest_quality` and so on) behind its `extended`
feature, with a different interface; a client built for those does not work
here. This README and `interface/vectors.json` are the interface.

## Ratings and attestations

A rating counts only for a job that was paid through escrow between the two
parties, that the buyer opted in, and that the seller agreed to have rated.
Nothing a payer does alone, with any help from third parties, changes the
reputation, job counts or accuracy of an agent that signed nothing.

1. **Opt in.** In the slot an escrow is locked (normally in the same
   transaction), its payer calls `open_rating`. That creates the rating
   account at `["rating", escrow address]`, which is the job's record: it
   names the escrow, the payer (consumer), the payee (specialist) and an
   optional judge. The escrow's rated bit is set. Opting in later is refused,
   so a seller that reads the escrow before it serves knows whether the job is
   rated, and can decline it. A seller should read the escrow at `confirmed`
   commitment or better, so that it sees the whole slot of the lock.
2. **Agree.** The seller agrees to the rating in one of two ways: it is the
   authority of the paid exit (it settles, or claims after the claim window),
   or it calls `accept_rating` while the escrow is still locked, which lets
   the payer's release open the rating later. Only the specialist named on
   the rating account can accept, once. On a release the payer authorises,
   nothing but `accept_rating` counts: the seller's signature elsewhere in
   that transaction, as fee payer or for another instruction, is not
   agreement. The rule is the same for SOL and token escrows.
3. **Exit.** Every exit of a rated escrow takes the rating account, writable,
   as the account right after the instruction's usual accounts. Without it
   the exit is refused (`RatingAccountRequired`, 6033), so a seller that
   settles a rated escrow must pass it.

   | Exit | Rating account |
   |---|---|
   | Settle or claim, with the payee as authority | Records the amount paid, the mint and the slot; the rating opens |
   | Release by the payer, after `accept_rating` | The same |
   | Release by the payer, seller never agreed | The money moves exactly as usual; the rating account is closed, its rent returns to the payer, and the job is never rated or attested |
   | Any paid exit that pays nothing (a Token-2022 vault the issuer emptied) | Closed, rent returns to the payer: there is no paid job to rate |
   | Refund or decline | Closed, rent returns to the payer: a job that was not paid is not rated |
4. **Commit.** Each party commits to
   `sha256(rating address ‖ signer address ‖ score byte ‖ 32-byte salt)`
   within `RATING_COMMIT_SLOTS` (1,512,000 slots, about 7 days) of the paid
   settlement. The rating address and the signer are part of the hash, so a
   commitment copied from the other party or from another job cannot be opened
   by replaying that reveal.
5. **Reveal.** Once both have committed, each reveals its score (1 to 10) and
   salt within `RATING_REVEAL_SLOTS` (1,512,000 slots) of the second
   commitment. On the second reveal each score is folded into the other
   party's agent record (nine parts the old reputation, one part the score
   scaled to 0..10000) and both job counts rise by one.
6. **Expire.** After the deadline of the phase a rating stopped in, anyone may
   call `expire_rating`, which gives it its final result:

   | Stopped | Result |
   |---|---|
   | Before both committed, nobody committed | Final, no reputation change |
   | Before both committed, one side committed | The silent side loses 5.00 points and gains a failed job |
   | Both committed, one side revealed | The revealed score is folded into the other party, then that party (which withheld) loses 5.00 points; its own score is never counted; both job counts rise by one |
   | Both committed, nobody revealed | Final, no reputation change |

   A deadline includes its last slot: a commit or reveal in slot
   `start + 1,512,000` is accepted, and `expire_rating` is accepted from the
   slot after.
7. **Close.** Once the rating is final (revealed or expired) the consumer
   calls `close_rating` and gets the rent back.

A party that is not a registered agent can rate and be rated: the instruction
takes the agent address derived from each party, and updates only records that
exist at the time. What counts is the registry as it stands when the rating is
finalised.

**Attestations.** The consumer may name one judge in `open_rating`. Once the
job is paid, that judge, and nobody else, records five scores with
`attest_quality`; it must be registered as an attestation agent (type 1 or 2)
and its agent record must be active.
The attestation lives at `["attestation", escrow address]` and takes the job
and the consumer from the rating account, so it must be made before the rating
account is closed. Only that consumer confirms it (the judge's accuracy rises
by 10.00 and a top score is folded into its reputation) or disputes it (the
judge loses 5.00 points), once. If the judge has deregistered by then, the
resolution is still recorded and no record is updated. The judge gets the
attestation's rent back with `close_attestation`, once it is resolved, or,
if the consumer never resolves it, after 1,512,000 slots from the slot it was
made in. A job is attested at most once: the rating account remembers it, so
closing an attestation does not make room for another of the same job. A job
the seller never agreed to have rated has no rating account after its
release, so it cannot be attested either.

Things to know:

- A rating account costs 2,770,080 lamports of rent (270 bytes, at 6,960
  lamports per byte with the 128-byte account overhead), paid by the buyer and
  returned at `close_rating`, on a refund, or on a release the seller never
  agreed to have rated. An attestation costs the judge 1,719,120 lamports
  (119 bytes), returned at `close_attestation`.
- The addresses are derived from the escrow address, which is derived from the
  payer and the nonce. A payer that reuses a nonce gets the same addresses:
  the new job cannot be opted in until the earlier rating is closed
  (`close_rating`), and cannot be attested until the earlier job's
  attestation is closed (`close_attestation`, which only that judge can
  call). Clients use a fresh nonce per job.
- Reputation and judge accuracy are not Sybil-proof. Wallets of one owner can
  pay, rate and attest each other for the cost of transaction fees, and a job
  of under 40 lamports pays no protocol fee at all (2.5% rounds down to 0).
  The paid amount and the mint are on the rating account so that rankers can
  weight by them, but only until `close_rating`: the agent record keeps no
  sum, so a ranker has to read ratings before they are closed. An attestation
  carries no amount.
- A party can deregister and register again to shed a pending score or
  penalty. Records are updated only if they exist when the rating is
  finalised or the attestation resolved, so a party that sees a bad score or
  a penalty coming can deregister first and register again afterwards.
  Registering costs 0.01 SOL and starts a new record at zero, which was
  already true of the registry, so this does not help an agent with a good
  record, but it does keep failed jobs off a record. Rankers should treat a
  recently created record as having no history.
- On a fixed-price job the seller can call `accept_rating` at any time while
  the escrow is locked, so it can wait to see how the job went. A buyer who
  wants a rating should release only after the seller accepted (`accepted` is
  1 on the rating account), or not release and leave the seller to claim,
  which opens the rating. Metered jobs are not affected: only the seller
  settles them.
- The payer can release an escrow at any time, so a job can be paid without
  the payee ever acting. That is why a release by the payer opens the rating
  only when the seller agreed: a lock, opt-in and release to an agent that
  signed nothing pays that agent and leaves no rating behind. A seller that
  accepts, or itself settles or claims, a rated job has taken on the rating: it then
  has to commit and reveal within the windows or lose 5.00 points. The program
  does not weight reputation by the amount paid.
- An escrow delegated to a PER session (`per` builds only) cannot be opted in,
  and a rated escrow cannot be delegated (`RatedEscrowNotDelegable`, 6045).

## Interface of the rating and attestation instructions

Selectors are the first eight bytes of `sha256("global:<name>")`. Data follows
the selector; integers are little-endian; trailing data bytes and accounts
after the ones listed are ignored. `w` writable, `s` signer. Examples of every
instruction and account below, as bytes, are in `interface/vectors.json`;
`equivalence/tests/interface_vectors.rs` fails when that file and the program
disagree.

Framework errors any of them can return: `InstructionDidNotDeserialize` (102,
data too short), `ConstraintMut` (2000, an account that must be writable is
not), `ConstraintSeeds` (2006, an account is not at its derived address),
`AccountDiscriminatorMismatch` (3002) and `AccountDidNotDeserialize` (3003,
an account of this program that is not the expected record),
`AccountNotEnoughKeys` (3005), `AccountOwnedByWrongProgram` (3007),
`InvalidProgramId` (3008, not the System program), `AccountNotSigner` (3010),
`AccountNotInitialized` (3012, nothing at the address: for a rating, the job
was never opted in, was refunded, or the rating was closed).

### `open_rating`

Data: `judge: [u8; 32]` (all zero for no judge).

| # | Account | | |
|---|---|---|---|
| 0 | `rating` | w | `["rating", escrow]`, created here |
| 1 | `escrow` | w | A SOL or token escrow of this program |
| 2 | `payer` | w, s | The escrow's payer; pays the rating's rent |
| 3 | `system_program` | | |

Refused with: `UnauthorisedSigner` (6000) when the signer is not the escrow's
payer; `NotLocked` (6002); `RatingOptInClosed` (6036) in any slot but the one
the escrow was locked in; `AlreadyRated` (6037); `RatedEscrowNotDelegable`
(6045) for an escrow delegated to PER; `InvalidPayee` (6007) when the payee is
the payer or the rating address; `InvalidJudge` (6038) when the judge is the
payer or the payee; a System program error when an account already exists at
the rating address.

### `accept_rating`

No data.

| # | Account | | |
|---|---|---|---|
| 0 | `rating` | w | In state 0 |
| 1 | `specialist` | s | The rating's specialist (the escrow's payee) |

Sets `accepted` to 1. Refused with `UnauthorisedSigner` (6000) for anyone
else, `RatingNotAwaitingSettlement` (6035) once the escrow has been paid, and
`RatingAlreadyAccepted` (6046) the second time. After a refund, a decline or
an unaccepted release there is no rating account (`AccountNotInitialized`,
3012).

### Exits of a rated escrow

`release_escrow`, `settle_escrow`, `cancel_escrow`, `release_token_escrow`,
`settle_token_escrow` and `cancel_token_escrow` keep their selectors, data and
accounts. When the escrow's rated bit is set, one more account is required
right after them:

| Instruction | Usual accounts | Rating account at index |
|---|---|---|
| `release_escrow`, `settle_escrow` | `escrow` w, `payer` w, `payee` w, `treasury` w, `system_program` | 5 |
| `cancel_escrow` | `escrow` w, `authority` s, `payer` w, `system_program` | 4 |
| `release_token_escrow`, `settle_token_escrow` | `escrow` w, `vault` w, `authority` s, `payer` w, `mint`, `destination` w, `treasury_token` w, `refund` w, `token_program` | 9 |
| `cancel_token_escrow` | `escrow` w, `vault` w, `authority` s, `payer` w, `mint`, `destination` w, `token_program` | 7 |

The rating account must be writable, be the rating of this escrow, and be in
state 0. Refused with `RatingAccountRequired` (6033) when it is missing,
`InvalidRatingAccount` (6034) when it is the rating of another escrow,
`RatingNotAwaitingSettlement` (6035) in any other state, and the framework
errors above when it is not a rating account at all. Everything else about the
exit, including who may call it, the money and the `EscrowSettled` event, is
as for an escrow that is not rated.

A paid exit opens the rating when the payee is its authority or `accepted`
is 1, and something is paid. The payee is the authority of every settle, and
of a release that the payer did not authorise: in `release_escrow`, the
`payee` account is a signer and the `payer` account is not; in
`release_token_escrow`, the `authority` is the payee. When the payer is the
authority, a payee signature on the same transaction does not count. It then sets
on the rating account: `paid` (the amount paid out of the
escrow before the protocol fee; for a token escrow, what left the vault for
the payee and the treasury, which under Token-2022 can be less than the amount
named when the issuer has shrunk the vault), `mint` (the escrow mint; zero for
SOL), `settled_slot`, and state 1. Otherwise (a release the payer authorises
that the payee did not accept beforehand, or an exit that pays nothing) the
exit moves the same amounts and emits the same event, and closes the rating
account. A refund or decline
closes it too. A closed rating account's lamports go to the escrow's payer.

### `commit_rating`

Data: `commitment: [u8; 32]`.

| # | Account | | |
|---|---|---|---|
| 0 | `rating` | w | |
| 1 | `signer` | s | The rating's consumer or specialist |

Refused with: `UnauthorisedSigner` (6000) for anyone else; `JobNotPaid` (6039)
in state 0; `AlreadyFinalised` (6015) in state 3 or 4; `AlreadyCommitted`
(6010) when this party has committed; `CommitDeadlinePassed` (6040) after slot
`settled_slot + 1,512,000`; `EmptyCommitment` (6043) for 32 zero bytes. The
second commitment sets state 2 and `committed_slot`.

### `reveal_rating`

Data: `score: u8` (1 to 10), `salt: [u8; 32]`.

| # | Account | | |
|---|---|---|---|
| 0 | `rating` | w | |
| 1 | `signer` | s | The rating's consumer or specialist |
| 2 | `specialist_agent` | w | `["agent", rating.specialist]`, registered or not |
| 3 | `consumer_agent` | w | `["agent", rating.consumer]`, registered or not |

Refused with: `ConstraintDuplicateMutableAccount` (2040) when accounts 2 and 3
are the same; `ConstraintSeeds` (2006) when either is not the agent address of
its party (swapped accounts included); `UnauthorisedSigner` (6000);
`JobNotPaid` (6039) in state 0; `BothMustCommitFirst` (6011) in state 1;
`AlreadyFinalised` (6015) in state 3 or 4; `RevealDeadlinePassed` (6041) after
slot `committed_slot + 1,512,000`; `InvalidScore` (6013); `AlreadyRevealed`
(6042); `CommitmentMismatch` (6012). The second reveal sets state 3 and
updates the agent records that exist.

### `expire_rating`

No data.

| # | Account | | |
|---|---|---|---|
| 0 | `rating` | w | |
| 1 | `caller` | s | Anyone |
| 2 | `specialist_agent` | w | As for `reveal_rating` |
| 3 | `consumer_agent` | w | As for `reveal_rating` |

Refused with the account errors of `reveal_rating`; `JobNotPaid` (6039) in
state 0; `AlreadyFinalised` (6015) in state 3 or 4; `NotExpired` (6014) up to
and including slot `settled_slot + 1,512,000` in state 1, or
`committed_slot + 1,512,000` in state 2. Sets state 4, with the results in the
table above.

### `close_rating`

No data.

| # | Account | | |
|---|---|---|---|
| 0 | `rating` | w | Closed; its lamports go to the consumer |
| 1 | `consumer` | w, s | The rating's consumer |

Refused with `UnauthorisedSigner` (6000) for anyone else and `RatingNotFinal`
(6044) in states 0 to 2.

### `attest_quality`

Data: `scores: [u8; 5]` (accuracy, completeness, relevance, format, latency;
1 to 10 each).

| # | Account | | |
|---|---|---|---|
| 0 | `attestation` | w | `["attestation", rating.escrow]`, created here |
| 1 | `rating` | w | The job's rating account; `attested` is set to 1 |
| 2 | `judge_agent` | | `["agent", judge]`, a registered, active agent of type 1 or 2 |
| 3 | `judge` | w, s | The judge the rating names; pays the attestation's rent |
| 4 | `system_program` | | |

Refused with: `UnauthorisedSigner` (6000) when the signer is not the judge the
rating names, or it names none; `JobNotPaid` (6039) in rating state 0;
`AlreadyAttested` (6048) when this job has been attested before, whether or
not that attestation was closed since; `NotAttestationAgent` (6016) when the
judge's record is of type 0; `JudgeNotActive` (6049) when that record has been
switched off with `update_agent`; `AttestationScoreOutOfRange` (6019); a
System program error when an account already exists at the attestation
address (an earlier job under the same escrow address whose attestation was
not closed). Rating states 1 to 4 are all accepted.

### `confirm_attestation`, `dispute_attestation`

No data.

| # | Account | | |
|---|---|---|---|
| 0 | `attestation` | w | |
| 1 | `judge_agent` | w | `["agent", attestation.judge]`, registered or not |
| 2 | `consumer` | s | The consumer the attestation names |

Refused with `UnauthorisedSigner` (6000) for anyone else,
`AttestationAlreadyResolved` (6018) the second time and `ConstraintSeeds`
(2006) when account 1 is not the judge's agent address. When no agent is
registered at that address any more, the resolution is recorded and no record
is updated.

### `close_attestation`

No data.

| # | Account | | |
|---|---|---|---|
| 0 | `attestation` | w | Closed; its lamports go to the judge |
| 1 | `judge` | w, s | The judge the attestation names |

Refused with `UnauthorisedSigner` (6000) for anyone else and
`AttestationNotClosable` (6047) while the attestation is unresolved, up to and
including slot `created_slot + 1,512,000`.

### Account layouts

Both are fixed layouts with no padding. Discriminators are the first eight
bytes of `sha256("account:<name>")`.

Rating account, `account:RatingAccount`, 270 bytes, seeds `["rating", escrow]`:

| Offset | Size | Field | |
|---|---|---|---|
| 0 | 8 | discriminator | |
| 8 | 32 | `escrow` | The escrow the rating was opened for |
| 40 | 32 | `consumer` | The escrow's payer |
| 72 | 32 | `specialist` | The escrow's payee |
| 104 | 32 | `judge` | All zero for none |
| 136 | 32 | `mint` | All zero for SOL and until the job is paid |
| 168 | 32 | `consumer_commitment` | All zero until committed |
| 200 | 32 | `specialist_commitment` | All zero until committed |
| 232 | 8 | `paid` | u64 |
| 240 | 8 | `opened_slot` | u64 |
| 248 | 8 | `settled_slot` | u64, slot of the paid exit |
| 256 | 8 | `committed_slot` | u64, slot of the second commitment |
| 264 | 1 | `state` | 0 awaiting settlement, 1 open, 2 both committed, 3 revealed, 4 expired |
| 265 | 1 | `consumer_score` | The consumer's score of the specialist; 0 until revealed |
| 266 | 1 | `specialist_score` | The specialist's score of the consumer; 0 until revealed |
| 267 | 1 | `accepted` | 1 once the specialist called `accept_rating`; 0 otherwise, also when it agreed by signing the paid exit |
| 268 | 1 | `attested` | 1 once the judge has attested the job |
| 269 | 1 | `bump` | |

Attestation account, `account:AttestationAccount`, 119 bytes, seeds
`["attestation", escrow]`:

| Offset | Size | Field | |
|---|---|---|---|
| 0 | 8 | discriminator | |
| 8 | 32 | `escrow` | |
| 40 | 32 | `judge` | |
| 72 | 32 | `consumer` | |
| 104 | 5 | `scores` | |
| 109 | 1 | `resolution` | 0 pending, 1 confirmed, 2 disputed |
| 110 | 8 | `created_slot` | u64 |
| 118 | 1 | `bump` | |

The Anchor program's `extended` build uses the same two discriminators for
records with other, shorter layouts (175 and 105 bytes). This program refuses
them: an account must be at least the size above.

New error numbers, all after 6032:

| Number | Name |
|---|---|
| 6033 | `RatingAccountRequired` |
| 6034 | `InvalidRatingAccount` |
| 6035 | `RatingNotAwaitingSettlement` |
| 6036 | `RatingOptInClosed` |
| 6037 | `AlreadyRated` |
| 6038 | `InvalidJudge` |
| 6039 | `JobNotPaid` |
| 6040 | `CommitDeadlinePassed` |
| 6041 | `RevealDeadlinePassed` |
| 6042 | `AlreadyRevealed` |
| 6043 | `EmptyCommitment` |
| 6044 | `RatingNotFinal` |
| 6045 | `RatedEscrowNotDelegable` |
| 6046 | `RatingAlreadyAccepted` |
| 6047 | `AttestationNotClosable` |
| 6048 | `AlreadyAttested` |
| 6049 | `JudgeNotActive` |

6010 to 6016, 6018 and 6019 keep the numbers and names the Anchor program
declares for its rating and attestation errors.

## Evidence

Three layers, all in `equivalence/` (its own workspace, so the test harness's
dependencies stay out of the program's lockfile):

1. **The Anchor program's own tests of the 13 escrow and registry
   instructions, unchanged.** `scripts/sync-equivalence-tests.sh` copies them
   from `archive/anchor-escrow/tests/`, changing only the path of the binary
   they load. `--check` fails if a copy is stale. All 79 pass against the
   Pinocchio binary.
2. **A side-by-side suite** (`equivalence/tests/differential.rs`). It runs the
   same transaction against the Anchor binary and the Pinocchio binary in two
   simulators with identical state, and requires the same result, the same
   error, the same error log line, the same events, the same inner instructions
   and the same bytes and lamports in every account either transaction touched.
   459 transactions across SOL, classic SPL Token (USDC, AUDD) and Token-2022
   (PYUSD, USDG) escrows, the registry, malformed input, earlier-format escrow
   records, wrong and duplicated
   accounts, uninitialised token accounts, mints off the allowlist, transfer
   fees, and issuer actions on Token-2022 vaults. This is what holds an escrow
   that is not rated to the behaviour it had before ratings were added: the
   suite is unchanged.
3. **This program's own tests** of what the Anchor program does not have, 65
   tests against the Pinocchio binary: `rated_escrow.rs` (opt-in and every
   exit of a rated SOL, USDC and PYUSD escrow), `rating_consent.rs` (a payer
   acting alone cannot move the record of an agent that signed nothing;
   `accept_rating`; which releases open a rating), `rating.rs` (commit,
   reveal, expire, close, the deadlines at their boundary slots, unregistered
   parties), `judge_attestation.rs`, `instruction_surface.rs` (the default
   build answers the 23 instructions and not the two PER selectors) and
   `interface_vectors.rs` (the fixture in `interface/`). They cover every
   refusal of each instruction: wrong owner, wrong address, wrong signer,
   read-only, swapped and duplicated accounts, a rating of another escrow or
   in the wrong state. Every transaction they send is also checked for lamport
   conservation: the lamports of all accounts involved add up to the same
   total before and after, less the transaction fee.

The suites were checked against deliberate faults. Earlier: the fee set to 251
bps. For the rating work: the judge check skipped in `attest_quality`, the
same-slot check skipped in `open_rating`, a rating of another escrow accepted
at an exit, the signer left out of the commitment hash, and the penalty for a
withheld reveal left out; a release by the payer treated as the seller's
agreement, `accept_rating` open to any signer, the attested mark not checked,
and an unresolved attestation closable at once; the seller's signature
anywhere in a payer's SOL release treated as agreement, a rating opened with
nothing paid, and the judge's active flag not checked. Each made tests fail, and they passed again when the
fault was removed.

The `per` build (not V1) is tested as a separate last step, as the `extended`
build was: the Anchor program's `per.rs` unchanged (5 tests), 37 more
side-by-side transactions against the Anchor `extended` build, and
`per_rated.rs` (a rated escrow cannot be delegated, a delegated one cannot be
rated).

Not run: `scripts/devnet-escrow-e2e.cjs`. It needs a deployed program, and
nothing was deployed. It would need only its `PROGRAM`, `PROGRAM_DATA`,
`PROGRAM_LEN` and `PROGRAM_SHA256` constants pointed at a deployment of this
build; the account offsets and error names it checks are the same.

## Size, rent and compute

Local builds, Agave 4.2.2 toolchain, mainnet variant (no features). Build paths
are embedded in the Anchor binary, so its size moves by a few dozen bytes with
the checkout path. The Anchor figure is its default build, which has the 13
escrow and registry instructions only:

| | Anchor (13 instructions) | Pinocchio (23 instructions) | Change |
|---|---|---|---|
| Program size | 345,152 bytes | 94,112 bytes | 73% smaller |
| Rent at 6,960 lamports per byte | 2.4046 SOL | 0.6574 SOL | 1.7472 SOL less |
| Rent at 5,080 lamports per byte | 1.7551 SOL | 0.4798 SOL | 1.2753 SOL less |
| `per` build size (not for mainnet) | 495,744 bytes (`extended`) | 101,440 bytes | 80% smaller |

Before ratings and attestations were added the Pinocchio build was 62,248
bytes (0.4356 SOL at 6,960); they cost 31,864 bytes and 0.2218 SOL of rent.

Rent is for the program account (36 bytes) plus the program data account (45
bytes of header plus the binary), each with the 128-byte account overhead:
`(size + 337) × rate`. 6,960 lamports per byte is the long-standing rate.
Devnet's RPC reported 5,080 when this was measured; mainnet's RPC could not be
reached from the build environment, so check the current mainnet rate
(`solana rent <bytes>`) before relying on a figure. Rent is a deposit that
comes back if the program is closed. A deploy also needs the same amount
again, briefly, for the upload buffer. A program data account can be given
room to grow, which costs rent for the extra room.

Compute units for successful calls of the 13 shared instructions on an escrow
that is not rated, from the side-by-side suite:

| Call | Anchor | Pinocchio |
|---|---|---|
| SOL lock | 10,459 | 5,286 |
| SOL release | 5,942 | 1,355 |
| USDC or AUDD lock | 25,503 | 15,038 |
| USDC or AUDD release | 25,803 | 13,911 |
| USDC or AUDD settle at actual cost | 27,666 | 15,096 |
| PYUSD lock | 32,682 | 22,279 |
| PYUSD settle at actual cost | 36,973 | 24,484 |
| Register agent | 15,527 | 10,781 |
| Update agent | 4,368 | 407 |
| Deregister agent | 3,864 | 297 |

Most of what remains in the token rows is the token program's own work.

Compute units for the rating and attestation instructions and the exits of a
rated escrow, from this program's own tests (`cargo test -- --nocapture`).
Creating an account and deriving an address cost more for some addresses than
others (each attempt at a bump is 1,500 units), so the figures with a range
move with the keys:

| Call | Pinocchio |
|---|---|
| `open_rating` | 3,833 to 6,833 |
| `accept_rating` | 1,993 |
| `release_escrow` of a rated escrow (payer, accepted; not accepted 3,441; payee claim 3,486) | 3,462 |
| `settle_escrow` of a rated escrow | 3,421 |
| `cancel_escrow` of a rated escrow (decline; refund 3,246) | 3,228 |
| `release_token_escrow` of a rated escrow (payer, accepted), USDC / PYUSD | 16,039 / 21,921 |
| `settle_token_escrow` of a rated escrow, USDC / PYUSD | 17,233 / 26,621 |
| `cancel_token_escrow` of a rated escrow (decline), USDC / PYUSD | 10,272 / 15,552 |
| `commit_rating` (first / second) | 2,207 / 2,217 |
| `reveal_rating` (first / second, both parties registered) | 6,660 / 6,686 |
| `reveal_rating` (one party not registered) | 12,300 to 12,334 |
| `expire_rating` | 6,349 to 6,376 |
| `close_rating` | 1,981 |
| `attest_quality` | 10,139 |
| `confirm_attestation` / `dispute_attestation` | 4,023 / 4,026 |
| `close_attestation` | 1,959 |

A rated exit costs about 2,000 units more than the same exit of an escrow that
is not rated: almost all of it is checking that the rating account is at its
derived address. A party that is not registered costs more because its agent
address has to be derived from scratch; there is no stored bump to check
against.

## Known differences

- No `Program log: Instruction: <Name>` line. Explorers that label
  instructions from that line show the selector instead.
- Error log lines say `AnchorError occurred.` and never
  `AnchorError thrown in <file>` or `caused by account: <name>`. The error
  name, number and message are the same.
- When one transaction breaks several rules at once, the first rule reported
  follows Anchor's order for every combination the tests cover. It is not
  guaranteed for every possible combination. The transaction is refused either
  way.
- Anchor's check that the program runs at its declared id
  (`DeclaredProgramIdMismatch`) has no counterpart. Derived addresses use the
  id the runtime passes in.
- The Anchor token types also reject malformed optional fields inside a token
  account. The token programs never write such an account, so this is not
  reproduced.
- Compute use is lower, so a transaction sized to fail on Anchor's compute use
  would behave differently.

Decisions worth knowing before this is deployed:

- `expire_rating` can be called by anyone, not only the two parties.
- A consumer can dispute any attestation of its own job; the judge has no
  appeal.
- A judge that deregisters can still be confirmed or disputed; the resolution
  is recorded and there is no record left to change. One that registers again
  starts from a new record.
- A seller agrees to a rating per job. There is no standing setting on the
  agent record that accepts or refuses all ratings.

## Build and test

Needs Rust 1.98.0 and the Agave 4.2.2 tools (`docs/SOLANA-TOOLCHAIN-BASELINE.md`).
From the repository root:

```bash
# Anchor reference binary, used by the side-by-side suite
cargo build-sbf --manifest-path archive/anchor-escrow/Cargo.toml --sbf-out-dir target/deploy

cd programs/pinocchio-escrow
cargo build-sbf --manifest-path program/Cargo.toml --sbf-out-dir target/deploy
cargo test -p pinocchio-escrow                 # unit tests
scripts/sync-equivalence-tests.sh --check      # copied tests are current
(cd equivalence && cargo test -- --nocapture)  # all three test layers, prints compute
```

The `per` build (not part of V1) is tested the same way with `--features per`
on the Pinocchio build and on `cargo test`, against an Anchor reference built
with `--features extended`. Each build overwrites the binary of the other
variant, so rebuild both programs when switching back.

`cargo build-sbf` writes a throwaway keypair file next to each binary. It is
not used; delete it and never commit it (`target/` is ignored).

`--features devnet` also accepts devnet USDC, as the Anchor `devnet` feature
does. Never use it for a mainnet build.

CI runs all of the above (`.github/workflows/pinocchio-escrow-tests.yml`) on
changes to this directory or to the Anchor reference, then the `per` build as
a separate last step. The container
(verifiable) build is `.github/workflows/escrow-verifiable-build.yml`: it
builds this program with `solana-verify` and records the size and hash of the
mainnet and devnet variants. When an Anchor test changes, run
`scripts/sync-equivalence-tests.sh` to bring the copies up to date.

## Changing behaviour

For the 13 escrow and registry instructions the Anchor tests are the
specification. To change what one of them does for an escrow that is not
rated, change the Anchor test (and the Anchor reference, so the side-by-side
suite still has something to compare with), regenerate the copies, then change
this program until both layers pass. The IDL built from the Anchor crate stays
the client interface for them while the wire contract is the same.

The rating and attestation instructions, and the exits of a rated escrow, are
specified by this README and tested by this program's own tests. To change
one, change the test and the interface section together, then regenerate
`interface/vectors.json` (`UPDATE_VECTORS=1 cargo test --test
interface_vectors` in `equivalence/`) and review its diff.

## Before it is deployed

These are owner decisions and release steps, not something this directory does:

1. An independent security review of this program. The Anchor program's
   reviews do not carry over; the checks Anchor generates are written by hand
   here.
2. A devnet deploy, approved by the owner, and a run of
   `scripts/devnet-escrow-e2e.cjs` against it: the existing lane, and the
   rated lane (`run-rated`, then `finish-rated` about 7 days later; see
   `docs/DEVNET-ESCROW-E2E.md`). The rated lane has not been run against any
   deployment.
3. A container (verifiable) build for mainnet, as for the Anchor program.
4. On mainnet, a first deploy under a program id that has never been deployed
   there. The rent saving exists only if this build is what gets deployed
   first. Upgrading an
   already deployed Anchor program in place keeps its larger program data
   account and its rent, and a closed program's id cannot be deployed to
   again, so switching after an Anchor mainnet deploy means a new program id
   and moving clients to it.

The program id is the same on devnet and mainnet by design:
`DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu`. It is deployed on devnet and
has never been deployed on mainnet, so `declare_id!` needs no change for the
mainnet build and the mainnet deploy under it is still a first deploy.
