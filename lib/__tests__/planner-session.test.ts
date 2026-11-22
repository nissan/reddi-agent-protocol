// Provider endpoints are fetched through the outbound guard, which resolves the host first.
// Test hosts resolve to a public address here; the guard itself is tested in outbound-guard.test.ts.
jest.mock("dns/promises", () => ({ lookup: jest.fn(async () => [{ address: "93.184.215.14", family: 4 }]) }));

/**
 * Planner session reuse (#863): one metered lock pays for many planner calls
 * to one provider. The wallet signs one delegation; a session key signs each
 * call over the exact body the server sends; the server forwards the call and
 * checks the provider's signed receipts; the browser's ledger checks the totals.
 */

jest.mock("server-only", () => ({}));
jest.mock("fs", () => ({
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(() => "[]"),
  writeFileSync: jest.fn(),
}));

import { generateKeyPairSync, sign as edSign, type KeyObject } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { canonicalizeReddiReceiptV2, signReddiReceiptV2, hashReddiReceiptV2Body, type ReddiReceiptV2, type ReddiReceiptV2Session } from "@redditech/agent-protocol/receipt-v2";
import { verifyPaidCallRequest, verifySessionRequest } from "@redditech/x402-solana";
import { tokenCostBaseUnits } from "@redditech/x402-solana/metered";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { address: new PublicKey(raw).toBase58(), sign: (message: Uint8Array) => new Uint8Array(edSign(null, Buffer.from(message), privateKey as KeyObject)) };
}

const mockProvider = keypair();
const payer = keypair();
const sessionKey = keypair();
const ESCROW = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const LOCK_SIG = "4".repeat(88);
const SETTLE_SIG = "6".repeat(88);
const NOW_MS = Date.UTC(2026, 10, 21, 12, 0, 0);
const PRICE = { currency: "USDC", inputPerMillion: "0.150000", outputPerMillion: "0.600000" };
const MAX_OUTPUT = 500;

jest.mock("@/lib/onboarding/planner-router", () => ({
  routePlannerPolicy: jest.fn(() => ({
    ok: true,
    selected: { walletAddress: mockProvider.address, endpointUrl: "https://specialist.example", perCallUsd: 0.01 },
    candidates: [],
    rejected: [],
  })),
}));
jest.mock("@/lib/onboarding/x402-settlement", () => ({ processX402Challenge: jest.fn() }));
jest.mock("@/lib/torque/client", () => ({ emitTorqueEvent: jest.fn() }));
// Files by default, as with no database configured; a test can switch one run to the database path.
jest.mock("@/lib/listings/listing-index", () => ({ loadListingIndex: jest.fn(async () => ({ source: "files" })) }));
jest.mock("@/lib/listings/listing-store", () => ({ readOwnListing: jest.fn(async (wallet: string) => ({ ok: true, listing: { wallet } })) }));
jest.mock("@/lib/jobs/metered-call", () => ({ verifyAndRecordMeteredCall: jest.fn(async () => ({ recorded: true, jobId: "job-1", paid: { maxAmountBaseUnits: "100000" } })) }));
jest.mock("@/lib/jobs/provider-stats", () => ({ refreshProviderStats: jest.fn(async () => ({ updated: true })) }));

import { planMeteredBuy, MAX_SESSION_CALLS } from "@/lib/payments/metered-buy";
import { applySessionClose, applySessionOutcome, attachLockReceipt, delegateLock, openPlannerSession, prepareSessionCall, prepareSessionClose, signSingleCall, type PlannerSessionHandle } from "@/lib/payments/planner-session-client";
import { loadListingIndex } from "@/lib/listings/listing-index";
import { verifyAndRecordMeteredCall } from "@/lib/jobs/metered-call";
import { plannerChatBody, plannerChatPayload } from "@/lib/onboarding/planner-payload";
import { checkSessionAnswer, parsePaidCallAuth, parsePlannerSessionClose, parsePlannerSessionRequest, SESSION_RECEIPT_HEADER, SESSION_STATE_HEADER } from "@/lib/onboarding/planner-session";

const lockReceipt = { settlement: "metered-escrow", network: "solana-devnet", currency: "USDC", payTo: mockProvider.address, payer: payer.address, nonce: "09".repeat(16), escrow: ESCROW, lockSignature: LOCK_SIG };

