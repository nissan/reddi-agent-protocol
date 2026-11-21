import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { createPrivateKey, sign as edSign } from "node:crypto";
import { directPaymentProofHeaders, PAYMENT_PROOF_HEADER } from "@redditech/x402-solana";
import { MockOpenRouterClient } from "../src/openrouter.js";
import { getProfile } from "../src/profiles/index.js";
import { handleRuntimeRequest, type RuntimeConfig } from "../src/index.js";

// A direct USDC payment presented to the runtime, checked against a fake RPC.
const MINT = Keypair.generate().publicKey.toBase58();
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const profile = getProfile("planning-agent")!;
const buyer = Keypair.generate();
const stranger = Keypair.generate();
const TX = "5".repeat(88);

function parsedTransaction() {
  const keys = [buyer.publicKey.toBase58(), Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58(), MINT, TOKEN_PROGRAM];
  return {
    slot: 1,
    blockTime: Math.floor(Date.now() / 1000),
    version: "legacy",
    meta: {
      err: null, fee: 5000, preBalances: [0, 0, 0, 0, 0], postBalances: [0, 0, 0, 0, 0], innerInstructions: [], logMessages: [],
      preTokenBalances: [],
      postTokenBalances: [{ accountIndex: 2, mint: MINT, owner: profile.walletAddress, programId: TOKEN_PROGRAM, uiTokenAmount: { amount: "30000", decimals: 6, uiAmount: 0.03, uiAmountString: "0.03" } }],
    },
    transaction: {
      signatures: [TX],
      message: {
        accountKeys: keys.map((pubkey, i) => ({ pubkey, signer: i === 0, writable: i < 3, source: "transaction" })),
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [{
          program: "spl-token", programId: TOKEN_PROGRAM, stackHeight: null,
          parsed: { type: "transferChecked", info: { authority: buyer.publicKey.toBase58(), source: keys[1], destination: keys[2], mint: MINT, tokenAmount: { amount: "30000", decimals: 6, uiAmount: 0.03, uiAmountString: "0.03" } } },
        }],
      },
    },
  };
}

async function fakeRpc() {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const call = JSON.parse(raw);
      const result = call.method === "getTransaction" ? parsedTransaction() : null;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const sign = (k: Keypair) => (m: Uint8Array) =>
  new Uint8Array(edSign(null, Buffer.from(m), createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(k.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" })));

test("a direct payment is served only to a request signed by the wallet that paid, over the exact body", async () => {
  const rpc = await fakeRpc();
  try {
    const config: RuntimeConfig = {
      profileId: "planning-agent",
      endpointBaseUrl: "https://planning.example.test",
      openRouterBaseUrl: "https://openrouter.ai/api/v1",
      mockOpenRouter: true,
      requirePayment: true,
      allowDemoPayment: false,
      allowRealPayment: true,
      usdcDevnetMint: MINT,
      solanaRpcUrl: rpc.url,
    };
    const body = JSON.stringify({ messages: [{ role: "user", content: "plan my week" }] });
    const receipt = JSON.stringify({ network: "solana-devnet", payTo: profile.walletAddress, amount: profile.price.amount, currency: "USDC", nonce: "proof-1", payer: buyer.publicKey.toBase58(), signature: TX });
    const replayStore = (() => { const seen = new Set<string>(); return { checkAndStore: (k: string) => (seen.has(k) ? false : (seen.add(k), true)) }; })();
    const call = (extra: Record<string, string>, text = body) => handleRuntimeRequest(
      new Request("https://planning.example.test/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x402-payment": receipt, ...extra }, body: text }),
      config, new MockOpenRouterClient(), { replayStore },
    );
    const proof = (k: Keypair) => directPaymentProofHeaders({ network: "solana-devnet", txSignature: TX, payTo: profile.walletAddress, body, sign: sign(k) });

    const unsigned = await call({});
    assert.equal(unsigned.status, 402);
    const u = await unsigned.json();
    assert.equal(u.error.code, "payer_proof_required", JSON.stringify(u.error));
    const stolen = await call(await proof(stranger));
    assert.equal((await stolen.json()).error.code, "payer_proof_invalid");
    const changed = await call(await proof(buyer), body.replace("week", "month"));
    assert.equal((await changed.json()).error.code, "payer_proof_invalid");
    // None of the refusals used the payment up: the payer is served.
    const own = await call(await proof(buyer));
    assert.equal(own.status, 200, JSON.stringify(await own.clone().json()));
    const again = await call(await proof(buyer));
    assert.equal((await again.json()).error.code, "duplicate_nonce");
    assert.ok(PAYMENT_PROOF_HEADER);
  } finally {
    await rpc.close();
  }
});
