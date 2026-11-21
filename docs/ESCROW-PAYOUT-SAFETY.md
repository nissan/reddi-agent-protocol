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

The refund and claim windows are set per escrow when it is locked, and the
seller's claim opens before the buyer's refund (owner decision, 21 November
2026; the program change is in progress, so check the program's README for the
exact rules of the build you use). A short claim window suits per-call work,
where the answer is useful within seconds.

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
  payout fails. The sandbox refuses to lock SOL for a provider whose wallet is
  not already rent-exempt. Clients can use `solPayoutWouldFail` and
  `minimumSolPayout` from `@reddi/x402-solana`.
- **The treasury.** The protocol treasury (the Squads vault) must hold at least
  0.001 SOL before the first SOL payout, and must have a token account for every
  accepted mint before the first payout in that mint. `node
  scripts/check-escrow-treasury.mjs --network mainnet` checks both without
  sending anything; see the mainnet launch runbook.
- **Token accounts.** A token settle first creates, if missing, the treasury's
  token account and the buyer's associated token account, which receives the
  unused part (`prepareTokenPayout` in `@reddi/x402-solana`; the provider
  runtime in `packages/openrouter-specialists` does this on every settle).

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
  fee cannot strand funds, but the receiver gets less.
- **Transfer hook**: the mint carries a transfer hook slot, unset today. If the
  issuer sets one, transfers run the issuer's program, which can refuse them and
  so stop every lock and payout in that mint until it is removed.

USDC (Circle) and AUDD are classic SPL tokens; their issuers can freeze accounts
but have no delegate, fee or hook.

`node scripts/check-token2022-mint-posture.mjs` compares the live PYUSD and USDG
mints with the posture recorded in `config/escrow/token2022-mint-posture.json`
and exits non-zero on any change. The `Token-2022 mint watch` workflow runs it
daily. A change means re-assessing the risk to open escrows in that mint, and
pausing new locks in it if a hook or fee was switched on, before the recorded
posture is updated.
