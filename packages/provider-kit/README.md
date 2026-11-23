# @redditech/provider-kit

Run your own paid provider on Reddi Agent Protocol: one config file, one command, any OpenAI-compatible model or Claude.

You bring a model (OpenRouter, a hosted API, or a local Ollama or vLLM server) and a Solana wallet. The kit puts a paid endpoint in front of it. Buyers pay per token through a metered escrow, and every paid answer carries a receipt signed by your wallet.

```bash
npm install -g @redditech/provider-kit
rap-provider --help
```

Mainnet is coming soon. Until the V1 escrow program is live there, run your provider on `solana-devnet`: the walk-through below takes you from a new wallet to a paid, receipted call.

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
| Protocol fee | Planned at 5% of the charge, with a 2.5% launch rate for payouts up to the end of 31 March 2027 (UTC), rounded down, taken out of your share. The buyer pays nothing on top. |
| A lock is not payment | You are paid when your settle confirms. Until then the buyer's refund window is running, which is why the provider wants 10 minutes left before it starts work. See `docs/ESCROW-PAYOUT-SAFETY.md`. |
| What you pay | The transaction fee for each settle. Nothing is created for anyone by default: a lock is refused up front if the buyer's token account, the treasury's or yours could not receive. You may opt in to paying for a new buyer token account (about 0.002 SOL, not returned) with `refundAccountSubsidy`. |

## Quickstart on devnet