function response(status: number, body: string, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => body, headers: new Headers(headers) };
}

/** The provider's side: a signed receipt chain for a session on ESCROW. */
function providerChain(lockBaseUnits: bigint) {
  let sequence = 0;
  let inTotal = 0;
  let outTotal = 0;
  let cost = BigInt(0);
  let previous: string | undefined;
  const block = (call: { inputTokens: number; outputTokens: number }, closed: boolean): ReddiReceiptV2Session => ({
    escrow: ESCROW,
    payer: payer.address,
    network: "solana-devnet",
    currency: "USDC",
    mint: MINT,
    maxAmount: lockBaseUnits.toString(),
    sequence: String(sequence),
    inputTokens: String(call.inputTokens),
    outputTokens: String(call.outputTokens),
    cumulativeInputTokens: String(inTotal),
    cumulativeOutputTokens: String(outTotal),
    cumulativeCost: cost.toString(),
    ...(previous ? { previousReceiptHash: previous } : {}),
    closed,
  });
  const encode = async (receipt: ReddiReceiptV2) => {
    const signed = await signReddiReceiptV2(receipt, mockProvider.sign);
    const { hashReddiReceiptV2 } = await import("@redditech/agent-protocol/receipt-v2");
    previous = hashReddiReceiptV2(receipt);
    return Buffer.from(JSON.stringify(signed)).toString("base64url");
  };
  return {
    /** Serves one call: returns the response body and its receipt header. */
    async call(request: string, usage: { inputTokens: number; outputTokens: number }, overrides: Partial<ReddiReceiptV2Session> = {}) {
      sequence += 1;
      inTotal += usage.inputTokens;
      outTotal += usage.outputTokens;
      cost += tokenCostBaseUnits(PRICE, usage);
      const body = JSON.stringify({ choices: [{ message: { content: `answer ${sequence}` } }] });
      const header = await encode({
        schemaVersion: "reddi.receipt.v2",
        providerId: mockProvider.address,
        declaredModel: "ollama-local",
        requestHash: hashReddiReceiptV2Body(request),
        responseHash: hashReddiReceiptV2Body(body),
        session: { ...block(usage, false), ...overrides },
        issuedAt: new Date(NOW_MS).toISOString(),
      });
      return { body, header };
    },
    /** The closing receipt after the last call. */
    async close() {
      sequence += 1;
      const fee = (cost * BigInt(250)) / BigInt(10_000);
      return encode({
        schemaVersion: "reddi.receipt.v2",
        providerId: mockProvider.address,
        declaredModel: "ollama-local",
        requestHash: hashReddiReceiptV2Body(`session-close:${ESCROW}:${sequence}`),
        responseHash: hashReddiReceiptV2Body("{}"),
        payment: {
          network: "solana-devnet",
          txSignature: SETTLE_SIG,
          currency: "USDC",
          mint: MINT,
          amount: cost.toString(),
          fee: { amount: fee.toString(), treasury: new PublicKey(Buffer.alloc(32, 9)).toBase58() },
          payer: payer.address,
          settlement: "metered-escrow",
          metered: { inputTokens: String(inTotal), outputTokens: String(outTotal), maxAmount: lockBaseUnits.toString(), refunded: (lockBaseUnits - cost).toString() },
        },
        session: block({ inputTokens: 0, outputTokens: 0 }, true),
        issuedAt: new Date(NOW_MS).toISOString(),
      });
    },
    get cost() {
      return cost;
    },
  };
}

async function openSession(lockBaseUnits = BigInt(100_000)): Promise<PlannerSessionHandle> {
  const handle = await openPlannerSession({
    escrow: ESCROW,
    providerWallet: mockProvider.address,
    lockBaseUnits,
    price: PRICE,
    maxOutputTokens: MAX_OUTPUT,
    signWithPayer: payer.sign,
    sessionKey: { publicKey: sessionKey.address, sign: sessionKey.sign },
    nowMs: NOW_MS,
  });
  return attachLockReceipt(handle, lockReceipt);
}

