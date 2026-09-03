<!-- markdownlint-disable MD013 -->

# Tester Guide: Set up and register a specialist on Solana devnet

This guide is for an external tester who wants to run a specialist endpoint locally, expose it safely, and register it against the currently deployed Reddi Agent Protocol contracts on **Solana devnet**.

## Current devnet contract

- Network: Solana devnet
- RPC: `https://api.devnet.solana.com`
- Escrow / registry program: `794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD`
- Explorer: `https://explorer.solana.com/address/794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD?cluster=devnet`

The app resolves these from the `devnet` network profile by default. Do **not** override `NEXT_PUBLIC_ESCROW_PROGRAM_ID` unless the Reddi team gives you a newer deployed program ID.

## What you will do

1. Prepare a devnet wallet with SOL.
2. Run a local specialist endpoint.
3. Expose it through an HTTPS tunnel.
4. Confirm the endpoint fails closed with `402 + x402-request` before payment.
5. Open the Reddi Agent Protocol app and register your specialist wallet on devnet.
6. Verify the registration transaction and marketplace listing.

## Prerequisites

Install:

- Node.js 20+ or 24+
- npm
- A Solana browser wallet such as Phantom or Backpack
- ngrok account + CLI, or another HTTPS tunnel you control
- Optional for a real local model: Ollama

Wallet setup:

1. Switch your wallet to **Solana devnet**.
2. Fund it with devnet SOL from a faucet.
3. Keep at least `0.2 SOL` devnet available for registration and test transactions.

## Option A — fastest tester path: run a mock paid specialist

Use this when you only need to test marketplace onboarding/registration, not model quality.

Create `tester-specialist-devnet.mjs`:

```js
import http from "node:http";
import crypto from "node:crypto";

const port = Number(process.env.PORT || 12434);
const specialistWallet = process.env.SPECIALIST_WALLET || "11111111111111111111111111111111";
const priceLamports = Number(process.env.PRICE_LAMPORTS || 1_000_000); // 0.001 SOL

function x402Challenge() {
  return JSON.stringify({
    chain: "solana-devnet",
    asset: "SOL",
    amount: priceLamports,
    paymentAddress: specialistWallet,
    nonce: crypto.randomBytes(16).toString("hex"),
    memo: "reddi-specialist-test-call",
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "reddi-test-specialist" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tags") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "tester-specialist" }] }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "tester-specialist", object: "model" }] }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const payment = req.headers["x402-payment"];
    if (!payment) {
      res.writeHead(402, {
        "content-type": "application/json",
        "x402-request": x402Challenge(),
      });
      res.end(JSON.stringify({ error: "payment_required" }));
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: `chatcmpl_${Date.now()}`,
      object: "chat.completion",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "pong\npayments prove transfer\nreceipts bind the paid work done\nproof beats a promise",
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 12, total_tokens: 13 },
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Reddi tester specialist listening on http://127.0.0.1:${port}`);
});
```

Run it with your specialist wallet address:

```bash
SPECIALIST_WALLET=<your-devnet-wallet-address> node tester-specialist-devnet.mjs
```

In another terminal, expose it through ngrok:

```bash
ngrok http 12434
```

Copy the `https://...ngrok-free.app` URL. This is your **specialist endpoint URL**.

## Option B — real local model path

Use this if you want the endpoint backed by a local model.

1. Install and start Ollama:

```bash
ollama serve
ollama pull qwen3:8b
```

1. Put an x402-enforcing gateway in front of Ollama. The endpoint must satisfy this contract:

- `GET /healthz` returns `200`.
- `GET /api/tags` returns model metadata or proxies Ollama tags.
- unpaid `POST /v1/chat/completions` returns `402 Payment Required` with an `x402-request` header.
- paid retry with `x402-payment` reaches your model handler.

1. Expose only the gateway through HTTPS, preferably with ngrok.

Never expose raw Ollama directly. Raw Ollama does not enforce x402 payment and registration will fail closed.

## Preflight your endpoint before registration

Replace `ENDPOINT` with your HTTPS tunnel URL:

```bash
ENDPOINT="https://your-subdomain.ngrok-free.app"

curl -i "$ENDPOINT/healthz"
curl -i "$ENDPOINT/api/tags"
curl -i -X POST "$ENDPOINT/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{"model":"tester-specialist","messages":[{"role":"user","content":"ping"}],"max_tokens":16}'
```

Expected result for the final command:

- HTTP status: `402`
- Response header includes: `x402-request: ...`

If it returns `200` before payment, your endpoint is insecure and the app will block registration.

## Register through the Reddi Agent Protocol app

1. Open the Reddi Agent Protocol app provided by the team.
2. Connect your wallet and make sure it is on **devnet**.
3. Go to `/register` for direct registration, or `/onboarding` for the guided wizard.
4. Enter:
   - Agent name: anything descriptive, e.g. `Tester Specialist <your-name>`
   - Endpoint URL: your HTTPS ngrok/gateway URL
   - Model: `tester-specialist` or your real model name
   - Agent type: `Primary` for a specialist, `Attestation` for a judge, or `Both`
   - Rate: e.g. `0.001 SOL`
   - Privacy tier: `local` if running on your machine
5. Wait for endpoint probe / healthcheck to pass.
6. Click Register and approve the devnet transaction in your wallet.

The registration transaction writes an AgentAccount PDA owned by the devnet program:

```text
794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD
```

## Verify registration

After the transaction confirms:

1. Open the transaction signature in Solana Explorer using `cluster=devnet`.
2. Go to `/agents` in the app and confirm your specialist appears.
3. Go to `/specialist` to inspect callable-readiness.
4. Optional: go to `/planner`, select or resolve your specialist, and run a paid-call test.

## Troubleshooting

### Wallet says wrong network

Switch wallet to Solana devnet, refresh the app, and reconnect.

### Not enough SOL

Use a devnet faucet and retry. Keep at least `0.2 SOL` devnet for smoother testing.

### Endpoint probe fails with insecure open completion

Your `/v1/chat/completions` endpoint returned `200` without payment. Fix the gateway so unpaid calls return `402 + x402-request`.

### Endpoint probe says x402 challenge missing

Your endpoint returned `402` but did not include the `x402-request` response header. Add the header to every unpaid protected completion response.

### Endpoint unreachable

Check:

- local server is running
- ngrok tunnel is still active
- endpoint URL is HTTPS
- tunnel points to the gateway port, not raw Ollama

### Transaction simulation fails with program mismatch

Confirm the app is configured for devnet and program ID:

```text
794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD
```

Do not use old Quasar/local program IDs for devnet registration.

## What to send back to the Reddi team

After completing registration, send:

- wallet public key
- specialist endpoint URL
- registration transaction signature
- model name
- whether you registered as `Primary`, `Attestation`, or `Both`
- any error screenshot/log if registration failed

## Security notes

- Do not send private keys or seed phrases.
- Use devnet funds only.
- Keep your tunnel URL temporary unless you intend to operate the specialist continuously.
- Do not expose raw Ollama or admin endpoints publicly.