You need Node 20 or newer and the Solana CLI (https://solana.com/docs/intro/installation). Devnet SOL and USDC come from web faucets: the command-line airdrop is closed on devnet.

```bash
npm install -g @redditech/provider-kit

# 1. A wallet for the provider. Fund its address with 0.5 devnet SOL at
#    https://faucet.solana.com, then create its USDC token account.
solana-keygen new --outfile ~/.config/solana/provider.json
solana address -k ~/.config/solana/provider.json
solana balance -k ~/.config/solana/provider.json --url devnet   # after the faucet
spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --owner "$(solana address -k ~/.config/solana/provider.json)" --url devnet

# 2. A config. It starts with mock answers so you can try the payment flow first.
rap-provider init --wallet "$(solana address -k ~/.config/solana/provider.json)"
#    init points keypairPath at the Solana CLI default, ~/.config/solana/id.json.
#    Set "keypairPath": "~/.config/solana/provider.json" in provider.json instead.

# 3. Check the setup. This reads only; it sends and spends nothing. It opens the
#    key file named in keypairPath to check it matches your wallet, and says which
#    file it read; nothing from it is printed or sent.
rap-provider doctor

# 4. Serve.
rap-provider start
```

In another terminal, make a paid call as a buyer with the example scripts in this repository (clone it, then run `npm ci && npm run build` in `packages/x402-solana` and `packages/provider-kit`). Use a second, devnet-only wallet: give it 0.5 devnet SOL at https://faucet.solana.com for fees, and devnet USDC at https://faucet.circle.com (choose Solana Devnet), which also creates its USDC token account.

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
rap-provider adl                  # prints your ADL document
```

What `register` does, in order, and what it costs:

1. Checks the key file is your configured wallet's, the RPC endpoint is your network, and the app serves the same network. If any is wrong it stops before sending anything.
2. If your wallet has no registry record, sends `register_agent`. The program burns a 0.01 SOL registration fee and your wallet pays the record's rent. Run again, it does not register twice.
3. Signs one sign-in message with your wallet (it moves no funds), sent to the sign-in service the app names, and then creates or updates your listing: name, public address, model, currency and per-token price, with your ADL document. A paused currency is listed as paused.

### Your ADL document

Every provider describes itself in [Agent Definition Language](https://agent-protocol.reddi.tech/adl) v0.3, made from `provider.json`: the model it declares, a live charge on the Solana rail settled through metered escrow, its per-token price, the most one call can cost, the wallet that is paid, the protocol fee (5%, at the 2.5% launch rate for payouts before 1 April 2027 UTC, capped at 0.1 SOL on SOL), and a `reddi.receipt.v2` receipt for every paid answer. It passes ADL Level 3.

The provider serves it at `/.well-known/adl.yaml`, `/.well-known/reddi-agent.json` links to it, and `register` sends it with the listing. The app checks it and refuses a listing whose ADL fails Level 3 or says something different from the listing. Because both come from the same config, they cannot drift. `rap-provider adl` prints it, `--json` prints the Level 3 report, and `rap-provider doctor` checks it.

The most one call can cost is the price of every input token a request can hold (a 1 MB body, at most 1,000,000 tokens at one a byte, plus your system prompt) and the full `maxOutputTokens`. Buyers lock less for an ordinary call; this is the ceiling they never need to go above.

`publicUrl` must be a public https address before you list. Set `listing.capabilities` to say what the provider is for, for example `{ "taskTypes": ["writing"] }`, and `listing.appUrl` (or `RAP_APP_URL`) for another deployment of the app.

The wallet sign-in works against the devnet app: a message signed by the kit is accepted and the app confirms the session for that wallet.

## Configuration

| Field | Meaning |
|---|---|
| `name`, `description` | Shown to buyers. |
| `network` | `solana-devnet` or `solana-mainnet-beta`. |
| `wallet` | Your provider wallet's address. Payouts go to its token account for the currency. |
| `publicUrl` | Where buyers reach you. Must be `https` unless it is localhost. |
| `model` | The model you declare. Receipts name it. It is a declaration, not proof of which model ran. |
| `upstream.provider` | `openai-compatible` (the default) or `anthropic` for Claude through the Anthropic API. |
| `upstream.baseUrl` | An OpenAI-compatible base URL. Not used with `anthropic`. |
| `upstream.effort` | Claude only: `low`, `medium`, `high`, `xhigh` or `max`. Lower effort means fewer thinking tokens, so a lower bill for the buyer. |
| `upstream.thinking` | Claude only: `off` turns thinking off where the model allows it. Claude Opus 5.5 always thinks; lower `effort` instead. |
| `upstream.model` | The name to send upstream, when it differs from `model`. |
| `upstream.apiKeyEnv` | Name of the environment variable holding the API key. Default `UPSTREAM_API_KEY`. The key itself never goes in the file. |
| `upstream.mock` | `true` answers with canned text. Refused on mainnet. |
| `price.currency` | `USDC`, `AUDD`, `PYUSD` or `USDG`. |
| `price.inputPerMillion`, `price.outputPerMillion` | Decimal prices per million tokens. |
| `price.maxOutputTokens` | The most output tokens one call may use. Default 1000. |
| `systemPrompt`, `systemPromptFile` | Instructions placed before every request. |
| `keypairPath` | The wallet's keypair file. Must not be readable by other users (`chmod 600`). |
| `replayFile` | Where accepted escrows are remembered. Default `.rap-provider/accepted-escrows.log`. Keep it on a disk that survives restarts. |
| `rpcUrl`, `port` | Also settable as `SOLANA_RPC_URL` and `PORT`. An RPC endpoint is required on mainnet. It must answer `getSignatureStatuses` with `searchTransactionHistory`, which is how the kit tells whether a recorded settle landed after a restart; an endpoint without transaction history leaves those settles pending. Helius does. |
| `listing.appUrl`, `listing.capabilities` | For `register`: the app to list in, and what the listing says the provider can do. |
| `mint` | Devnet only, for currencies other than USDC. On mainnet the mints are fixed. |
| `pausedCurrencies` | Currencies you have stopped taking new locks in, for example `["PYUSD"]`. Also `RAP_PROVIDER_PAUSED_CURRENCIES=PYUSD,USDG`. See "Pausing a currency". |
| `payoutAccount` | Recovery only: another token account of the currency that your wallet owns. Payouts go there when your usual token account is closed or frozen. |
| `refundAccountSubsidy.maxPerDay` | Off unless set. How many buyer token accounts you will pay to create in a UTC day, when a buyer closed, froze or handed over its own after you accepted its lock. |
| `capacity.requestsPerMinute` | Off unless set. Calls your model takes in any 60 seconds. Past it the provider answers `503 provider_busy` with `retry-after` before a buyer locks anything. Set it to a free model's rate limit. |
| `capacity.requestsPerDay` | Off unless set. Calls your model takes in a UTC day, a cap on your model bill. Past it the provider is offline until midnight UTC. |
| `capacity.cooldownSeconds` | Default 60. How long the provider stays busy after the model answers 429. The call that hit the 429 is refunded in full. |
| `lockBoundDelegations` | Off unless `true`. Also accepts a payer's consent given as a memo it signed in the lock transaction, which is how a phone wallet pays through a Solana Pay QR code (it signs a transaction but no separate message). Each new delegation costs one transaction read from your RPC before the lock is checked, and anyone can make the kit try one, so this spends RPC credits; the kit keeps what it read for the same transaction (up to 1,000) and remembers one not found for 5 seconds. The memo counts only for the lock its transaction made: a lock made again at the same address needs a new delegation. If the read fails the call is refused with `payment_check_unavailable` and nothing is charged. |
| `sessions.enabled` | Devnet only for now; refused on mainnet. `false` by default: session calls are refused with `sessions_not_offered` and single calls are unchanged. Set `true` to offer sessions, and watch for log lines with `"alert": true` (`session_settle_waiting`, `session_refunded_unpaid`). |
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

A lock's escrow, payer and nonce are public once it confirms, so they do not show who is calling. The buyer therefore makes a fresh session key and has its payer wallet sign, once, a delegation naming the network (by its genesis hash), the escrow, your wallet, that key and an expiry of at most seven days (`x402-session-delegation`). Every call, close and read also carries that key's signature over the network, the action, the escrow, the call number and the SHA-256 of the body (`x402-session-signature`). A call that sends `x402-session: close` is signed as `call-close` (`sessionCallAction(true)`), so a close cannot be added or removed in transit, and a signature made for one network is refused on every other. `sessionDelegationHeaderValue` and `sessionSignatureHeaderValue` in `@redditech/x402-solana` build both. A request without them, or signed by anyone else, is refused with `401` before the lock is read, and a session keeps the key it started with.

The kit then:

- checks before each call that the cost so far plus this call's worst case still fits under the lock, and refuses with `session_max_reached` when it does not;
- answers every call with a signed receipt whose `session` block carries the sequence, this call's tokens, the running totals and cost, and the hash of the previous receipt, so the buyer can check the chain (`verifyReddiReceiptV2Session` in `@redditech/agent-protocol`);
- writes the session to `sessions.file` before it answers, so a restart goes on from the last answered call;
- settles once, for the total, when the buyer sends `x402-session: close` on a call or `POST /v1/session/close`, when the lock is used up, after `sessions.idleSeconds` without a call, or before the lock's refund window opens. The closing receipt is the one with `closed: true` and a `payment` block for the amount settled.

A call number that is out of order or used before is refused with `session_sequence_invalid`, and a request signed by another key than the session started with with `session_key_mismatch`; a call the model could not answer is not counted and can be sent again with the same number. A lock used for a session cannot also pay for a single call, or the other way round. If no call was answered, closing the session declines the lock and the buyer gets it all back. `GET /v1/session/<escrow>` shows a session's totals and, once closed, its closing receipt.

The settle is signed and written to `sessions.file` before it is sent, and only that signature can count as the session's settle. If the kit cannot tell whether it landed (an RPC outage, a restart), the session stays pending and the same signed transaction is looked up and sent again on the next sweep; it is never marked settled on a guess. If the buyer has closed the account that funded the lock, the settle returns the unused part to the buyer's associated token account. When that account cannot receive either, the settle creates a new token account for the buyer at your cost (about 0.002 SOL), only within `refundAccountSubsidy.maxPerDay`. Its address comes from your key and this lock, so the buyer cannot reach it before the settle lands, and a later lock at the same escrow address gets another; once the day's bound is spent the session waits, logged as `refund_account_subsidy_spent` and `session_settle_waiting` with `"alert": true`, so you can raise the bound or settle it by hand. If the escrow is gone and no settle of yours landed (the buyer refunded once the refund window opened), the session is recorded as `refunded_unpaid` and logged as `session_refunded_unpaid` with `"alert": true`, because the calls served were not paid. A lock made again at the same address with the same nonce is a different lock and is never charged for an earlier session's calls. The kit settles ahead of the refund window to avoid all this.

The worst case of a call counts every UTF-8 byte of input as one token, which no byte-level tokenizer exceeds, so a session's total stays under its lock.

## What the kit does to protect you and your buyers

- **It refuses to start half-working**: no key, a key for another wallet, a key file others can read, a payment memory file another process holds, or mock answers on mainnet.
- **Only the payer's own call is served.** The lock is public on chain, so a paid call must also carry the payer's signature over that exact request (`x402-session-delegation` and `x402-session-signature`, action `single`; `paidCallAuthHeaders` in `@redditech/x402-solana` builds them). A call without it, or signed by anyone else, is refused with `401` before the lock is read, and the lock stays usable by its payer. Hardware wallets such as Ledger sign Solana off-chain messages with a header prefix, which this check does not accept yet; since the payer wallet must sign the delegation, a buyer paying from one is refused, so pay from a software wallet for now. Buyer clients should delegate for a day (`delegationExpiresAt()`), not the seven-day maximum, and keep the session key in memory only.
- **One lock pays for one call**, including after a restart. Accepted escrows are written to disk before the model is called.
- **It checks the cluster** before trusting any account, so a lock on another network is never taken as payment.
- **It checks that the payout can land before doing any work.** With the lock it reads your token account, the treasury's and the account the buyer funded the lock from: each must exist, be initialised, not frozen, belong to the right owner and not require a memo. If one fails, the call is refused, the lock is not used up, and the buyer can present it again once the account is fixed.
- **It creates nothing at your cost for a single call by default.** If a buyer closes its account after you accepted the lock, the settle is tried once more with the buyer's associated token account; if that cannot receive either, the settle is held and the answer withheld, unless you opted in to `refundAccountSubsidy`, in which case the settle creates a new account for the buyer as above. A session's settle uses the same daily bound; see above.
- **A settle counts only under its own signature.** The kit signs the settle and records it (`pending-settles.jsonl` beside the payment memory) before sending it. If sending reports a failure, the kit looks up that signature: landed means the buyer paid and gets the answer; failed or expired means nothing was charged by it, and the kit tries once more while the escrow is still locked. An escrow closed by anything else is never taken as paid: the answer is withheld (`escrow_closed`). If the chain cannot say, the answer is held for ten minutes (`503 settle_pending`): the buyer sends the same signed request again and gets it once the settle is known to have landed. A pending settle whose answer is no longer held is looked up by the sweep: if it landed the log says `paid_answer_lost` with `"alert": true` so you can make it right; if it cannot land the lock is declined so the buyer gets it all back.
- **Receipts state what the chain shows.** After the settle confirms, the kit reads the transaction back and signs a receipt for what actually moved: your credit plus the treasury's fee as the amount, and the model's token counts separately. If the transaction cannot be read back, or the amounts do not add up, the buyer still gets the answer it paid for, the response says `"confirmed": false`, and no receipt is signed.
- **Your key signs two things only**: settle (or decline) transactions for escrows payable to you, and receipts. It is read once from the key file and is never logged or sent anywhere.
- **Run one process per payment memory file.** For several instances at once, such as a serverless host, use the Postgres stores below: every instance then shares one record of what has been paid for and settled.

## Good to know

- Single paid calls and multi-call sessions run end to end on devnet. Mainnet is coming soon; `rap-provider doctor` checks that your token account and the treasury's are ready for your currency before you take payment.
- A single-call settle that did not land is logged as `settle_failed` with the escrow's address. The lock stays open until its refund window, so you can settle it by hand in that time. (A session's settle is retried by the sweep.)
- Calls take text messages and answer in one piece; `stream: true` is refused.
- Prices are in token currencies (USDC, AUDD, PYUSD, USDG).
- The quoted estimate counts four characters as one token, and the same count is used when a model reports no usage. The minimum lock counts one token a UTF-8 byte, so dense text (CJK, emoji, digits) still pays your full price.

On the roadmap: streaming responses, SOL-priced metered calls, sessions on rated escrows, automatic retry of a single-call settle, and hardware wallet payers.

## Library use

```ts
import { createProviderHandler, parseProviderConfig, createProviderChain, FileReplayStore } from "@redditech/provider-kit";
```

`createProviderHandler(config, deps)` returns a `(Request) => Promise<Response>` you can mount in any server. The seller-side payment logic on its own is in `@redditech/x402-solana/provider`.

## Serverless hosts (Vercel and similar)

A serverless host runs many short-lived copies of your provider at once, with no disk and no long-running timer. `createServerlessProvider` keeps everything the provider remembers in Postgres, so a lock pays for one call across every copy, one request at a time settles a lock, and the model's limits count calls on all of them.

```ts
import pg from "pg";
import { createServerlessProvider } from "@redditech/provider-kit";
import file from "./humaniser.provider.json" with { type: "json" };

const created = createServerlessProvider({
  file,
  env: process.env,
  pool: new pg.Pool({ connectionString: process.env.PROVIDER_KIT_DATABASE_URL }),
  keyEnv: "HUMANISER_KEYPAIR", // the wallet keypair, a JSON array of 64 numbers
  promptEnv: "HUMANISER_PROMPT", // the private system prompt, never published
  basePath: "/humaniser", // publicUrl must end with it
});
if (!created.ok) throw new Error(created.message);
export const { handle, sweep } = created.provider;
```

- Apply the `provider_kit` migration (`supabase/migrations/20261123120000_provider_kit_state.sql` in this repository) first. No client role can read it; connect with a server-side connection string kept in your host's sensitive settings.
- Call `sweep()` every minute or so (a cron job behind a secret). It looks again at settles whose outcome was not known.
- An answer waiting for its settle to land is kept in the database for up to ten minutes, for the buyer to collect with the same request.
- Sessions and the refund-account subsidy are not offered on a serverless host yet; the provider refuses to start with them on.
- `postgresProviderStores(pool, providerId)` gives you the stores on their own, for any other host.

## License

MIT
