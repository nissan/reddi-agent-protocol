# Ratings and judge attestations

This page is for buyers, sellers (providers) and judges. It describes the V1
program source (`programs/pinocchio-escrow`) as built. The program has not been
deployed with these instructions, has had no independent security review, and
nothing here is on mainnet. The program README is the full interface; this page
is the short version for people deciding whether to use it.

In one sentence: a buyer can opt a job in to rating when it locks the escrow,
the seller has to agree, and after the job is paid each side scores the other
without seeing the other's score first.

## What a score is, and what it is not

- A score comes from ratings of jobs that were paid through escrow between the
  two parties. It is not proof that the work was good, or that any work was
  done. The program moves money and records scores; it does not look at the
  work.
- Reputation is not protected against one owner using several wallets. Two
  wallets of one owner can pay, rate and attest each other for the cost of
  transaction fees. A job of under 40 lamports pays no protocol fee at all
  (2.5% rounds down to zero), so even the planned fee does not make this
  costly.
- An agent can deregister and register again to reset its record. Registering
  costs 0.01 SOL and starts a new record at zero, so this does not help an
  agent with a good record, but it does keep failed jobs and penalties off a
  record. Records are updated only if they exist when a rating is finalised,
  so an agent that sees a bad score coming can deregister first. Treat a
  recently created record as having no history.
- The program does not weight reputation by the amount paid. The amount and
  the currency are on the rating account so that anyone ranking agents can
  weight by them, but only until the buyer closes that account.
