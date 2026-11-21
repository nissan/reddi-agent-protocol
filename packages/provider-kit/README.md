# @reddi/provider-kit

Run your own paid provider on Reddi Agent Protocol: one config file, one command, any OpenAI-compatible model.

> Payments prove transfer; RAP Assurance proves paid work.

You bring a model (OpenRouter, a hosted API, or a local Ollama or vLLM server) and a Solana wallet. The kit puts a paid endpoint in front of it. Buyers pay per token through a metered escrow, and every paid answer carries a receipt signed by your wallet.

**Status.** Repo-local and not yet on npm. Tested against a simulated chain; the devnet walk-through below is the next proof. The V1 escrow program is not on mainnet yet, so use `solana-devnet`. The kit is new code and has had no independent security review.

## How a paid call works

1. A buyer sends an ordinary chat completion request. With no payment, the provider answers **402** with its price per million input and output tokens, an estimate for this request, and the maximum to lock (twice the estimate by default).
2. The buyer locks that maximum in a metered escrow payable to your wallet, and repeats the request naming the lock.
3. The provider checks the lock on chain: right program, right wallet, right mint, enough to cover the estimate, at least 10 minutes of refund window left, and not used before.
4. The model answers. The provider counts the tokens it reports and settles the **actual cost**. The escrow program pays you, sends the protocol fee to the treasury, and returns the unused part of the maximum to the buyer, all in one transaction.
5. The buyer gets the answer with a `reddi.receipt.v2` receipt naming the settle transaction, the tokens used and the amount charged.

The buyer is charged only after the model has answered, and the answer is sent only after the settle has confirmed. If the model fails, the provider declines the lock and the buyer gets everything back.

### The money, in one place

| | |
|---|---|
| Your price | Per million input tokens and per million output tokens, in USDC, AUDD, PYUSD or USDG. You choose it. |
| The buyer's maximum | What the buyer locks. Twice the estimate by default; never below the estimate. The charge can never exceed it. |
| The charge | Tokens used times your price, rounded up to the smallest unit. |
| Protocol fee | Planned at 2.5% of the charge, rounded down, taken out of your share. The buyer pays nothing on top. |
| A lock is not payment | You are paid when your settle confirms. Until then the buyer's refund window is running, which is why the provider wants 10 minutes left before it starts work. See `docs/ESCROW-PAYOUT-SAFETY.md`. |
| What you pay | The transaction fee for each settle. Nothing is created for anyone by default: a lock is refused up front if the buyer's token account, the treasury's or yours could not receive. You may opt in to paying a buyer's token account rent (about 0.002 SOL, not returned) with `refundAccountSubsidy`. |

## Quickstart on devnet

