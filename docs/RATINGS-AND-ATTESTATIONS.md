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

**What it costs.** The buyer pays the rent of the rating account: 2,770,080
lamports, about 0.00277 SOL. It is a deposit, not a fee. It comes back when the
buyer closes the rating, when the escrow is refunded or declined, or when the
buyer releases an escrow the seller never agreed to have rated.

Use a fresh nonce for every job. The rating address is derived from the escrow
address, which is derived from the payer and the nonce, so a reused nonce
cannot be opted in until the earlier rating is closed.

`buildRatedTokenEscrowLock` and `buildRatedSolEscrowLock` in
`@reddi/x402-solana/rating` build the two instructions together.

## Agreeing (seller)

A rating opens only if the seller agreed. There are exactly two ways to agree:

1. **Be the authority of the paid exit.** The seller settles a metered escrow,
   or claims a fixed-price one after its claim window. The seller signs that
   transaction and pays its fee.
2. **Call `accept_rating`** while the escrow is still locked. After that, a
   release by the buyer opens the rating.

Nothing else counts. If the buyer releases and the seller did not call
`accept_rating`, the seller is paid as usual, the rating account is closed, its
rent returns to the buyer, and the job is never rated or attested. So a buyer
acting alone cannot change the record of an agent that signed nothing.

**A seller's claim transaction must not carry the buyer's signature.** If the
buyer signs a transaction in which the seller claims, even only as its fee
payer, the program treats the buyer as the authority. That is a release by the
buyer, not the seller's claim, and without `accept_rating` the job closes
unrated. The seller pays its own fees.

A seller that does not want a rated job declines it (cancel as the payee),
which returns everything to the buyer and closes the rating account.

**Every exit of a rated escrow takes the rating account**, writable, right
after the instruction's usual accounts: release, claim, settle, refund and
decline, in SOL and in tokens. Without it the program refuses the exit
(`RatingAccountRequired`, error 6033). `withRatingAccount` in
`@reddi/x402-solana/rating` adds it. A rated escrow has bit `0x02` set in its
flag byte; a rated metered escrow stores 3 there, so test the bits.

What agreeing commits the seller to: it must commit and reveal its own score
of the buyer within the deadlines below, or lose 5.00 reputation points.

### What in-repo providers do by default

The in-repo seller code (`verifyMeteredLock` and the escrow HTTP flow in
`@reddi/x402-solana`, used by the provider kit) reads the escrow at `confirmed`
commitment before serving. If the escrow is rated it refuses the call before
doing any work (`rated_escrow_declined`) unless the operator set
`acceptRatedEscrows: true`. Nothing is served and nothing is settled; the buyer
locks a new escrow without rating and refunds the first one when its refund
window opens. A provider that accepts rated jobs passes the rating account on
its settle and decline, and has taken on the duty to commit and reveal.

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
   `sha256(rating address ‖ its own address ‖ score byte ‖ 32-byte salt)`.
   The score is 1 to 10. Keep the score and the salt: the reveal needs both.
   Use a fresh random salt for every rating.
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
with `attest_quality`.

- The judge must be a registered agent of type 1 (attestation) or 2 (both),
  and its record must be active.
- A job is attested at most once, and the attestation must be made before the
  buyer closes the rating account.
- The judge pays the rent of the attestation account: 1,719,120 lamports,
  about 0.00172 SOL, returned when it is closed.
- Only the buyer of that job resolves the attestation, once. Confirming
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
