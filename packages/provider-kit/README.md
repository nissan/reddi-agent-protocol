# @redditech/provider-kit

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

You need Node 20 or newer and the Solana CLI (https://solana.com/docs/intro/installation). Devnet SOL and USDC come from web faucets: the command-line airdrop is closed on devnet.

```bash
# From a checkout of this repository, until the packages are on npm:
npm --prefix packages/x402-solana ci && npm --prefix packages/x402-solana run build
npm --prefix packages/provider-kit ci && npm --prefix packages/provider-kit run build
alias rap-provider="node $PWD/packages/provider-kit/dist/src/cli.js"

# 1. A wallet for the provider. Fund its address with 0.5 devnet SOL at
#    https://faucet.solana.com, then create its USDC token account.
solana-keygen new --outfile ~/.config/solana/provider.json
solana address -k ~/.config/solana/provider.json
solana balance -k ~/.config/solana/provider.json --url devnet   # after the faucet
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

In another terminal, make a paid call as a buyer. Use a second, devnet-only wallet: give it 0.5 devnet SOL at https://faucet.solana.com for fees, and devnet USDC at https://faucet.circle.com (choose Solana Devnet), which also creates its USDC token account.

```bash
solana-keygen new --outfile ~/.config/solana/buyer.json
solana address -k ~/.config/solana/buyer.json   # fund this address at both faucets
BUYER_KEYPAIR_PATH=~/.config/solana/buyer.json \
  node packages/provider-kit/examples/paid-call.mjs http://localhost:8787 "Write a haiku about escrow"
```

It prints the price, the quote, the lock transaction, the answer, what was charged and refunded, the settle transaction, and whether the receipt verified.

To try a session (one lock, several calls, one settle), run `node packages/provider-kit/examples/session-call.mjs http://localhost:8787 3` with the same `BUYER_KEYPAIR_PATH`. It checks the whole receipt chain at the end.

### Switch to a real model

In `provider.json`:

```json
"upstream": { "baseUrl": "https://openrouter.ai/api/v1", "apiKeyEnv": "UPSTREAM_API_KEY", "mock": false },
"model": "openai/gpt-4o-mini"
```

then `UPSTREAM_API_KEY=... rap-provider start`. For a local model, point `baseUrl` at it, for example `http://localhost:11434/v1` for Ollama, and set `model` to its name. No API key is needed.

To sell more than a raw model, add instructions with `"systemPrompt"` or, for long or private ones, `"systemPromptFile": "prompt.txt"` (a path next to the config). The prompt stays on your server. Its tokens are part of every call, so they are counted in the quote the buyer sees.

RAP's own first-party providers, the video script writer and the humaniser, are set up this way: see [examples/first-party](examples/first-party/README.md) for their configs, prices and an outline of their private instructions.

## List your provider

Buyers and the app find a provider through two records: the on-chain registry, and the app's listing with your price. One command writes both.

```bash
rap-provider register --dry-run   # prints the registry accounts and the listing; signs and sends nothing
rap-provider register             # registers, signs in with your wallet, lists
rap-provider status               # reads both back
```

What `register` does, in order, and what it costs:

1. Checks the key file is your configured wallet's, the RPC endpoint is your network, and the app serves the same network. If any is wrong it stops before sending anything.
2. If your wallet has no registry record, sends `register_agent`. The program burns a 0.01 SOL registration fee and your wallet pays the record's rent. Run again, it does not register twice.
3. Signs one sign-in message with your wallet (it moves no funds), sent to the sign-in service the app names, and then creates or updates your listing: name, public address, model, currency and per-token price. A paused currency is listed as paused.

`publicUrl` must be a public https address before you list. Set `listing.capabilities` to say what the provider is for, for example `{ "taskTypes": ["writing"] }`, and `listing.appUrl` (or `RAP_APP_URL`) for another deployment of the app.

The wallet sign-in was checked against the devnet app on 21 November 2026: a message signed by the kit is accepted and the app confirms the session for that wallet. A full `register` with a listing has not been run yet.

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
| `listing.appUrl`, `listing.capabilities` | For `register`: the app to list in, and what the listing says the provider can do. |
| `mint` | Devnet only, for currencies other than USDC. On mainnet the mints are fixed. |
| `pausedCurrencies` | Currencies you have stopped taking new locks in, for example `["PYUSD"]`. Also `RAP_PROVIDER_PAUSED_CURRENCIES=PYUSD,USDG`. See "Pausing a currency". |
| `payoutAccount` | Recovery only: another token account of the currency that your wallet owns. Payouts go there when your usual token account is closed or frozen. |
| `refundAccountSubsidy.maxPerDay` | Off unless set. How many buyer token accounts you will pay to create in a UTC day, when a buyer closed its own after you accepted its lock. |
| `sessions.enabled` | `false` by default: session calls are refused with `sessions_not_offered` and single calls are unchanged. Set `true` to offer sessions, and watch for log lines with `"alert": true` (`session_settle_waiting`, `session_refunded_unpaid`). |
| `sessions.idleSeconds` | How long a session may sit without a call before the kit settles it. 30 to 3600, default 600. |
| `sessions.file` | Where open sessions are remembered. Default `.rap-provider/sessions.jsonl`. Keep it on a disk that survives restarts. |

## Pausing a currency

An issuer can change how its token moves: PYUSD and USDG are Token-2022 mints whose issuer can add a transfer hook, change a fee, or freeze accounts. When that happens, stop taking new locks in that currency until you have read the change:

```bash
RAP_PROVIDER_PAUSED_CURRENCIES=PYUSD rap-provider start
# or, in provider.json:  "pausedCurrencies": ["PYUSD"]
```

While your price currency is paused, paid calls are refused with `currency_paused` before any lock is read, no price is offered, and `/.well-known/reddi-agent.json` and `/healthz` report `"acceptingPayments": false`, which is what a listing should show. `rap-provider doctor` shows the pause. Remove the currency from the list and restart to resume. `docs/ESCROW-PAYOUT-SAFETY.md` says when to pause.

## Sessions: several calls, one settle

An agent that makes many small calls to you can lock one escrow and use it for all of them, so it pays one lock and you send one settle. The buyer sends the same `x402-payment` header on every call, plus `x402-session-sequence: 1`, `2`, `3` and so on.

A lock's escrow, payer and nonce are public once it confirms, so they do not show who is calling. The buyer therefore makes a fresh session key and has its payer wallet sign, once, a delegation naming the escrow, your wallet, that key and an expiry of at most seven days (`x402-session-delegation`). Every call, close and read also carries that key's signature over the action, the escrow, the call number and the SHA-256 of the body (`x402-session-signature`). `sessionDelegationHeaderValue` and `sessionSignatureHeaderValue` in `@redditech/x402-solana` build both. A request without them, or signed by anyone else, is refused with `401` before the lock is read, and a session keeps the key it started with.

The kit then:

- checks before each call that the cost so far plus this call's worst case still fits under the lock, and refuses with `session_max_reached` when it does not;
- answers every call with a signed receipt whose `session` block carries the sequence, this call's tokens, the running totals and cost, and the hash of the previous receipt, so the buyer can check the chain (`verifyReddiReceiptV2Session` in `@redditech/agent-protocol`);
- writes the session to `sessions.file` before it answers, so a restart goes on from the last answered call;
- settles once, for the total, when the buyer sends `x402-session: close` on a call or `POST /v1/session/close`, when the lock is used up, after `sessions.idleSeconds` without a call, or before the lock's refund window opens. The closing receipt is the one with `closed: true` and a `payment` block for the amount settled.

A call number that is out of order or used before is refused with `session_sequence_invalid`, and a request signed by another key than the session started with with `session_key_mismatch`; a call the model could not answer is not counted and can be sent again with the same number. A lock used for a session cannot also pay for a single call, or the other way round. If no call was answered, closing the session declines the lock and the buyer gets it all back. `GET /v1/session/<escrow>` shows a session's totals and, once closed, its closing receipt.

The settle is signed and written to `sessions.file` before it is sent, and only that signature can count as the session's settle. If the kit cannot tell whether it landed (an RPC outage, a restart), the session stays pending and the same signed transaction is looked up and sent again on the next sweep; it is never marked settled on a guess. If the buyer has closed the account that funded the lock, the settle returns the unused part to the buyer's associated token account and creates it at your cost (about 0.002 SOL) when it does not exist, whatever `refundAccountSubsidy` says. If the escrow is gone and no settle of yours landed (the buyer refunded once the refund window opened), the session is recorded as `refunded_unpaid` and logged as `session_refunded_unpaid` with `"alert": true`, because the calls served were not paid. A lock made again at the same address with the same nonce is a different lock and is never charged for an earlier session's calls. The kit settles ahead of the refund window to avoid all this.

The worst case of a call counts four characters of input as one token. A model that bills more input than that can take a session's total past the lock; the charge is capped at the lock, so you absorb the difference and the buyer never pays more than it locked.

## What the kit does to protect you and your buyers

- **It refuses to start half-working**: no key, a key for another wallet, a key file others can read, a payment memory file another process holds, or mock answers on mainnet.
- **Only the payer's own call is served.** The lock is public on chain, so a paid call must also carry the payer's signature over that exact request (`x402-session-delegation` and `x402-session-signature`, action `single`; `paidCallAuthHeaders` in `@redditech/x402-solana` builds them). A call without it, or signed by anyone else, is refused with `401` before the lock is read, and the lock stays usable by its payer. Hardware wallets such as Ledger sign Solana off-chain messages with a header prefix, which this check does not accept yet; since the payer wallet must sign the delegation, a buyer paying from one is refused, so pay from a software wallet for now. Buyer clients should delegate for a day (`delegationExpiresAt()`), not the seven-day maximum, and keep the session key in memory only.
- **One lock pays for one call**, including after a restart. Accepted escrows are written to disk before the model is called.
- **It checks the cluster** before trusting any account, so a lock on another network is never taken as payment.
- **It checks that the payout can land before doing any work.** With the lock it reads your token account, the treasury's and the account the buyer funded the lock from: each must exist, be initialised, not frozen, belong to the right owner and not require a memo. If one fails, the call is refused, the lock is not used up, and the buyer can present it again once the account is fixed.
- **It creates nothing at your cost for a single call by default.** If a buyer closes its account after you accepted the lock, the settle is tried once more with the buyer's associated token account; if that is gone too, the settle is held and the answer withheld, unless you opted in to `refundAccountSubsidy`. (A session's settle creates it regardless; see above.)
- **A settle counts only under its own signature.** The kit signs the settle and records it (`pending-settles.jsonl` beside the payment memory) before sending it. If sending reports a failure, the kit looks up that signature: landed means the buyer paid and gets the answer; failed or expired means nothing was charged by it, and the kit tries once more while the escrow is still locked. An escrow closed by anything else is never taken as paid: the answer is withheld (`escrow_closed`). If the chain cannot say, the answer is held for ten minutes (`503 settle_pending`): the buyer sends the same signed request again and gets it once the settle is known to have landed. A pending settle whose answer is no longer held is looked up by the sweep: if it landed the log says `paid_answer_lost` with `"alert": true` so you can make it right; if it cannot land the lock is declined so the buyer gets it all back.
- **Receipts state what the chain shows.** After the settle confirms, the kit reads the transaction back and signs a receipt for what actually moved: your credit plus the treasury's fee as the amount, and the model's token counts separately. If the transaction cannot be read back, or the amounts do not add up, the buyer still gets the answer it paid for, the response says `"confirmed": false`, and no receipt is signed.
- **Your key signs two things only**: settle (or decline) transactions for escrows payable to you, and receipts. It is read once from the key file and is never logged or sent anywhere.
- **Run one process per payment memory file.** For several instances behind a load balancer, use a shared database store (`DatabaseReplayStore` in `@redditech/x402-solana`) through the library API.