You need Node 20 or newer, the Solana CLI, and a wallet with a little devnet SOL (https://faucet.solana.com).

```bash
# From a checkout of this repository, until the packages are on npm:
npm --prefix packages/x402-solana ci && npm --prefix packages/x402-solana run build
npm --prefix packages/provider-kit ci && npm --prefix packages/provider-kit run build
alias rap-provider="node $PWD/packages/provider-kit/dist/src/cli.js"

# 1. A wallet for the provider, and its USDC token account.
solana-keygen new --outfile ~/.config/solana/provider.json
solana airdrop 1 "$(solana address -k ~/.config/solana/provider.json)" --url devnet
spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --owner "$(solana address -k ~/.config/solana/provider.json)" --url devnet

# 2. A config. It starts with mock answers so you can try the payment flow first.
rap-provider init --wallet "$(solana address -k ~/.config/solana/provider.json)"
#    then set "keypairPath": "~/.config/solana/provider.json" in provider.json

# 3. Check the setup. This reads only; it sends and spends nothing.
rap-provider doctor

# 4. Serve.
rap-provider start
```

In another terminal, make a paid call as a buyer. Use a second, devnet-only wallet holding devnet USDC (https://faucet.circle.com):

```bash
BUYER_KEYPAIR_PATH=~/.config/solana/buyer.json \
  node packages/provider-kit/examples/paid-call.mjs http://localhost:8787 "Write a haiku about escrow"
```

It prints the price, the quote, the lock transaction, the answer, what was charged and refunded, the settle transaction, and whether the receipt verified.

### Switch to a real model

In `provider.json`:

```json
"upstream": { "baseUrl": "https://openrouter.ai/api/v1", "apiKeyEnv": "UPSTREAM_API_KEY", "mock": false },
"model": "openai/gpt-4o-mini"
```

then `UPSTREAM_API_KEY=... rap-provider start`. For a local model, point `baseUrl` at it, for example `http://localhost:11434/v1` for Ollama, and set `model` to its name. No API key is needed.

To sell more than a raw model, add instructions with `"systemPrompt"` or, for long or private ones, `"systemPromptFile": "prompt.txt"` (a path next to the config). The prompt stays on your server. Its tokens are part of every call, so they are counted in the quote the buyer sees.

## Configuration

| Field | Meaning |
|---|---|
| `name`, `description` | Shown to buyers. |
| `network` | `solana-devnet` or `solana-mainnet-beta`. |
| `wallet` | Your provider wallet's address. Payouts go to its token account for the currency. |
| `publicUrl` | Where buyers reach you. Must be `https` unless it is localhost. |
| `model` | The model you declare. Receipts name it. It is a declaration, not proof of which model ran. |
| `upstream.baseUrl` | An OpenAI-compatible base URL. |
| `upstream.model` | The name to send upstream, when it differs from `model`. |
| `upstream.apiKeyEnv` | Name of the environment variable holding the API key. Default `UPSTREAM_API_KEY`. The key itself never goes in the file. |
| `upstream.mock` | `true` answers with canned text. Refused on mainnet. |
| `price.currency` | `USDC`, `AUDD`, `PYUSD` or `USDG`. |
| `price.inputPerMillion`, `price.outputPerMillion` | Decimal prices per million tokens. |
| `price.maxOutputTokens` | The most output tokens one call may use. Default 1000. |
| `systemPrompt`, `systemPromptFile` | Instructions placed before every request. |
| `keypairPath` | The wallet's keypair file. Must not be readable by other users (`chmod 600`). |
| `replayFile` | Where accepted escrows are remembered. Default `.rap-provider/accepted-escrows.log`. Keep it on a disk that survives restarts. |
| `rpcUrl`, `port` | Also settable as `SOLANA_RPC_URL` and `PORT`. An RPC endpoint is required on mainnet. |
| `mint` | Devnet only, for currencies other than USDC. On mainnet the mints are fixed. |
| `pausedCurrencies` | Currencies you have stopped taking new locks in, for example `["PYUSD"]`. Also `RAP_PROVIDER_PAUSED_CURRENCIES=PYUSD,USDG`. See "Pausing a currency". |
| `payoutAccount` | Recovery only: another token account of the currency that your wallet owns. Payouts go there when your usual token account is closed or frozen. |
| `refundAccountSubsidy.maxPerDay` | Off unless set. How many buyer token accounts you will pay to create in a UTC day, when a buyer closed its own after you accepted its lock. |

## Pausing a currency

An issuer can change how its token moves: PYUSD and USDG are Token-2022 mints whose issuer can add a transfer hook, change a fee, or freeze accounts. When that happens, stop taking new locks in that currency until you have read the change:

```bash
RAP_PROVIDER_PAUSED_CURRENCIES=PYUSD rap-provider start
# or, in provider.json:  "pausedCurrencies": ["PYUSD"]
```

While your price currency is paused, paid calls are refused with `currency_paused` before any lock is read, no price is offered, and `/.well-known/reddi-agent.json` and `/healthz` report `"acceptingPayments": false`, which is what a listing should show. `rap-provider doctor` shows the pause. Remove the currency from the list and restart to resume. `docs/ESCROW-PAYOUT-SAFETY.md` says when to pause.

## What the kit does to protect you and your buyers

- **It refuses to start half-working**: no key, a key for another wallet, a key file others can read, a payment memory file another process holds, or mock answers on mainnet.
- **One lock pays for one call**, including after a restart. Accepted escrows are written to disk before the model is called.
- **It checks the cluster** before trusting any account, so a lock on another network is never taken as payment.
- **It checks that the payout can land before doing any work.** With the lock it reads your token account, the treasury's and the account the buyer funded the lock from: each must exist, be initialised, not frozen, belong to the right owner and not require a memo. If one fails, the call is refused, the lock is not used up, and the buyer can present it again once the account is fixed.
- **It creates nothing at your cost by default.** If a buyer closes its account after you accepted the lock, the settle is tried once more with the buyer's associated token account; if that is gone too, the settle is held and the answer withheld, unless you opted in to `refundAccountSubsidy`.
- **Receipts state what the chain shows.** After the settle confirms, the kit reads the transaction back and signs a receipt for what actually moved: your credit plus the treasury's fee as the amount, and the model's token counts separately. If the transaction cannot be read back, or the amounts do not add up, the buyer still gets the answer it paid for, the response says `"confirmed": false`, and no receipt is signed.
- **Your key signs two things only**: settle (or decline) transactions for escrows payable to you, and receipts. It is read once from the key file and is never logged or sent anywhere.
- **Run one process per payment memory file.** For several instances behind a load balancer, use a shared database store (`DatabaseReplayStore` in `@reddi/x402-solana`) through the library API.

## Limits today

- Do not run a funded provider on mainnet yet. The payout checks and confirmed receipts above are covered by tests against a simulated chain; they have not been run against a live cluster, and the treasury's token accounts must be confirmed ready for each currency first (`rap-provider doctor` checks yours).
- A settle that is held is not retried later by itself. The log line `settle_failed` names the escrow; the lock stays open until its refund window, and you can settle it by hand within that time.
- No streaming responses. Requests with `stream: true` are refused.
- Message content must be text.
- Token currencies only. SOL-priced metered calls are not offered.
- The estimate counts four characters as one token. A buyer who locks exactly the minimum caps your payment at that estimate, so text that tokenises more densely can cost you the difference.
- When the model reports no usage, tokens are estimated the same way.
- `rap-provider register` (list yourself in the registry from the command line) is planned; until then use the web form.

## Library use

```ts
import { createProviderHandler, parseProviderConfig, createProviderChain, FileReplayStore } from "@reddi/provider-kit";
```

`createProviderHandler(config, deps)` returns a `(Request) => Promise<Response>` you can mount in any server. The seller-side payment logic on its own is in `@reddi/x402-solana/provider`.

## License

MIT
