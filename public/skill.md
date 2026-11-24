---
name: reddi-agent-protocol-buyer
description: Pay AI inference providers on Solana through Reddi Agent Protocol. Find a provider, get a per-token quote, lock the most a call can cost in escrow, make the call, and check the signed receipt. Use when a task needs a paid model or specialist and the person has set a budget.
---

# Use Reddi Agent Protocol as a buying agent

Reddi Agent Protocol (RAP) lets an agent pay an inference provider per token on Solana and get back a receipt it can check. The provider names a price per million tokens. You lock the most one call can cost in an escrow. After the answer, the provider settles what was actually used, the protocol fee comes out of the provider's share, and the rest of your lock comes back to the wallet that paid.

Ask your person to try one call by hand first at https://app.agent-protocol.reddi.tech/try. It takes a minute, and afterwards you both know what a payment and a receipt look like.

## Rules you always follow

1. **Never spend without a budget from your person.** Ask for a per-call maximum and a total, in SOL or USDC, before your first paid call. Keep a running total and stop when it is reached.
2. **Quote before you pay.** The first request to a provider comes back as HTTP 402 with the price. Show your person the estimate and the maximum the first time, and whenever a call would cost more than they said is fine without asking.
3. **Devnet until told otherwise.** Use `solana-devnet` unless your person says to use mainnet. Refuse an offer whose `network` is not the one you were told.
4. **Keys stay out of chat and out of files you write.** Read the wallet's keypair from the path your person gives you. Never print, copy or commit it.
5. **Check every receipt.** A call is done when the receipt verifies. If it does not, tell your person and do not pay that provider again until they say so.

## Set up

```bash
npm install @redditech/x402-solana @redditech/agent-protocol @solana/web3.js
```

Ask your person for:

- `BUYER_KEYPAIR_PATH`: a keypair file for a wallet that holds only what you may spend.
- `SOLANA_RPC_URL`: optional. Defaults to `https://api.devnet.solana.com`.
- Your budget: the most per call, and the most in total.

## Find a provider

`GET https://app.agent-protocol.reddi.tech/api/listings` returns the listed providers on the app's network with their per-token prices. Pick by task, price and track record. If it answers `503`, the directory is briefly unavailable: wait and try again, or practise in the sandbox (below) meanwhile. Each provider takes OpenAI-style requests at `POST <provider url>/v1/chat/completions`.

## Make one paid call

1. **Ask for the price.** Send the request with no payment. A `402` reply carries a `metered` offer: `inputPerMillion`, `outputPerMillion`, `currency`, `estimatedCost`, `suggestedMaxCharge` (twice the estimate), `payTo`, `escrowProgramId`, `mint` and `network`.
2. **Check it against your budget.** If `suggestedMaxCharge` is above your per-call maximum, or the network is wrong, stop and ask.
3. **Lock the maximum.** Build the lock with `buildLockTokenEscrowInstruction({ ..., metered: true })` from `@redditech/x402-solana`, sign it with the buyer wallet and wait until it confirms.
4. **Call again with the lock.** Send the same body with these headers:
   - `x402-payment`: `meteredPaymentHeaderValue({ payer, nonce, programId })`
   - the two headers from `paidCallAuthHeaders({ escrow, provider, body, payer, signWithPayer })`. They prove the call comes from the wallet that locked, and they cover the exact body bytes, so send the body exactly as you signed it.
5. **Read the answer and the settlement.** A `200` carries the answer and `reddi.metered`: tokens used, amount charged, fee, provider share, refund and the settle transaction.
6. **Verify the receipt.** Decode the `x-reddi-provider-receipt` header (base64url JSON) and check it with `verifyReddiReceiptV2` from `@redditech/agent-protocol/receipt-v2`, passing the SHA-256 of the request body and of the response body you received.

A complete worked example lives at https://github.com/nissan/reddi-agent-protocol/blob/main/packages/provider-kit/examples/paid-call.mjs.

## Practise in the sandbox first

The sandbox runs scripted providers on devnet, so you can rehearse the whole loop without a wallet. It speaks a simpler dialect than a live provider, so do not apply the live steps above to it word for word.

1. **Find a provider.** `GET https://app.agent-protocol.reddi.tech/api/sandbox/v1/models` lists each provider's model `id`, per-token pricing, `payTo` and `rap.receiptProviderId`, the key its receipts are signed with.
2. **Ask for the price.** `POST https://app.agent-protocol.reddi.tech/api/sandbox/v1/chat/completions` with `{"model": "<id>", "messages": [...]}` and no payment. The `402` carries the offer as `x402` in the body and in the `x402-request` header: `amount` is the most the call can cost, in SOL, and `nonce` names this quote. `sandbox` in the body lists the ways you can pay.
3. **Pay with a simulated payment.** Send the same body again with the header `x402-payment: demo:<nonce>`. Nothing moves on chain.
4. **Check the receipt.** A simulated call returns `x-reddi-sandbox-simulated-receipt`, base64url JSON of `{receipt, proof}`. It names no transaction, so no `reddi.receipt.v2` verifier accepts it, and that is deliberate. Check it yourself:
   - `receipt.requestHash` is the SHA-256 (hex) of the exact request body bytes you sent, and `receipt.responseHash` the SHA-256 of the response body bytes.
   - `receipt.providerId` equals that provider's `rap.receiptProviderId` from the models list.
   - `proof.signature` (base64) is an Ed25519 signature by `receipt.providerId` (base58 public key) over the `receipt` object as compact JSON, keys in the order they arrived (`JSON.stringify(decoded.receipt)`).
   - `receipt.payment.amount` (lamports, 1 SOL = 1,000,000,000) is no more than the quoted `amount`, and `amount` plus `metered.refunded` equals `metered.maxAmount`.

A paid sandbox call (a devnet transfer or a metered escrow lock, described in the `402` body) returns `x-reddi-provider-receipt` instead, a `reddi.receipt.v2` that `verifyReddiReceiptV2` checks, as on a live provider.

## Many calls to one provider

Lock once and make many calls as a session: the provider settles once at the end, so network fees stop eating small calls. See `examples/session-call.mjs` next to the single-call example. Each call is still held to its own maximum.

## When something fails

- `401 session_auth_*`: the auth headers are missing, expired, or the body changed after signing. Sign again over the exact body.
- `402` after you locked: the lock has not confirmed yet, or it pays another provider. Wait a few seconds and send the same request again.
- `409` or `duplicate_nonce`: that lock already paid for a call. Lock a new one.
- The provider stops answering: nothing is taken until it settles. After the refund window opens, your wallet can take the whole lock back.

## Paying from an agent pass

If you cannot hold a keypair, your person can give you an agent pass instead. They make it at https://app.agent-protocol.reddi.tech/pass: they pick providers and a budget for each, lock it with one Solana Pay signature, and give you a base URL and an API key starting `rap_pass_`. A pass runs on devnet for 24 hours.

- `POST <base URL>/chat/completions` with `Authorization: Bearer <key>` and an OpenAI-style body whose `model` is one the pass names. The answer carries `rap_pass`: `callCostLamports`, `spentLamports`, `leftLamports`, `expiresAt` and the provider's signed `receipt`.
- `GET <base URL>/models` lists the pass's models with what is left on each.
- A refusal (`budget_reached`, `over_call_cap`, `pass_expired`, `pass_closed`) costs nothing. Stop and tell your person.
- Treat the key like a password. Anyone holding it can spend the pass up to its budget, and only with the providers it names.

More: https://agent-protocol.reddi.tech and https://app.agent-protocol.reddi.tech/agent-setup
