# Escrow payouts: what a lock means, and what can stop a payout

This page is for buyers, sellers (providers) and operators of the V1 escrow
program (`programs/pinocchio-escrow`). Nothing here is deployed on mainnet yet;
it describes the program as built.

## A lock is not payment

When a buyer locks funds in escrow, nothing has been paid. The funds sit in an
account the program controls until one of these happens:

| What happens | Who can do it | When |
|---|---|---|
| Release: the seller is paid, less the 2.5% protocol fee | The buyer | Any time |
| Settle at the actual cost (metered escrow only): the seller is paid the actual cost less the fee, and the rest goes back to the buyer | The seller | Any time |
| Decline: everything goes back to the buyer | The seller | Any time |
| Refund: everything goes back to the buyer | The buyer | Once the escrow's refund window has passed |
| Claim: the seller is paid the whole amount, less the fee | The seller | Once the escrow's claim window has passed |

The refund and claim windows are set per escrow when it is locked, in slots:
the seller's claim opens at or before the buyer's refund (`0 < claim <= refund
<= 6,480,000`). When both open in the same slot, either party can act, and the
first transaction to land wins. Once the claim window opens, an idle buyer
leaves the seller free to claim, but the seller is paid only when it sends the
claim. A short claim window suits per-call work, where the answer is useful
within seconds.

Even so, sellers should:

- Use a **metered** escrow for per-call work. The seller settles the actual cost
  right after answering and does not wait for any window.
- Treat a fixed-price lock as a deposit, not as payment, until it is released,
  settled or claimed.
- Before doing the work, check how much of the refund window is left at that
  moment, not the window the lock named: a buyer can lock, wait, and call
  late. The in-repo sellers require about 10 minutes left and serve nothing
  when the escrow or the current slot cannot be read.

And buyers should know that on a fixed-price escrow there is no refund before
the seller can claim. A seller can claim once the claim window opens, delivered
or not. A buyer who wants time to judge the work names a claim window long
enough for that, and releases early when satisfied.

## Rated escrows: one more account on every exit

A buyer can opt an escrow in to rating when it locks it (`open_rating`, in the
same transaction as the lock). [`RATINGS-AND-ATTESTATIONS.md`](RATINGS-AND-ATTESTATIONS.md)
explains ratings; this section is only about what changes for a payout.

- **Every exit takes the rating account.** Release, settle, claim, decline and
  refund of a rated escrow each need the escrow's rating account, writable,
  right after the usual accounts. Without it the program refuses the exit
  (`RatingAccountRequired`, error 6033) and the escrow stays locked. Who may
  call each exit, when, and how the money is split do not change.
- **How to tell.** A rated escrow has bit `0x02` set in its flag byte (a rated
  metered escrow stores 3). `readEscrowRatingStatus` and `withRatingAccount` in
  `@reddi/x402-solana/rating` read the bit and add the account. Opting in is
  only possible in the slot of the lock, so a seller that reads the escrow at
  `confirmed` commitment before serving sees the final answer.
- **What happens to the rating account.**

  | Exit | Rating account |
  |---|---|
  | Settle or claim by the seller | Stays open: the job can now be rated |
  | Release by the buyer, after the seller called `accept_rating` | The same |
  | Release by the buyer, seller never agreed | Closed; its rent returns to the buyer. The seller is still paid in full |
  | Decline or refund | Closed; its rent returns to the buyer |

- **No exit in the opening slot.** A rated escrow cannot end in the slot its
  rating was opened in (`RatingJustOpened`, 6050): lock and `open_rating` go in
  one transaction, and any release, settle or decline in a later one. The
  rating account's `opened_slot` names the job. Every exit of a rated escrow
  carries it after its data, and an exit, `accept_rating`, `commit_rating`,
  attestation or decision on an attestation naming another slot is refused
  (6051), so what was signed for one job, a seller's settle or claim
  included, cannot be used for a later job at the same escrow address.
- **Rent.** The buyer pays about 0.00277 SOL of rent for the rating account on
  top of the lock. It returns in the cases above, or when the buyer closes a
  finished rating.
- **A seller's claim must be signed by the seller alone.** If the buyer's
  signature is on that transaction, even only as fee payer, the program treats
  it as the buyer's release.
- **In-repo providers refuse rated escrows by default.** Unless the operator
  sets `acceptRatedEscrows`, a provider refuses a rated escrow before doing any
  work (`rated_escrow_declined`). The buyer locks again without rating and
  refunds the first escrow once its refund window opens. A provider that does
  accept them has agreed to rate the buyer in turn: it must commit and reveal
  within the deadlines or lose reputation.

## Metered billing

On a metered escrow the buyer locks a maximum it has approved. After the call,
the seller settles the cost of the tokens the model reported, which can never be
more than that maximum. The token counts come from the seller's side: the buyer
sees them, and the charge, in the receipt. **The maximum is the buyer's worst
case.** Buyers should set it to what they are willing to pay for one call.

