import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MockOpenRouterClient } from "../src/openrouter.js";
import { getProfile } from "../src/profiles/index.js";
import {
  PROVIDER_RECEIPT_EXTENSION_VERSION,
  PROVIDER_RECEIPT_HEADER,
  buildProviderReceiptHeader,
  handleRuntimeRequest,
  type ProviderReceiptStatement,
  type RuntimeConfig,
} from "../src/index.js";

const TX = "5".repeat(88);
const REQUEST = '{"messages":[{"role":"user","content":"hi"}]}';
const RESPONSE = '{"choices":[]}';
const profile = getProfile("planning-agent")!;

const realConfig: RuntimeConfig = {
  profileId: "planning-agent",
  endpointBaseUrl: "https://planning.example.test",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  mockOpenRouter: true,
  requirePayment: true,
  allowDemoPayment: false,
  allowRealPayment: true,
};

function paymentHeaders(receipt: unknown): Headers {
  return new Headers({ "x402-payment": typeof receipt === "string" ? receipt : JSON.stringify(receipt) });
}

function recordingSigner() {
  const statements: ProviderReceiptStatement[] = [];
  return { statements, sign: (statement: ProviderReceiptStatement) => { statements.push(statement); return { extension: statement, proof: { type: "ed25519", signature: "test-signature" } }; } };
}

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

test("a receipt states the provider wallet, configured model, body hashes and the payment transaction", async () => {
  const signer = recordingSigner();
  const header = await buildProviderReceiptHeader({
    headers: paymentHeaders({ signature: TX, nonce: "n-1" }),
    config: realConfig,
    profile,
    requestText: REQUEST,
    responseText: RESPONSE,
    deps: { signProviderReceipt: signer.sign, now: () => new Date("2026-11-20T09:00:00Z") },
  });
  assert.ok(header);
  assert.match(header, /^[A-Za-z0-9_-]+$/);
  const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  assert.deepEqual(decoded.extension, {
    schemaVersion: PROVIDER_RECEIPT_EXTENSION_VERSION,
    providerId: profile.walletAddress,
    declaredModel: profile.model,
    requestHash: sha(REQUEST),
    responseHash: sha(RESPONSE),
    payment: { network: "solana-devnet", txSignature: TX },
    issuedAt: "2026-11-20T09:00:00.000Z",
  });
  assert.equal(signer.statements.length, 1);
});

test("no receipt without a signer", async () => {
  const header = await buildProviderReceiptHeader({ headers: paymentHeaders({ signature: TX }), config: realConfig, profile, requestText: REQUEST, responseText: RESPONSE, deps: {} });
  assert.equal(header, undefined);
});

test("no receipt whenever a demo payment could have been accepted, or payment is not real or not required", async () => {
  for (const change of [{ allowDemoPayment: true }, { allowRealPayment: false }, { requirePayment: false }]) {
    const signer = recordingSigner();
    const header = await buildProviderReceiptHeader({
      headers: paymentHeaders({ signature: TX }),
      config: { ...realConfig, ...change },
      profile,
      requestText: REQUEST,
      responseText: RESPONSE,
      deps: { signProviderReceipt: signer.sign },
    });
    assert.equal(header, undefined, JSON.stringify(change));
    assert.equal(signer.statements.length, 0);
  }
});

test("no receipt when the payment header carries no transaction signature", async () => {
  for (const headers of [new Headers(), paymentHeaders("demo:abc"), paymentHeaders({ nonce: "n" }), paymentHeaders({ signature: "short" }), paymentHeaders({ signature: "0OIl".repeat(20) })]) {
    const signer = recordingSigner();
    const header = await buildProviderReceiptHeader({ headers, config: realConfig, profile, requestText: REQUEST, responseText: RESPONSE, deps: { signProviderReceipt: signer.sign } });
    assert.equal(header, undefined);
    assert.equal(signer.statements.length, 0);
  }
});

test("a failing, empty or oversized signer result yields no receipt", async () => {
  const base = { headers: paymentHeaders({ txSignature: TX }), config: realConfig, profile, requestText: REQUEST, responseText: RESPONSE };
  assert.equal(await buildProviderReceiptHeader({ ...base, deps: { signProviderReceipt: () => { throw new Error("key unavailable"); } } }), undefined);
  assert.equal(await buildProviderReceiptHeader({ ...base, deps: { signProviderReceipt: () => undefined } }), undefined);
  assert.equal(await buildProviderReceiptHeader({ ...base, deps: { signProviderReceipt: () => ({ padding: "x".repeat(5000) }) } }), undefined);
});

test("a demo-paid call is answered with no receipt header, and the body is unchanged by a signer", async () => {
  const demoConfig: RuntimeConfig = { ...realConfig, allowDemoPayment: true, allowRealPayment: false };
  const signer = recordingSigner();
  const call = (nonce: string, deps: Parameters<typeof handleRuntimeRequest>[3]) =>
    handleRuntimeRequest(
      new Request("https://planning.example.test/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x402-payment": `demo:${nonce}` }, body: REQUEST }),
      demoConfig,
      new MockOpenRouterClient(),
      deps,
    );
  const withSigner = await call("receipt-a", { signProviderReceipt: signer.sign });
  assert.equal(withSigner.status, 200);
  assert.equal(withSigner.headers.get(PROVIDER_RECEIPT_HEADER), null);
  assert.equal(signer.statements.length, 0);
  const body = (await withSigner.json()) as { reddi: { profileId: string } };
  assert.equal(body.reddi.profileId, "planning-agent");
});

test("an unreadable request body is still handled as an empty request", async () => {
  const response = await handleRuntimeRequest(
    new Request("https://planning.example.test/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" }),
    realConfig,
    new MockOpenRouterClient(),
  );
  assert.equal(response.status, 402);
});