describe("sizing a session lock", () => {
  const offer = {
    settlement: "metered-escrow",
    payTo: mockProvider.address,
    escrowProgramId: new PublicKey(Buffer.alloc(32, 3)).toBase58(),
    currency: "USDC",
    mint: MINT,
    inputPerMillion: "0.15",
    outputPerMillion: "0.6",
    maxOutputTokens: MAX_OUTPUT,
    minimumLockBaseUnits: "1",
  };
  const base = {
    offer,
    listing: { walletAddress: mockProvider.address, prices: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 } },
    network: "solana-devnet" as const,
    programId: new PublicKey(offer.escrowProgramId),
    payer: new PublicKey(payer.address),
    prompt: "summarise this paragraph for me",
    mints: { USDC: MINT },
    nonce: new Uint8Array(16).fill(1),
  };

  it("locks the per-call maximum times the calls, and tells the ledger the offered rate and output limit", () => {
    const single = planMeteredBuy(base);
    const session = planMeteredBuy({ ...base, sessionCalls: 10 });
    if (!single.ok || !session.ok) throw new Error("plan refused");
    expect(session.quote.maxChargeBaseUnits).toBe(single.quote.maxChargeBaseUnits * BigInt(10));
    expect(session.session).toEqual({
      calls: 10,
      price: { currency: "USDC", inputPerMillion: "0.15", outputPerMillion: "0.6" },
      maxOutputTokens: MAX_OUTPUT,
      lockBaseUnits: single.quote.maxChargeBaseUnits * BigInt(10),
      perCallMaxBaseUnits: single.quote.maxChargeBaseUnits,
    });
    expect(single.session).toBeUndefined();
  });

  it("refuses a rated session, a provider with no stated output limit, and out-of-range sizes", () => {
    expect(planMeteredBuy({ ...base, sessionCalls: 10, rating: {} })).toMatchObject({ ok: false, reason: "rated_session" });
    expect(planMeteredBuy({ ...base, offer: { ...offer, maxOutputTokens: undefined }, sessionCalls: 10 })).toMatchObject({ ok: false, reason: "no_output_limit" });
    expect(planMeteredBuy({ ...base, sessionCalls: 0 })).toMatchObject({ ok: false, reason: "invalid_session" });
    expect(planMeteredBuy({ ...base, sessionCalls: MAX_SESSION_CALLS + 1 })).toMatchObject({ ok: false, reason: "invalid_session" });
    expect(planMeteredBuy({ ...base, sessionCalls: 2.5 })).toMatchObject({ ok: false, reason: "invalid_session" });
  });
});

describe("signing a session call in the browser", () => {
  it("signs over the exact body the server sends, and the provider's verifier accepts it", async () => {
    const handle = await openSession();
    const prepared = await prepareSessionCall(handle, "summarise this", false);
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.request).toMatchObject({ sequence: 1, close: false, delegation: handle.delegation });
    // The server sends JSON.stringify(plannerChatPayload(prompt)); the browser signs plannerChatBody(prompt).
    expect(plannerChatBody("summarise this")).toBe(JSON.stringify(plannerChatPayload("summarise this")));
    const headers = new Headers({ "x402-session-delegation": prepared.request.delegation, "x402-session-signature": prepared.request.signature });
    const check = (body: string, sequence = 1) =>
      verifySessionRequest({ headers: { get: (n: string) => headers.get(n) }, action: "call", escrow: new PublicKey(ESCROW), payer: new PublicKey(payer.address), provider: new PublicKey(mockProvider.address), sequence, body, nowMs: NOW_MS });
    expect(check(plannerChatBody("summarise this"))).toMatchObject({ ok: true, sessionKey: sessionKey.address });
    expect(check(plannerChatBody("something else"))).toMatchObject({ ok: false, reason: "session_auth_invalid" });
    expect(check(plannerChatBody("summarise this"), 2)).toMatchObject({ ok: false, reason: "session_auth_invalid" });
  });

  it("refuses locally, before sending, a call that could take the session past its lock", async () => {
    const handle = await openSession(BigInt(10));
    const prepared = await prepareSessionCall(handle, "summarise this", false);
    expect(prepared).toMatchObject({ ok: false, reason: "session_max_reached" });
    if (prepared.ok) return;
    expect(prepared.handle.ledger.state).toBe("closing");
  });

  it("refuses a lock receipt for a different escrow", async () => {
    const handle = await openPlannerSession({ escrow: ESCROW, providerWallet: mockProvider.address, lockBaseUnits: BigInt(100), price: PRICE, maxOutputTokens: MAX_OUTPUT, signWithPayer: payer.sign, nowMs: NOW_MS });
    expect(() => attachLockReceipt(handle, { ...lockReceipt, escrow: new PublicKey(Buffer.alloc(32, 8)).toBase58() })).toThrow(/different escrow/);
  });
});