## Accounts that must exist before a payout

The runtime refuses a payout that would leave a receiving account in a state it
does not allow, even when the escrow program accepts it:

- **SOL to an empty wallet.** A SOL payout to a wallet with no SOL must be at
  least the rent-exempt minimum (890,880 lamports, about 0.00089 SOL), or the
  payout fails. The program refuses such a lock: a fixed-price SOL lock must be
  large enough to leave the seller's wallet rent-exempt, and a metered SOL lock
  needs a seller wallet that already is. The sandbox checks the same before
  asking for a signature. Clients can use `solPayoutWouldFail` and
  `minimumSolPayout` from `@reddi/x402-solana`.
- **A frozen or closed seller token account.** The program refuses a token lock
  whose source or recipient account is frozen. If the recorded recipient is
  closed or frozen after the lock, the seller claims or settles to another
  token account it owns (`payTo` in `@reddi/x402-solana`).
- **The treasury.** The protocol treasury (the Squads vault) must hold at least
  0.001 SOL before the first SOL payout, and must have a token account for every
  accepted mint before the first payout in that mint. `node
  scripts/check-escrow-treasury.mjs --network mainnet` checks both without
  sending anything; see the mainnet launch runbook.
- **Token accounts.** A token settle creates no accounts. Before a provider
  accepts a lock it reads the three accounts the settle pays into: its own
  token account, the treasury's, and the account the buyer funded the lock
  from, which receives the unused part (`checkMeteredPayout` in
  `@reddi/x402-solana`, run by `verifyMeteredLock`). Each must exist, be
  initialised, not frozen, belong to the right owner and not require a memo;
  otherwise the call is refused before any work and the lock stays usable. The
  treasury's token account for each currency must therefore exist before any
  provider takes that currency. If a buyer closes its account after its lock
  was accepted, the provider kit tries the buyer's associated token account,
  and pays to create one only when the operator opted in
  (`refundAccountSubsidy.maxPerDay`); otherwise that settle is held.

## Issuer powers over PYUSD and USDG

PYUSD and USDG are Token-2022 stablecoins issued by Paxos. The issuer keeps
powers over every account holding them, and the escrow program cannot override
them:

- **Freeze**: the issuer can freeze any token account, including an escrow vault
  or a buyer's or seller's account. A frozen account cannot send or receive.
- **Permanent delegate**: the issuer can move or burn tokens from any account
  holding the mint, including an escrow vault.
- **Transfer fee**: the mint carries a transfer fee, set to zero today. The
  issuer can raise it. The program pays out what the vault actually holds, so a
  fee cannot strand funds, but the receiver gets less. Tokens sent to a vault
  under a fee leave withheld fees on it; passing the mint writable on the
  payout or refund moves them to the mint so the vault can close
  (`harvestWithheldFees`).
- **Transfer hook**: the mint carries a transfer hook slot, unset today. If the
  issuer sets one, transfers run the issuer's program, which can refuse them and
  so stop every lock and payout in that mint until it is removed.

USDC (Circle) and AUDD are classic SPL tokens; their issuers can freeze accounts
but have no delegate, fee or hook.

`node scripts/check-token2022-mint-posture.mjs` compares the live PYUSD and USDG
mints with the posture recorded in `config/escrow/token2022-mint-posture.json`
and exits non-zero on any change.

- **Daily watch.** The `Token-2022 mint watch` workflow runs it every day. When
  a scheduled or manual run fails, the workflow opens an issue labelled
  `mint-watch` (or comments on the open one) and assigns it to the repository
  owner, who is the named recipient of the alert.
- **Before opening a rail.** Run the check by hand (or start the workflow) on
  launch day, and before accepting the first lock in PYUSD or USDG. Record the
  result next to the treasury readiness check in the launch record.
- **If the posture changes.** A failed check never updates the recorded posture
  by itself. The operator:
  1. stops new escrow locks in the affected mint: each provider running the
     provider kit lists the currency in `pausedCurrencies` (or sets
     `RAP_PROVIDER_PAUSED_CURRENCIES`) and restarts, after which it refuses
     paid calls in it with `currency_paused` and reports
     `acceptingPayments: false`. The app's health sweep reads that field on
     `/healthz` and marks the listing as failing, so the planner stops
     offering it. The sweep runs once a day, so to hide the listing at once
     the operator also reruns `rap-provider register` or pauses the listing;
  2. reads the change (hook program, fee, delegate, freeze or pause authority)
     and decides whether open escrows in that mint can still settle;
  3. updates `config/escrow/token2022-mint-posture.json` only after that
     decision, in a reviewed pull request, before reopening the mint.

A freeze of one account (a vault, a buyer's or a seller's) does not change the
mint and is not caught by this watch; it shows up as a failed payout.
