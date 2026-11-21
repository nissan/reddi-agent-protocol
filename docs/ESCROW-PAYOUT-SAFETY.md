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
     `acceptingPayments: false`. The app's listing does not read that field
     yet (#852), so the provider also takes the currency off its listing by
     hand;
  2. reads the change (hook program, fee, delegate, freeze or pause authority)
     and decides whether open escrows in that mint can still settle;
  3. updates `config/escrow/token2022-mint-posture.json` only after that
     decision, in a reviewed pull request, before reopening the mint.

A freeze of one account (a vault, a buyer's or a seller's) does not change the
mint and is not caught by this watch; it shows up as a failed payout.
