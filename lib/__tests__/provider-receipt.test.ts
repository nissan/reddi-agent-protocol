/** @jest-environment node */
jest.mock("server-only", () => ({}));

import { generateKeyPairSync, sign as edSign } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { REDDI_RECEIPT_V2_VERSION, hashReddiReceiptV2Body, signReddiReceiptV2, type ReddiReceiptV2 } from "@reddi/agent-protocol/receipt-v2";

import { checkAndStoreProviderReceipt, parseProviderReceiptHeader } from "@/lib/jobs/provider-receipt";

const JOB_ID = "0b0b0b0b-1111-4222-8333-444444444444";
const TX = "5".repeat(88);
const REQUEST = '{"model":"llama3.1:8b","messages":[{"role":"user","content":"hi"}]}';
const RESPONSE = '{"choices":[{"message":{"content":"hello"}}]}';
const URL_BASE = "https://example.supabase.co";
// Throwaway addresses for the test only.
const MINT = new PublicKey(Buffer.alloc(32, 4)).toBase58();
const TREASURY = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const PAYER = new PublicKey(Buffer.alloc(32, 2)).toBase58();
/** A 1.000000 USDC call with the 0.05% fee. */
const PAYMENT = { network: "solana-devnet", txSignature: TX, currency: "USDC", mint: MINT, amount: "1000000", fee: { amount: "500", treasury: TREASURY }, payer: PAYER, settlement: "direct" } as const;
const PAID = { currency: "USDC", mint: MINT, amountBaseUnits: "1000000", payer: PAYER, fee: { amount: "500", treasury: TREASURY } };

// Throwaway keys generated per run. Never a real wallet.
function testProvider() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: new PublicKey(raw).toBase58(), signer: (message: Uint8Array) => edSign(null, message, privateKey) };
}

async function headerFor(provider: ReturnType<typeof testProvider>, overrides: Partial<ReddiReceiptV2> = {}): Promise<string> {
  const signed = await signReddiReceiptV2(
    {
      schemaVersion: REDDI_RECEIPT_V2_VERSION,
      providerId: provider.address,
      declaredModel: "llama3.1:8b",
      requestHash: hashReddiReceiptV2Body(REQUEST),
      responseHash: hashReddiReceiptV2Body(RESPONSE),
      payment: PAYMENT,
      issuedAt: "2026-11-20T09:00:00Z",
      ...overrides,
    },
    provider.signer,
  );
  return Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
}

function store(status = 201) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fetchImpl = jest.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: status >= 200 && status < 300, status };
  });
  return { calls, deps: { url: URL_BASE, serviceKey: "service-key-for-test", fetchImpl } };
}

function inputFor(provider: ReturnType<typeof testProvider>, headerValue: string | null) {
  return { headerValue, jobId: JOB_ID, providerWallet: provider.address, requestBody: REQUEST, responseBody: RESPONSE, network: "solana-devnet" as const, txSignature: TX, paid: PAID };
}