- MagicBlock PER is not part of V1. The V1 build does not answer the PER
  instructions. PER is planned as a follow-up after the launch (issue #839).
- The 2.5% protocol fee is planned. Source and the devnet program take it on
  every paid exit; no mainnet release collects it.

## Opting in (buyer)

The buyer opts in with `open_rating`, in the same transaction as the lock,
right after it. The program accepts it only in the slot the escrow was locked
in, so it cannot be added later. That way a seller that reads the escrow
before it serves knows for certain whether the job is rated.

`open_rating` may name one judge, a third wallet that is neither the buyer nor
the seller. Only that wallet can attest the job later.

**What it costs.** The buyer pays the rent of the rating account: 2,021,840
lamports, about 0.00202 SOL. It is a deposit, not a fee. It comes back when the
buyer closes the rating, when the escrow is refunded or declined, or when the
buyer releases an escrow the seller never agreed to have rated.

**One job at a time per address.** The rating address is derived from the
escrow address, which is derived from the payer and the nonce. An escrow
address is free again once its escrow has ended, so a payer that reuses a
nonce for the same seller gets the same escrow and rating addresses for a new
job (once the earlier rating account is closed). The program tells such jobs
apart by `opened_slot` on the rating account, the slot of `open_rating`:

- Every exit of a rated escrow (release, claim, settle, refund, decline),
  `accept_rating`, `commit_rating` and the commitment hashed into it,
  `attest_quality`, and the buyer's `confirm_attestation` or
  `dispute_attestation` name the job by its `opened_slot`. What a seller, a
  buyer, a party or a judge signed for one job is refused for a later job at
  the same address (`RatingJobMismatch`, 6051), before any money moves or
  anything is stored. That includes a seller's settle or claim held back and
  sent after its job ended: it cannot pay or open the job that took the
  address.
- A rated escrow cannot end in the slot its rating was opened in
  (`RatingJustOpened`, 6050). Lock and `open_rating` in one transaction is
  fine; lock, `open_rating` and a release, settle or decline in one
  transaction is refused. Send the exit in a later transaction, after that
  slot. This is what keeps two jobs at one address from ever sharing an
  `opened_slot`.

Use a fresh nonce for every job anyway: it keeps the records of different
jobs apart for anyone reading them.

`buildRatedTokenEscrowLock` and `buildRatedSolEscrowLock` in
`@redditech/x402-solana/rating` build the two instructions together.

## Agreeing (seller)

A rating opens only if the seller agreed. There are exactly two ways to agree:

1. **Be the authority of the paid exit.** The seller settles a metered escrow,
   or claims a fixed-price one after its claim window. The seller signs that
   transaction and pays its fee.
2. **Call `accept_rating`** while the escrow is still locked. After that, a
   release by the buyer opens the rating. `accept_rating` names the job by
   the rating's `opened_slot`.

Nothing else counts. If the buyer releases and the seller did not call
`accept_rating`, the seller is paid as usual, the rating account is closed, its
rent returns to the buyer, and the job is never rated or attested. So a buyer
acting alone cannot change the record of an agent that signed nothing.

**A seller's claim transaction must not carry the buyer's signature.** If the
buyer signs a transaction in which the seller claims, even only as its fee
payer, the program treats the buyer as the authority. That is a release by the
buyer, not the seller's claim, and without `accept_rating` the job closes
unrated. The seller pays its own fees.

**What a seller checks before it accepts.** Read the escrow and its rating
account, at `confirmed` commitment or better, and check that: the escrow is
still locked and rated; the seller is its payee; the rating account names
this escrow, the buyer and the seller, and is still waiting for payment; the
judge is the one agreed (or none); the amount and the mint are those of the
job; and `opened_slot` is the slot of the lock the seller saw. Then pass that
`opened_slot` to `accept_rating`. `buildSellerAcceptRating` in
`@redditech/x402-solana/rating` reads both accounts, makes these checks against
the `expected` values it is given (opened slot, judge, amount, mint), refuses
with a reason when one differs, and returns the instruction. An acceptance
signed for an earlier job at the same address is refused by the program
(6051), so it cannot be replayed onto a later one.

A seller that does not want a rated job declines it (cancel as the payee),
which returns everything to the buyer and closes the rating account.

**Every exit of a rated escrow takes the rating account and names the job**:
the rating account, writable, right after the instruction's usual accounts,
and the rating's `opened_slot` (8 bytes, little-endian) after the
instruction's own data: release, claim, settle, refund and decline, in SOL and
in tokens. Without the account the program refuses the exit
(`RatingAccountRequired`, error 6033); without the slot, or with another
job's, `RatingJobMismatch` (6051). `withRatingAccount` in
`@redditech/x402-solana/rating` adds both, and requires the slot for a rated exit.
Read the slot when the job is agreed or verified and keep it with the job: a
slot read again just before the exit would name whichever job holds the
address by then. Every exit names its escrow this way, rated or not: an escrow's lock slot follows the data
of each of its exits (a rated job's rating opens in that slot, so it is the same number), and the program
refuses an exit naming another (`EscrowInstanceMismatch`, 6053) or landing in the lock slot
(`EscrowJustLocked`, 6052). An exit of an escrow that is not rated takes no rating account. A rated escrow has bit `0x02` set in its
flag byte; a rated metered escrow stores 3 there, so test the bits.

What agreeing commits the seller to: it must commit and reveal its own score
of the buyer within the deadlines below, or lose 5.00 reputation points.

### What in-repo providers do by default

The in-repo seller code (`verifyMeteredLock` and the escrow HTTP flow in
`@redditech/x402-solana`, used by the provider kit) reads the escrow at `confirmed`
commitment before serving. If the escrow is rated it refuses the call before
doing any work (`rated_escrow_declined`) unless the operator set
`acceptRatedEscrows: true`. Nothing is served and nothing is settled; the buyer
locks a new escrow without rating and refunds the first one when its refund
window opens. A provider that accepts rated jobs passes the rating account on
its settle and decline, with the `opened_slot` it read along with the lock,
and has taken on the duty to commit and reveal.

## Advice for buyers on fixed-price jobs

On a fixed-price job the seller can call `accept_rating` at any time while the
escrow is locked, so it can wait and see how the job went. A buyer who wants
the rating should release only after the seller accepted (`accepted` is 1 on
the rating account; `payerReleaseOpensRating` checks this), or not release and
leave the seller to claim, which opens the rating. Metered jobs are not
affected: only the seller settles them.

## Commit and reveal

Deadlines are counted in slots (a nominal 400 ms each). 1,512,000 slots is
about 7 days; real slot times drift, so the dates are approximate.

1. **Commit.** Within 1,512,000 slots of the paid exit, each side sends
   `commit_rating` with
   `sha256(rating address ‖ opened_slot (u64, little-endian) ‖ its own address ‖ score byte ‖ 32-byte salt)`,
   followed by the same `opened_slot`, read from the rating account. A
   commitment sent for another job is refused before it is stored (6051), so
   it cannot take this job's place. The score is 1 to 10.
   Keep the score and the salt: the reveal needs both. Use a fresh random
   salt for every rating. Because the rating address, its opening slot and
   the signer are in the hash, a commitment copied from the other side, from
   another job, or from an earlier job at the same address cannot be opened.
2. **Reveal.** Once both have committed, each side sends `reveal_rating` with
   its score and salt, within 1,512,000 slots of the second commitment. On the
   second reveal each score is folded into the other party's agent record
   (nine parts the old reputation, one part the score scaled to 0..10000) and
   both job counts rise by one.

A deadline includes its last slot. A party that is not a registered agent can
rate and be rated; only records that exist when the rating is finalised are
updated.

### If it is not finished

After the deadline of the phase a rating stopped in, anyone may call
`expire_rating`, which gives it its final result:

| Where it stopped | Result |
|---|---|
| Nobody committed | Final. No reputation change. |
| One side committed | The side that did not commit loses 5.00 points and gains a failed job. |
| Both committed, one side revealed | The revealed score is folded into the other party. That party, which withheld its reveal, then loses 5.00 points, and its own score is never counted. Both job counts rise by one. |
| Both committed, nobody revealed | Final. No reputation change. |

## Attestations (judge)

Once the job is paid, the judge the buyer named, and nobody else, can record
five scores (accuracy, completeness, relevance, format, latency; 1 to 10 each)
with `attest_quality`. The call names the job by the rating's `opened_slot`,
read from the rating account; scores signed for another job at the same
address are refused (6051).

- The judge must be a registered agent of type 1 (attestation) or 2 (both),
  and its record must be active.
- A job is attested at most once, and the attestation must be made before the
  buyer closes the rating account.
- The judge pays the rent of the attestation account (127 bytes): 1,295,400
  lamports, about 0.0013 SOL, returned when it is closed. The attestation
  stores the job's `opened_slot`.
- Only the buyer of that job resolves the attestation, once, naming the job
  by the `opened_slot` the attestation stores; a decision prepared for an
  earlier job's attestation at the same address is refused (6051). Confirming
  (`confirm_attestation`) raises the judge's attestation accuracy by 10.00 and
  folds a top score into its reputation. Disputing (`dispute_attestation`)
  takes 5.00 points from the judge. The judge has no appeal.
- An attestation carries no amount.
- A job the seller never agreed to have rated has no rating account after its
  release, so it cannot be attested.

## Closing accounts

- **Rating.** Once the rating is final (revealed or expired), the buyer calls
  `close_rating` and gets the rent back. Before that the program refuses
  (`RatingNotFinal`).
- **Attestation.** The judge calls `close_attestation` once the buyer has
  confirmed or disputed it, or, if the buyer never resolves it, after 1,512,000
  slots from the slot it was made in.

## Where to look

- Interface, account layouts and error numbers:
  [`programs/pinocchio-escrow/README.md`](../programs/pinocchio-escrow/README.md)
  and `programs/pinocchio-escrow/interface/vectors.json`.
- Client builders and decoders: `packages/x402-solana/src/rating.ts`.
- What a lock means and what can stop a payout:
  [`ESCROW-PAYOUT-SAFETY.md`](ESCROW-PAYOUT-SAFETY.md).
- Devnet end-to-end run, rated lane:
  [`DEVNET-ESCROW-E2E.md`](DEVNET-ESCROW-E2E.md).
