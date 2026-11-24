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
| Wallet payment | Metered escrow when the server holds the provider's devnet key: the visitor's wallet locks the challenge's maximum with `lock_metered_escrow` on the devnet escrow program (`config/networks/devnet.json`), nonce = the challenge nonce, and presents `{ settlement: "metered-escrow", payer, escrow, nonce }`. The server reads the escrow back (owner, payer, payee, amount, metered, locked, nonce), answers, and settles the actual tokens with `settle_escrow`, signed by the provider's devnet-only key (`lib/sandbox/settle-signer.ts`, env `SANDBOX_DEVNET_PAYEE_KEYS`). The program pays 2.5% to the protocol treasury, the rest to the provider, and returns the unused maximum and the account rent to the visitor. If the settle fails the server does not answer, and the visitor can cancel the lock for a full refund from day 3. Without the key, a direct devnet SOL transfer of the maximum to the provider, read back from devnet. |
| Studio providers | The five `make-a-video` studios and the two `write-better` writing providers are `simulatedOnly`: the gateway refuses a devnet transfer or a metered escrow for them before reading the chain, their challenge offers no devnet route, and `/models` lists them with `simulatedPaymentsOnly: true`. Their payee addresses are placeholders nobody settles from. |
| Media pricing | The studios return files, so they are priced by what they make, not by tokens (`media` in `lib/sandbox/catalog.ts`): a price per second of video or audio, a maximum length, and hosting the file for 7 days at a price per GB, all inside one quote. The metered settle works as for tokens: lock the maximum, settle what was delivered, the rest goes back, 2.5% fee on the cost. Their simulated receipts add `metered.unit` and `metered.units` and a signed `delivery` block (file name, media type, size, SHA-256, hosting expiry). Nothing is rendered, so the hash is of a stand-in text. Studios take one file per call and refuse session calls. |
| Provider answers | Scripted in `lib/sandbox/catalog.ts`. No model runs, so every model id starts with `sandbox/` and each receipt carries `scripted: true`. |
| Receipt | A call paid with a devnet transfer returns a signed `reddi.receipt.v2` receipt in the `x-reddi-provider-receipt` header (base64url JSON), the header and format a V1 provider uses. It names the provider address, the declared model, the SHA-256 of the request and response body bytes, and the payment. For a direct transfer: transaction, SOL, the maximum in lamports, a zero fee, the payer and `direct`. For a metered escrow: the settle transaction, the actual cost, the 2.5% fee and treasury, the payer, `metered-escrow` and the token counts, maximum and refund. `verifyReddiReceiptV2` from `packages/agent-protocol` accepts it; the gateway tests hold the browser check and the package verifier together. |
| Provider signing keys | Public test keys derived from a fixed label (`lib/sandbox/keys.ts`). Anyone can recompute them. They hold no funds and control nothing. A receipt's `providerId` is the base58 address of that test key, listed as `receiptProviderId` by `/models`; it is not the wallet that is paid. A real provider signs with its own wallet key. |
| Spot check and reputation | Simulated. The outcome is fixed per provider and the score lives in the visitor's browser tab. Nothing is written to a chain or a database. |
| Replay memory | Held in one server instance. A reused payment is refused while that instance lives; V1 uses the durable store. |

## Safety limits

- Devnet only, whatever network profile the app runs with. The gateway requires the RPC endpoint
  to report the devnet genesis hash before it accepts a transfer, and the page builds transfers
  on a devnet blockhash, so a signed transfer cannot land on another cluster.
- The server holds only the sandbox providers' devnet-only keys, which hold devnet SOL for network fees, and submits only `settle_escrow` for an escrow it has read back. A key whose address is not the catalog payee is ignored.
- The page asks a wallet to sign only the catalog's own price to the catalog's own payee
  (at most 0.002 devnet SOL, plus the escrow account rent that comes back on settle), and refuses a challenge that differs from the catalog.
- An offline provider is refused before any challenge is issued, so nothing is paid.
- A metered escrow is bound to its challenge: its address derives from the payer and the challenge nonce.
- A direct devnet transfer is matched on payer, payee, amount and age, not on the challenge nonce, so a
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
| `run-a-session` | Ten small calls on one simulated lock, each receipt chained and checked, one settle. |
| `make-a-video` | A director agent hires five independent studios (animation, music, guide voice, voice pass, final stitch) in turn. Each quote, simulated payment and receipt is checked, with the 2.5% fee, before the next studio is hired; the visitor rates each studio at the end. The studios are made-up independent providers who tuned their own models: the page shows what a buyer sees (listing, price, output, receipt) and what stays on their machines (weights, data, prompts). |
| `write-better` | "Help us write better": the visitor picks a voice (friendly, professional, academic), a jargon level (explain like I'm 5, like I'm 10, some jargon) and a word limit (40, 80, 150). Reddi Writing Style builds a skill file from those settings; Reddi Humaniser rewrites a sample notice with it and adds its rules for sounding like a person. Two token-priced calls, each quoted, paid (simulated) and its receipt checked with the 2.5% fee. The visitor downloads the skill and is shown how to give it to their own agent (`/agent-setup`). Both providers are first-party, `simulatedOnly`, at the per-token prices the live providers list; answers are scripted in `lib/sandbox/writing-skill.ts`. |
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
- `lib/__tests__/sandbox-pipeline.test.ts`: the `make-a-video` pipeline against the gateway, a tampered or wrongly signed receipt stopping it, and studios refusing devnet payments.
- `lib/__tests__/sandbox-writing.test.ts`: the `write-better` run against the gateway, every setting's rewrite inside its word limit, a tampered or wrongly signed receipt stopping it, and the writing providers refusing devnet payments.
- `e2e/sandbox.spec.ts`: the scenarios through the simulated lane, with the public-claim
  pattern list applied to the rendered copy at each stage.

The wallet lane needs a browser wallet on devnet and is checked by hand.
