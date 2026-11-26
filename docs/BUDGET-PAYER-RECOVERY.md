# Protect and recover a Budget without the app

A Budget's money is held by the on-chain program, not by Reddi Agent Protocol (RAP). So the payer can always look
at a Budget, close it and collect what is owed back with their own wallet, even if the RAP app or relay is offline.
This page is the payer's runbook. It needs the Budget's address, a Solana RPC endpoint and the payer's wallet.

The command ships in `@redditech/x402-solana` (0.2.1 and later). It reads public chain data and sends
ordinary transactions. Your keypair file is read on your machine only, to sign; it is never sent anywhere.

```bash
npx @redditech/x402-solana budget status <budget address> --rpc <your RPC url>
```

## 1. An agent key leaked: freeze first

If the key you gave your agent (`rap_budget_...`) may have leaked, tell the relay's signer to stop signing for that
Budget. Only the payer's wallet can ask:

```bash
npx @redditech/x402-solana budget freeze <budget address> \
  --signer <the signer's https address, shown on the Budget page> \
  --network solana-mainnet-beta \
  --keypair ~/payer.json
```

What it does: your wallet signs a short message that names the network, your wallet, the Budget and the time
(`budgetFreezeMessage`). The signer checks the signature against the Budget's payer and, from then on, signs no
further paid call and approves no further reserve for that Budget. A request that is not signed by the Budget's
payer is refused. Sending it twice is harmless. The request is good for ten minutes.

What it does not do: it does not move money, and it does not undo a reserve a provider already holds. A slice
that was already reserved can still be posted by that provider, up to the slice. You keep the whole dispute window
to dispute a post you do not recognise. Close the Budget next, so nothing new can be reserved by anyone.

Only RAP's operator can lift a freeze. Write to hello@reddi.tech if you froze a Budget by mistake.

If the signer cannot be reached, skip to the close: closing does not need the signer or the app.

## 2. Close the Budget

```bash
npx @redditech/x402-solana budget close <budget address> --rpc <your RPC url> --keypair ~/payer.json
```

The payer can close at any time. Once the open period has ended, anyone can (the money still goes only to the
payer). At the close, everything that was never reserved returns to the payer's wallet in the same transaction, and
no provider can reserve a new slice.

No keypair file? Leave `--keypair` out. The command prints the unsigned transaction (base64) with the payer as fee
payer, to sign and send from a wallet that can import one, within about a minute.

## 3. Collect what is left

Each provider's slice settles on its own:

```bash
npx @redditech/x402-solana budget status <budget address> --rpc <your RPC url>
npx @redditech/x402-solana budget payout <budget address> --rpc <your RPC url> --keypair ~/any-funded.json
```

`status` shows each slice and the slot from which it can be settled. `payout` settles every slice that can be
settled now. Anyone can send a payout; the money can only go to the provider's recorded account, the protocol
treasury (the fee) and the payer.

| Slice | When a payout settles it | What the payer gets back |
| --- | --- | --- |
| Nothing posted | When the dispute window after the close ends | The whole slice |
| Posted, not disputed | When the dispute window ends (never sooner than 9,000 slots, about an hour, after the post) | The slice minus what the provider posted |
| Posted, waived by the payer | At once | The slice minus what the provider posted |
| Disputed, judge ruled | The judge's ruling settles it | The slice minus the judge's award |
| Disputed, judge did not rule in time | When the judge window ends | The whole slice |

To dispute a post you do not recognise, use the link in the alert you were sent, before the dispute window ends.

Once the Budget is closed and every slice is settled, the Budget's account is gone and `status` says so.

## What you need to keep

- The Budget's address. It is on the Budget page, in every alert email and in your wallet's history (the account the
  opening transaction paid into).
- The payer wallet's key. Nothing else can close early or freeze.

## Without the command

Everything above is plain program instructions. `@redditech/x402-solana/budget-recover` exports the pieces
(`readBudgetStatus`, `closeBudgetInstructions`, `payoutBudgetInstructions`, `budgetFreezeMessage`), and the program's
interface is in `programs/pinocchio-escrow/README.md`, "Pooled budget".