describe("the planner server forwarding a session call", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function run(input: Record<string, unknown>) {
    const { executePlannerSpecialistCall } = await import("@/lib/onboarding/planner-execution");
    return executePlannerSpecialistCall({ prompt: "summarise this", paymentMode: "wallet", preferredWallet: mockProvider.address, paymentReceipt: lockReceipt, ...input });
  }

  it("runs three calls on one lock with one settle, and the buyer's ledger accepts every receipt", async () => {
    const lock = BigInt(100_000);
    const chain = providerChain(lock);
    let handle = await openSession(lock);
    const sent: Array<Record<string, string>> = [];
    const usages = [
      { inputTokens: 40, outputTokens: 120 },
      { inputTokens: 55, outputTokens: 300 },
      { inputTokens: 12, outputTokens: 80 },
    ];
    for (let i = 0; i < usages.length; i++) {
      const last = i === usages.length - 1;
      const prepared = await prepareSessionCall(handle, "summarise this", last);
      if (!prepared.ok) throw new Error(prepared.message);
      const served = await chain.call(plannerChatBody("summarise this"), usages[i]);
      const closing = last ? await chain.close() : undefined;
      global.fetch = jest.fn(async (_url: string, init: { headers: Record<string, string> }) => {
        sent.push(init.headers);
        return response(200, served.body, { "x-reddi-provider-receipt": served.header, ...(closing ? { [SESSION_RECEIPT_HEADER]: closing, [SESSION_STATE_HEADER]: "settled" } : {}) });
      }) as unknown as typeof fetch;
      const result = await run({ session: prepared.request });
      expect(result.ok).toBe(true);
      const outcome = (result as { session?: unknown }).session as Parameters<typeof applySessionOutcome>[2];
      expect(outcome).toMatchObject({ sequence: i + 1, call: { receiptHash: expect.stringMatching(/^[0-9a-f]{64}$/) } });
      const applied = applySessionOutcome(handle, true, outcome);
      handle = applied.handle;
      if (last) {
        expect(applied.note).toMatch(/Session settled: 3 calls/);
        expect(result.result).toMatchObject({ settleTxSignature: SETTLE_SIG });
      }
    }
    expect(handle.ledger).toMatchObject({ state: "settled", costBaseUnits: chain.cost, settleSignature: SETTLE_SIG });
    // The same lock header every time, the sequence counting up, the close only on the last.
    expect(new Set(sent.map((h) => h["x402-payment"])).size).toBe(1);
    expect(sent.map((h) => h["x402-session-sequence"])).toEqual(["1", "2", "3"]);
    expect(sent.map((h) => h["x402-session"])).toEqual([undefined, undefined, "close"]);
    expect(sent.every((h) => h["x402-session-delegation"] === handle.delegation)).toBe(true);
  });

  it("never passes on a receipt signed by someone else, and the ledger stops the session", async () => {
    const handle = await openSession();
    const prepared = await prepareSessionCall(handle, "summarise this", false);
    if (!prepared.ok) throw new Error(prepared.message);
    const receipt: ReddiReceiptV2 = {
      schemaVersion: "reddi.receipt.v2",
      providerId: mockProvider.address,
      declaredModel: "ollama-local",
      requestHash: hashReddiReceiptV2Body(plannerChatBody("summarise this")),
      responseHash: hashReddiReceiptV2Body("{}"),
      session: { escrow: ESCROW, payer: payer.address, network: "solana-devnet", currency: "USDC", mint: MINT, maxAmount: "100000", sequence: "1", inputTokens: "1", outputTokens: "1", cumulativeInputTokens: "1", cumulativeOutputTokens: "1", cumulativeCost: "1", closed: false },
      issuedAt: new Date(NOW_MS).toISOString(),
    };
    // Names the provider but is signed by another key.
    const forged = { receipt, proof: { type: "ed25519", signature: Buffer.from(sessionKey.sign(Buffer.from(canonicalizeReddiReceiptV2(receipt)))).toString("base64") } };
    global.fetch = jest.fn().mockResolvedValue(response(200, "{}", { "x-reddi-provider-receipt": Buffer.from(JSON.stringify(forged)).toString("base64url") })) as unknown as typeof fetch;
    const result = await run({ session: prepared.request });
    const outcome = (result as { session?: Parameters<typeof applySessionOutcome>[2] }).session;
    expect(outcome?.call).toBeUndefined();
    expect(outcome?.problem).toBe("call receipt: signature_invalid");
    expect(applySessionOutcome(handle, true, outcome).handle.ledger.state).toBe("disputed");
  });

  it("stops the session when the provider's running total is more than the tokens cost", async () => {
    const chain = providerChain(BigInt(100_000));
    const handle = await openSession();
    const prepared = await prepareSessionCall(handle, "summarise this", false);
    if (!prepared.ok) throw new Error(prepared.message);
    const served = await chain.call(plannerChatBody("summarise this"), { inputTokens: 10, outputTokens: 10 }, { cumulativeCost: "90000" });
    global.fetch = jest.fn().mockResolvedValue(response(200, served.body, { "x-reddi-provider-receipt": served.header })) as unknown as typeof fetch;
    const result = await run({ session: prepared.request });
    const applied = applySessionOutcome(handle, true, (result as { session?: Parameters<typeof applySessionOutcome>[2] }).session);
    expect(applied.handle.ledger.state).toBe("disputed");
    expect(applied.note).toMatch(/does not match your own count/);
  });

  it("reports a provider refusal as nothing charged, and ends the session for new calls", async () => {
    const handle = await openSession();
    const prepared = await prepareSessionCall(handle, "summarise this", false);
    if (!prepared.ok) throw new Error(prepared.message);
    global.fetch = jest.fn().mockResolvedValue(response(409, JSON.stringify({ error: { code: "session_window_closing", message: "settling" } }))) as unknown as typeof fetch;
    const result = await run({ session: prepared.request });
    expect(result.ok).toBe(false);
    expect(result.result.error).toMatch(/refused session call 1 \(session_window_closing\)\. Nothing was charged/);
    const applied = applySessionOutcome(handle, false, (result as { session?: Parameters<typeof applySessionOutcome>[2] }).session);
    expect(applied.handle.ledger.state).toBe("closing");

    global.fetch = jest.fn().mockResolvedValue(response(401, JSON.stringify({ error: { code: "session_auth_invalid" } }))) as unknown as typeof fetch;
    const auth = await run({ session: prepared.request });
    expect(applySessionOutcome(handle, false, (auth as { session?: Parameters<typeof applySessionOutcome>[2] }).session).handle.ledger.state).toBe("closing");
  });

  it("records no job per session call, and refuses a session on a direct payment", async () => {
    const handle = await openSession();
    const prepared = await prepareSessionCall(handle, "summarise this", false);
    if (!prepared.ok) throw new Error(prepared.message);
    global.fetch = jest.fn().mockResolvedValue(response(200, "{}")) as unknown as typeof fetch;
    const result = await run({ session: prepared.request });
    expect(result.result.trace).toEqual(expect.arrayContaining(["job:not_recorded:session_call", "session:receipt_not_checked:call receipt: none"]));

    global.fetch = jest.fn() as unknown as typeof fetch;
    const direct = await run({ session: prepared.request, paymentReceipt: { network: "solana-devnet", payTo: mockProvider.address, amount: "0.002", currency: "SOL", nonce: "n-1", signature: LOCK_SIG } });
    expect(direct.result.error).toMatch(/Only a metered escrow lock/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("reading the session field of a planner request", () => {
  const good = { sequence: 2, close: true, delegation: "ZGVsZWdhdGlvbg==", signature: "c2lnbmF0dXJl" };
  it("takes a well-formed request and leaves an absent one out", () => {
    expect(parsePlannerSessionRequest(good)).toEqual(good);
    expect(parsePlannerSessionRequest(undefined)).toBeUndefined();
  });
  it.each([
    ["a zero sequence", { ...good, sequence: 0 }],
    ["a fractional sequence", { ...good, sequence: 1.5 }],
    ["a non-boolean close", { ...good, close: "yes" }],
    ["a delegation that is not base64", { ...good, delegation: "not base64!" }],
    ["a missing signature", { ...good, signature: undefined }],
    ["an array", [good]],
  ])("refuses %s", (_name, value) => {
    expect(parsePlannerSessionRequest(value)).toHaveProperty("error");
  });
  it("checks a closing receipt only against the closing sequence", async () => {
    const chain = providerChain(BigInt(100_000));
    const served = await chain.call(plannerChatBody("x"), { inputTokens: 1, outputTokens: 1 });
    const closing = await chain.close();
    const outcome = checkSessionAnswer({
      status: 200,
      headers: new Headers({ "x-reddi-provider-receipt": served.header, [SESSION_RECEIPT_HEADER]: closing }),
      responseText: served.body,
      requestBody: plannerChatBody("x"),
      providerWallet: mockProvider.address,
      escrow: ESCROW,
      sequence: 2,
    });
    // Named as call 2, the call receipt (call 1) and the closing receipt (call 2) both fail to match.
    expect(outcome.call).toBeUndefined();
    expect(outcome.closing).toBeUndefined();
  });
});

describe("signing a single metered call (#866)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function lockAuth() {
    return delegateLock({ escrow: ESCROW, providerWallet: mockProvider.address, signWithPayer: payer.sign, sessionKey: { publicKey: sessionKey.address, sign: sessionKey.sign }, nowMs: NOW_MS });
  }

  it("signs the exact body the server sends, and the provider's verifier accepts it only for that body", async () => {
    const auth = await signSingleCall(await lockAuth(), "summarise this");
    const headers = new Headers({ "x402-session-delegation": auth.delegation, "x402-session-signature": auth.signature });
    const check = (body: string, payerKey = payer.address) =>
      verifyPaidCallRequest({ headers: { get: (n: string) => headers.get(n) }, escrow: new PublicKey(ESCROW), payer: new PublicKey(payerKey), provider: new PublicKey(mockProvider.address), body, nowMs: NOW_MS });
    expect(check(plannerChatBody("summarise this"))).toMatchObject({ ok: true, sessionKey: sessionKey.address });
    expect(check(plannerChatBody("something else"))).toMatchObject({ ok: false, reason: "session_auth_invalid" });
    expect(check(plannerChatBody("summarise this"), mockProvider.address)).toMatchObject({ ok: false, reason: "session_auth_invalid" });
    // A single-call signature is not a session call signature.
    expect(verifySessionRequest({ headers: { get: (n: string) => headers.get(n) }, action: "call", escrow: new PublicKey(ESCROW), payer: new PublicKey(payer.address), provider: new PublicKey(mockProvider.address), sequence: 1, body: plannerChatBody("summarise this"), nowMs: NOW_MS })).toMatchObject({ ok: false });
  });

  it("is refused when the wallet declines the message", async () => {
    await expect(delegateLock({ escrow: ESCROW, providerWallet: mockProvider.address, signWithPayer: async () => { throw new Error("User rejected"); }, nowMs: NOW_MS })).rejects.toThrow(/User rejected/);
  });

  it("forwards the signature on a metered call that is not a session, and explains a provider that refuses it", async () => {
    const { executePlannerSpecialistCall } = await import("@/lib/onboarding/planner-execution");
    const paidCallAuth = await signSingleCall(await lockAuth(), "summarise this");
    const sent: Array<Record<string, string>> = [];
    global.fetch = jest.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      sent.push(init.headers);
      return response(200, JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    }) as unknown as typeof fetch;
    await executePlannerSpecialistCall({ prompt: "summarise this", paymentMode: "wallet", preferredWallet: mockProvider.address, paymentReceipt: lockReceipt, paidCallAuth });
    const paidHeaders = sent.find((h) => h["x402-payment"]);
    expect(paidHeaders).toMatchObject({ "x402-session-delegation": paidCallAuth.delegation, "x402-session-signature": paidCallAuth.signature });
    expect(paidHeaders?.["x402-session-sequence"]).toBeUndefined();

    global.fetch = jest.fn().mockResolvedValue(response(401, JSON.stringify({ error: { code: "session_auth_required" } }))) as unknown as typeof fetch;
    const refused = await executePlannerSpecialistCall({ prompt: "summarise this", paymentMode: "wallet", preferredWallet: mockProvider.address, paymentReceipt: lockReceipt });
    expect(refused.ok).toBe(false);
    expect(refused.result.error).toMatch(/needs your wallet's signature.*Nothing was charged/);
  });

  it("reads the paidCallAuth field and refuses a malformed one", () => {
    const good = { delegation: "ZGVsZWdhdGlvbg==", signature: "c2lnbmF0dXJl" };
    expect(parsePaidCallAuth(good)).toEqual(good);
    expect(parsePaidCallAuth(undefined)).toBeUndefined();
    expect(parsePaidCallAuth([good])).toHaveProperty("error");
    expect(parsePaidCallAuth({ ...good, signature: "not base64!" })).toHaveProperty("error");
    expect(parsePaidCallAuth({ delegation: good.delegation })).toHaveProperty("error");
  });
});

describe("a settled session is one job, and the buyer can settle now (#863 follow-ups)", () => {
  const originalFetch = global.fetch;
  const onDatabase = () => (loadListingIndex as jest.Mock).mockResolvedValueOnce({ source: "database", available: true, entries: [] });
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function oneCall(handle: PlannerSessionHandle, chain: ReturnType<typeof providerChain>, close: boolean) {
    const { executePlannerSpecialistCall } = await import("@/lib/onboarding/planner-execution");
    const prepared = await prepareSessionCall(handle, "summarise this", close);
    if (!prepared.ok) throw new Error(prepared.message);
    const served = await chain.call(plannerChatBody("summarise this"), { inputTokens: 40, outputTokens: 120 });
    const closing = close ? await chain.close() : undefined;
    global.fetch = jest.fn().mockResolvedValue(
      response(200, served.body, { "x-reddi-provider-receipt": served.header, ...(closing ? { [SESSION_RECEIPT_HEADER]: closing, [SESSION_STATE_HEADER]: "settled" } : {}) }),
    ) as unknown as typeof fetch;
    const result = await executePlannerSpecialistCall({ prompt: "summarise this", paymentMode: "wallet", preferredWallet: mockProvider.address, paymentReceipt: lockReceipt, session: prepared.request });
    const outcome = (result as { session?: Parameters<typeof applySessionOutcome>[2] }).session;
    return { result, handle: applySessionOutcome(handle, result.ok, outcome).handle, outcome };
  }

  it("records the session once, on the call that settles it, named by the settle and the closing receipt", async () => {
    const chain = providerChain(BigInt(100_000));
    onDatabase();
    const first = await oneCall(await openSession(), chain, false);
    expect(first.result.result.trace).toContain("job:not_recorded:session_call");
    expect(verifyAndRecordMeteredCall).not.toHaveBeenCalled();

    onDatabase();
    const last = await oneCall(first.handle, chain, true);
    expect(last.handle.ledger.state).toBe("settled");
    expect(last.result.result).toMatchObject({ jobId: "job-1", settleTxSignature: SETTLE_SIG });
    expect(last.result.result.trace).toContain("job:recorded:session");
    expect(verifyAndRecordMeteredCall).toHaveBeenCalledTimes(1);
    expect((verifyAndRecordMeteredCall as jest.Mock).mock.calls[0][0]).toMatchObject({ settleSignature: SETTLE_SIG, requestHash: last.outcome?.closing?.receiptHash, responseHash: undefined, delivered: true, receipt: lockReceipt });
  });

  it("without a database, says so rather than recording", async () => {
    const last = await oneCall(await openSession(), providerChain(BigInt(100_000)), true);
    expect(last.result.result.trace).toContain("job:not_recorded:no_database");
    expect(verifyAndRecordMeteredCall).not.toHaveBeenCalled();
  });

  it("settles now with the session key's close signature, checks the closing receipt and records one job", async () => {
    const { closePlannerSession } = await import("@/lib/onboarding/planner-execution");
    const chain = providerChain(BigInt(100_000));
    let { handle } = await oneCall(await openSession(), chain, false);
    ({ handle } = await oneCall(handle, chain, false));
    const prepared = await prepareSessionClose(handle);
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.close.sequence).toBe(3);

    const closing = await chain.close();
    let sent: { url: string; headers: Record<string, string>; body: unknown } | undefined;
    global.fetch = jest.fn(async (url: string, init: { headers: Record<string, string>; body: unknown }) => {
      sent = { url, headers: init.headers, body: init.body };
      return response(200, JSON.stringify({ ok: true, status: "settled" }), { [SESSION_RECEIPT_HEADER]: closing });
    }) as unknown as typeof fetch;
    onDatabase();
    const result = await closePlannerSession({ preferredWallet: mockProvider.address, paymentReceipt: lockReceipt, close: prepared.close });
    expect(sent?.url).toBe("https://specialist.example/v1/session/close");
    expect(sent?.body).toBe("");
    expect(sent?.headers["x402-payment"]).toBe(handle.ledger.paymentHeader);
    // The provider's own verifier accepts the close, and only as a close.
    const headers = new Headers(sent?.headers);
    const check = (action: "close" | "read") =>
      verifySessionRequest({ headers: { get: (n: string) => headers.get(n) }, action, escrow: new PublicKey(ESCROW), payer: new PublicKey(payer.address), provider: new PublicKey(mockProvider.address), sequence: 0, body: "", nowMs: NOW_MS });
    expect(check("close")).toMatchObject({ ok: true });
    expect(check("read")).toMatchObject({ ok: false });

    expect(result).toMatchObject({ ok: true, settleTxSignature: SETTLE_SIG, jobId: "job-1" });
    expect((verifyAndRecordMeteredCall as jest.Mock).mock.calls[0][0]).toMatchObject({ settleSignature: SETTLE_SIG, requestHash: result.session.closing?.receiptHash });
    const applied = applySessionClose(handle, JSON.parse(JSON.stringify(result)));
    expect(applied.handle.ledger).toMatchObject({ state: "settled", settleSignature: SETTLE_SIG, costBaseUnits: chain.cost });
    expect(applied.note).toMatch(/Session settled: 2 calls/);
  });

  it("reports a pending settle, a session already gone, and a closing receipt that does not check out", async () => {
    const { closePlannerSession } = await import("@/lib/onboarding/planner-execution");
    const chain = providerChain(BigInt(100_000));
    const { handle } = await oneCall(await openSession(), chain, false);
    const prepared = await prepareSessionClose(handle);
    if (!prepared.ok) throw new Error(prepared.message);
    const settle = async (answer: ReturnType<typeof response>) => {
      global.fetch = jest.fn().mockResolvedValue(answer) as unknown as typeof fetch;
      const result = await closePlannerSession({ preferredWallet: mockProvider.address, paymentReceipt: lockReceipt, close: prepared.close });
      return { result, applied: applySessionClose(handle, JSON.parse(JSON.stringify(result))) };
    };

    const pending = await settle(response(202, JSON.stringify({ ok: false, status: "pending" })));
    expect(pending.result.ok).toBe(false);
    expect(pending.applied.handle.ledger.state).toBe("closing");
    expect(pending.applied.note).toMatch(/settling the session now/);

    const gone = await settle(response(404, JSON.stringify({ error: { code: "session_not_found" } })));
    expect(gone.applied.handle.ledger.state).toBe("closing");
    expect(gone.applied.note).toMatch(/may have settled already/);

    // A closing receipt for the wrong number does not check out, and nothing is recorded.
    await chain.call(plannerChatBody("x"), { inputTokens: 1, outputTokens: 1 });
    const wrong = await settle(response(200, "{}", { [SESSION_RECEIPT_HEADER]: await chain.close() }));
    expect(wrong.result.session.problem).toMatch(/^closing receipt:/);
    expect(wrong.applied.handle.ledger.state).toBe("open");
    expect(verifyAndRecordMeteredCall).not.toHaveBeenCalled();
  });

  it("refuses locally to settle a session that served nothing, and refuses a malformed request", async () => {
    expect(await prepareSessionClose(await openSession())).toMatchObject({ ok: false });
    const good = { sequence: 2, delegation: "ZGVsZWdhdGlvbg==", signature: "c2lnbmF0dXJl" };
    expect(parsePlannerSessionClose(good)).toEqual(good);
    for (const bad of [undefined, [good], { ...good, sequence: 1 }, { ...good, sequence: 2.5 }, { ...good, signature: "not base64!" }, { sequence: 2 }]) {
      expect(parsePlannerSessionClose(bad)).toHaveProperty("error");
    }
  });
});