## Limits today

- Do not run a funded provider on mainnet yet. A single paid call and a three-call session were run end to end on devnet on 21 November 2026 (mock answers, devnet USDC); the payout refusals and recovery paths above are covered by tests against a simulated chain only. The treasury's token accounts must be confirmed ready for each currency first (`rap-provider doctor` checks yours).
- A single-call settle known not to have landed is not retried later by itself (a session's settle is retried by the sweep until the refund window). The log line `settle_failed` names the escrow; the lock stays open until its refund window, and you can settle it by hand within that time.
- If a buyer turns on required memos for its associated token account (a Token-2022 feature, so PYUSD and USDG only), no settle with a refund leg can land. The kit logs `session_settle_waiting` with `"alert": true`.
- No streaming responses. Requests with `stream: true` are refused.
- Message content must be text.
- Token currencies only. SOL-priced metered calls are not offered.
- The estimate counts four characters as one token. A buyer who locks exactly the minimum caps your payment at that estimate, so text that tokenises more densely can cost you the difference.
- When the model reports no usage, tokens are estimated the same way.
- Sessions on a rated escrow are not offered yet.

## Library use

```ts
import { createProviderHandler, parseProviderConfig, createProviderChain, FileReplayStore } from "@redditech/provider-kit";
```

`createProviderHandler(config, deps)` returns a `(Request) => Promise<Response>` you can mount in any server. The seller-side payment logic on its own is in `@redditech/x402-solana/provider`.

## License

MIT