describe("provider receipt check and store", () => {
  it("stores a receipt that matches the call", async () => {
    const provider = testProvider();
    const { calls, deps } = store();
    const result = await checkAndStoreProviderReceipt(inputFor(provider, await headerFor(provider)), deps);
    expect(result).toEqual({ stored: true, declaredModel: "llama3.1:8b" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/receipts`);
    expect(calls[0].body.job_id).toBe(JOB_ID);
    expect(calls[0].body.schema_version).toBe(REDDI_RECEIPT_V2_VERSION);
    expect((calls[0].body.receipt as ReddiReceiptV2).providerId).toBe(provider.address);
    expect(typeof calls[0].body.provider_signature).toBe("string");
  });

  it("writes nothing when no header was sent", async () => {
    const provider = testProvider();
    const { calls, deps } = store();
    expect(await checkAndStoreProviderReceipt(inputFor(provider, null), deps)).toEqual({ stored: false, reason: "none" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["a different response body", { responseBody: RESPONSE.replace("hello", "goodbye") }, "response_hash_mismatch"],
    ["a different request body", { requestBody: REQUEST + " " }, "request_hash_mismatch"],
    ["a different payment", { txSignature: "4".repeat(88) }, "payment_mismatch"],
    ["a different network", { network: "solana-mainnet-beta" as const }, "payment_mismatch"],
    ["a different amount", { paid: { ...PAID, amountBaseUnits: "2000000" } }, "payment_mismatch"],
    ["a different currency", { paid: { ...PAID, currency: "AUDD" } }, "payment_mismatch"],
    ["a different mint", { paid: { ...PAID, mint: TREASURY } }, "payment_mismatch"],
    ["SOL when the receipt names a token", { paid: { ...PAID, currency: "SOL", mint: undefined } }, "payment_mismatch"],
    ["a different fee", { paid: { ...PAID, fee: { amount: "499", treasury: TREASURY } } }, "payment_mismatch"],
    ["a different fee treasury", { paid: { ...PAID, fee: { amount: "500", treasury: PAYER } } }, "payment_mismatch"],
    ["a different payer", { paid: { ...PAID, payer: TREASURY } }, "payment_mismatch"],
  ])("refuses a receipt for %s", async (_label, change, reason) => {
    const provider = testProvider();
    const { calls, deps } = store();
    const result = await checkAndStoreProviderReceipt({ ...inputFor(provider, await headerFor(provider)), ...change }, deps);
    expect(result).toEqual({ stored: false, reason });
    expect(calls).toHaveLength(0);
  });

  it("stores a receipt that states no payer, and refuses one that names another job", async () => {
    const provider = testProvider();
    const { payer: _payer, ...withoutPayer } = PAYMENT;
    const first = store();
    expect((await checkAndStoreProviderReceipt(inputFor(provider, await headerFor(provider, { payment: withoutPayer })), first.deps)).stored).toBe(true);
    const second = store();
    expect(await checkAndStoreProviderReceipt(inputFor(provider, await headerFor(provider, { jobId: "another-job" })), second.deps)).toEqual({ stored: false, reason: "job_mismatch" });
    expect(second.calls).toHaveLength(0);
    const third = store();
    expect((await checkAndStoreProviderReceipt(inputFor(provider, await headerFor(provider, { jobId: JOB_ID })), third.deps)).stored).toBe(true);
  });

  it("refuses a receipt signed by a provider other than the one paid", async () => {
    const paid = testProvider();
    const other = testProvider();
    const { calls, deps } = store();
    const result = await checkAndStoreProviderReceipt(inputFor(paid, await headerFor(other)), deps);
    expect(result).toEqual({ stored: false, reason: "provider_mismatch" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a tampered receipt", async () => {
    const provider = testProvider();
    const { calls, deps } = store();
    const signed = JSON.parse(Buffer.from(await headerFor(provider), "base64url").toString("utf8"));
    signed.receipt.declaredModel = "bigger-model";
    const header = Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
    expect(await checkAndStoreProviderReceipt(inputFor(provider, header), deps)).toEqual({ stored: false, reason: "signature_invalid" });
    expect(calls).toHaveLength(0);
  });

  it("refuses unreadable and oversized headers", async () => {
    const provider = testProvider();
    const { calls, deps } = store();
    for (const header of ["not base64url!", Buffer.from("not json").toString("base64url"), "A".repeat(5000)]) {
      expect(await checkAndStoreProviderReceipt(inputFor(provider, header), deps)).toEqual({ stored: false, reason: "unreadable" });
    }
    expect(await checkAndStoreProviderReceipt(inputFor(provider, Buffer.from("{}").toString("base64url")), deps)).toEqual({ stored: false, reason: "malformed_receipt" });
    expect(calls).toHaveLength(0);
    expect(parseProviderReceiptHeader("")).toBeUndefined();
  });

  it("refuses a job id that is not one", async () => {
    const provider = testProvider();
    const { calls, deps } = store();
    expect(await checkAndStoreProviderReceipt({ ...inputFor(provider, await headerFor(provider)), jobId: "1; drop" }, deps)).toEqual({ stored: false, reason: "invalid_job" });
    expect(calls).toHaveLength(0);
  });

  it("reports a second receipt for the same job, a store failure and a missing store", async () => {
    const provider = testProvider();
    const header = await headerFor(provider);
    expect(await checkAndStoreProviderReceipt(inputFor(provider, header), store(409).deps)).toEqual({ stored: false, reason: "already_stored" });
    expect(await checkAndStoreProviderReceipt(inputFor(provider, header), store(500).deps)).toEqual({ stored: false, reason: "store_unavailable" });
    const throwing = { url: URL_BASE, serviceKey: "k", fetchImpl: jest.fn(async () => { throw new Error("down"); }) };
    expect(await checkAndStoreProviderReceipt(inputFor(provider, header), throwing)).toEqual({ stored: false, reason: "store_unavailable" });
    expect(await checkAndStoreProviderReceipt(inputFor(provider, header), { url: "", serviceKey: "" })).toEqual({ stored: false, reason: "store_unavailable" });
  });
  it("stores a metered receipt only when it states the maximum this server saw locked (#794)", async () => {
    const provider = testProvider();
    const metered = { ...PAYMENT, settlement: "metered-escrow" as const, metered: { inputTokens: "100", outputTokens: "200", maxAmount: "2000000", refunded: "1000000" } };
    const header = await headerFor(provider, { payment: metered });
    const ok = store();
    expect(await checkAndStoreProviderReceipt({ ...inputFor(provider, header), settlement: { kind: "metered-escrow", maxAmountBaseUnits: "2000000" } }, ok.deps)).toMatchObject({ stored: true });
    const wrongMax = store();
    expect(await checkAndStoreProviderReceipt({ ...inputFor(provider, header), settlement: { kind: "metered-escrow", maxAmountBaseUnits: "3000000" } }, wrongMax.deps)).toEqual({ stored: false, reason: "payment_mismatch" });
    // A metered receipt is not accepted for a direct payment.
    const direct = store();
    expect((await checkAndStoreProviderReceipt(inputFor(provider, header), direct.deps)).stored).toBe(false);
    expect(wrongMax.calls).toHaveLength(0);
    expect(direct.calls).toHaveLength(0);
  });
});
