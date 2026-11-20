# Devnet sandbox

`/sandbox` lets a visitor run the receipted inference flow end to end without installing anything:
send an OpenAI-style request, receive a 402 payment challenge, pay it, get the answer with a
receipt, check the receipt in the browser, and watch a reputation score move.

It is a teaching surface on Solana devnet. It is not the V1 gateway (issue 739) and makes no
claim about mainnet, live models, or settlement.

## What is real and what is simulated

| Part | In the sandbox |
|---|---|
| HTTP flow | Real. `POST /api/sandbox/v1/chat/completions` answers 402 with an x402 challenge, then 200 once a payment is presented. It works from curl. |
| Challenge and payment checks | Real code from `packages/x402-solana`: `buildX402Challenge`, `verifyDemoPaymentReceipt`, and `SolanaReceiptVerifier` with the devnet genesis-hash check and a 900 second age limit. |
| Simulated payment | No transaction. The call returns a sandbox simulated receipt (`reddi.sandbox.simulated-receipt.v1`) in the `x-reddi-sandbox-simulated-receipt` header: the v2 field layout without `payment.txSignature`, signed over its own version string. Every `reddi.receipt.v2` validator refuses it, and the page says it is not a v2 receipt. |
| Wallet payment | A real devnet SOL transfer the visitor's own wallet signs, to a public devnet wallet from `lib/economic-demo/openrouter-endpoints.ts`. The server only reads it back from devnet. |
| Provider answers | Scripted in `lib/sandbox/catalog.ts`. No model runs, so every model id starts with `sandbox/` and each receipt carries `scripted: true`. |
| Receipt | A call paid with a devnet transfer returns a signed `reddi.receipt.v2` receipt in the `x-reddi-provider-receipt` header (base64url JSON), the header and format a V1 provider uses. It names the provider address, the declared model, the SHA-256 of the request and response body bytes, and the payment: transaction, SOL, the price in lamports, a zero fee, the payer and `direct`. `verifyReddiReceiptV2` from `packages/agent-protocol` accepts it; the gateway tests hold the browser check and the package verifier together. |
| Provider signing keys | Public test keys derived from a fixed label (`lib/sandbox/keys.ts`). Anyone can recompute them. They hold no funds and control nothing. A receipt's `providerId` is the base58 address of that test key, listed as `receiptProviderId` by `/models`; it is not the wallet that is paid. A real provider signs with its own wallet key. |
| Spot check and reputation | Simulated. The outcome is fixed per provider and the score lives in the visitor's browser tab. Nothing is written to a chain or a database. |
| Replay memory | Held in one server instance. A reused payment is refused while that instance lives; V1 uses the durable store. |

## Safety limits

- Devnet only, whatever network profile the app runs with. The gateway requires the RPC endpoint
  to report the devnet genesis hash before it accepts a transfer, and the page builds transfers
  on a devnet blockhash, so a signed transfer cannot land on another cluster.
- The server holds no wallet and submits no transaction.
- The page asks a wallet to sign only the catalog's own price to the catalog's own payee
  (at most 0.002 devnet SOL), and refuses a challenge that differs from the catalog.
- An offline provider is refused before any challenge is issued, so nothing is paid.
- A devnet transfer is matched on payer, payee, amount and age, not on the challenge nonce, so a
  third party who sees a fresh transfer could present it first. With test funds that costs a
  visitor nothing but a retry; binding a payment to its challenge is V1 work (issue 738).
- There is no rate limit beyond the request caps. The endpoint runs no model and spends nothing.
- Requests are capped at 16 messages and 8,000 characters; streaming is refused.

`SANDBOX_DEVNET_RPC_URL` optionally points the server at another devnet RPC endpoint. An
endpoint that is not devnet is refused by the genesis-hash check.

`NEXT_PUBLIC_MARKETING_ORIGIN` (build time, https only) adds a "Get launch updates" button that
links to the marketing site's signup at `<origin>/#updates`. Unset, the button is not shown.

## Scenarios

Deep links: `/sandbox?scenario=<id>`.

| Id | What it shows |
|---|---|
| `buy-a-review` | The basic paid call and its receipt. |
| `shop-around` | Three providers at three prices; the cheapest fails the simulated spot check and its score drops. |
| `try-to-cheat` | Underpaying, paying the wrong wallet, reusing a payment, and editing the answer are each caught. |
| `provider-offline` | A listed provider that is not answering: no challenge, no payment, no receipt. |

## From a terminal

```bash
BASE=https://<host>/api/sandbox/v1
BODY='{"model":"sandbox/swift-coder-small","messages":[{"role":"user","content":"Explain exponential backoff in two sentences."}]}'

curl -s $BASE/models                                   # providers, prices, receipt provider addresses
curl -si -X POST $BASE/chat/completions -H 'content-type: application/json' -d "$BODY"   # 402 + challenge
curl -s  -X POST $BASE/chat/completions -H 'content-type: application/json' \
  -H 'x402-payment: demo:<nonce from the challenge>' -d "$BODY"                           # 200, receipt in a response header (add -i to see it)
```

## Tests

- `lib/__tests__/sandbox-gateway.test.ts`: gateway, payment refusals, devnet verification against a
  stubbed RPC, and receipt verification including forged and edited receipts. The devnet-transfer
  receipt is held to `verifyReddiReceiptV2` from `packages/agent-protocol`, with every tampered form
  refused by both checks; the simulated receipt is shown to fail every v2 validator.
- `e2e/sandbox.spec.ts`: the four scenarios through the simulated lane, with the public-claim
  pattern list applied to the rendered copy at each stage.

The wallet lane needs a browser wallet on devnet and is checked by hand.
