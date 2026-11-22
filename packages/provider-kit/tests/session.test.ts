import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyReddiReceiptV2Session, type SignedReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import { Keypair } from "@solana/web3.js";
import { MemoryNonceReplayStore, MeteredSessionLedger, SESSION_DELEGATION_HEADER, SESSION_SIGNATURE_HEADER, sessionDelegationHeaderValue, sessionSignatureHeaderValue, type NonceReplayStore, type SessionAction, type SessionStore } from "@redditech/x402-solana";
import { createProviderHandler, PROVIDER_RECEIPT_HEADER, SESSION_RECEIPT_HEADER, SESSION_STATE_HEADER } from "../src/handler.js";
import { FileSessionStore } from "../src/sessions.js";
import type { Upstream } from "../src/upstream.js";
import { buyerKeypair, singleCallHeaders, config, escrowAddress, fakeChain, paymentHeader, provider, type FakeChain } from "./helpers.js";

const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(provider.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
const signMessage = (message: Uint8Array) => edSign(null, message, privateKey);
// 100 input tokens estimated, 500 output allowed: a worst case of 7,800 base units. The lock holds 20,000.
const BODY = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(400) }] });
const ESCROW = escrowAddress().toBase58();
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const keySigner = (k: Keypair) => { const key = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(k.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" }); return (m: Uint8Array) => new Uint8Array(edSign(null, Buffer.from(m), key)); };
const SESSION_KEY = Keypair.generate();

/** The headers a buyer's session client sends: the payer's delegation to a session key, and that key's signature over the request. */
async function signed(action: SessionAction, sequence: number, body: string, nowMs: number, opts: { payer?: Keypair; key?: Keypair } = {}): Promise<Record<string, string>> {
  const key = opts.key ?? SESSION_KEY;
  return {
    [SESSION_DELEGATION_HEADER]: await sessionDelegationHeaderValue({ escrow: ESCROW, provider: provider.publicKey.toBase58(), sessionKey: key.publicKey.toBase58(), expiresAt: Math.floor(nowMs / 1000) + 3600 }, keySigner(opts.payer ?? buyerKeypair)),
    [SESSION_SIGNATURE_HEADER]: await sessionSignatureHeaderValue({ action, escrow: ESCROW, sequence, body }, keySigner(key)),
  };
}

function upstream(fail = false): Upstream & { calls: number; fail: boolean } {
  const u = {
    calls: 0,
    fail,
    async createChatCompletion() {
      u.calls += 1;
      if (u.fail) throw new Error("model down");
      return { id: `c${u.calls}`, choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 120, completion_tokens: 333 } };
    },
  };
  return u;
}

function setup(options: { chain?: FakeChain; store?: SessionStore; replayStore?: NonceReplayStore; sessions?: boolean } = {}) {
  const chain = options.chain ?? fakeChain();
  const clock = { ms: Date.parse("2026-12-05T00:00:00.000Z") };
  const events: Record<string, unknown>[] = [];
  const cfg = config();
  const ledger = new MeteredSessionLedger(cfg.terms, options.store);
  const model = upstream();
  const handler = createProviderHandler(cfg, {
    chain,
    upstream: model,
    replayStore: options.replayStore ?? new MemoryNonceReplayStore(),
    ...(options.sessions === false ? {} : { sessions: ledger }),
    signMessage,
    now: () => new Date(clock.ms),
    log: (event) => events.push(event),
  });
  type As = { payer?: Keypair; key?: Keypair; unsigned?: boolean };
  const call = async (sequence?: number, extra: Record<string, string> = {}, as: As = {}) =>
    handler(new Request("http://localhost:8787/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x402-payment": paymentHeader(), ...(sequence === undefined ? (as.unsigned ? {} : await singleCallHeaders(BODY, clock.ms)) : { "x402-session-sequence": String(sequence), ...(as.unsigned ? {} : await signed("call", sequence, BODY, clock.ms, as)) }), ...extra },
      body: BODY,
    }));
  const close = async (as: As = {}) => handler(new Request("http://localhost:8787/v1/session/close", { method: "POST", headers: { "x402-payment": paymentHeader(), ...(as.unsigned ? {} : await signed("close", 0, "", clock.ms, as)) } }));
  const read = async (as: As = {}) => handler(new Request(`http://localhost:8787/v1/session/${ESCROW}`, { headers: as.unsigned ? {} : await signed("read", 0, "", clock.ms, as) }));
  return { chain, handler, call, close, read, events, clock, ledger, model };
}
const receiptOf = (response: Response, header = PROVIDER_RECEIPT_HEADER) => JSON.parse(Buffer.from(response.headers.get(header)!, "base64url").toString("utf8")) as SignedReddiReceiptV2;
const settles = (chain: FakeChain) => chain.sent.length;

test("three calls under one lock, closed on the last, settle once for the total, with a receipt chain that verifies (RAP-SESSION-S1)", async () => {
  const { call, chain } = setup();
  const receipts: SignedReddiReceiptV2[] = [];
  for (const sequence of [1, 2]) {
    const response = await call(sequence);
    assert.equal(response.status, 200, await response.clone().text());
    const body = (await response.json()) as { reddi: { metered: { session: Record<string, unknown> } } };
    assert.equal(body.reddi.metered.session.sequence, sequence);
    assert.equal(body.reddi.metered.session.settled, false);
    receipts.push(receiptOf(response));
  }
  assert.equal(settles(chain), 0, "nothing is settled per call");
  const last = await call(3, { "x402-session": "close" });
  assert.equal(last.status, 200);
  assert.equal(last.headers.get(SESSION_STATE_HEADER), "settled");
  receipts.push(receiptOf(last));
  const closing = receiptOf(last, SESSION_RECEIPT_HEADER);
  receipts.push(closing);
  assert.equal(settles(chain), 1);
  // 360 in and 999 out at 3 and 15 per million: 16,065 base units, from a 20,000 lock.
  assert.equal(chain.sent[0]![0]!.data.readBigUInt64LE(8), 16_065n);
  assert.equal(closing.receipt.payment!.amount, "16065");
  assert.equal(closing.receipt.payment!.metered!.refunded, "3935");
  assert.equal(closing.receipt.payment!.fee.amount, "401");
  const chainCheck = verifyReddiReceiptV2Session(receipts, { providerId: provider.publicKey.toBase58(), session: { escrow: ESCROW } });
  assert.equal(chainCheck.ok, true, JSON.stringify(chainCheck));
  assert.equal(chainCheck.ok && chainCheck.closed, true);
});

test("a replayed or skipped call is refused before the model runs (RAP-SESSION-S3)", async () => {
  const { call, model } = setup();
  assert.equal((await call(1)).status, 200);
  for (const sequence of [1, 3]) {
    const response = await call(sequence);
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "session_sequence_invalid");
  }
  assert.equal(model.calls, 1);
  assert.equal((await call(2)).status, 200);
});

test("a call whose worst case would pass the lock is refused before the model runs (RAP-SESSION-S2)", async () => {
  const { call, model, chain } = setup();
  for (const sequence of [1, 2, 3]) assert.equal((await call(sequence)).status, 200);
  const refused = await call(4);
  assert.equal(refused.status, 402);
  const body = (await refused.json()) as { error: { code: string }; session: { cumulativeCostBaseUnits: string } };
  assert.equal(body.error.code, "session_max_reached");
  assert.equal(body.session.cumulativeCostBaseUnits, "16065");
  assert.equal(model.calls, 3);
  assert.equal(settles(chain), 0);
});

test("a model failure charges nothing, keeps the session open and the call number free", async () => {
  const { call, model, chain } = setup();
  assert.equal((await call(1)).status, 200);
  model.fail = true;
  const failed = await call(2);
  assert.equal(failed.status, 502);
  assert.equal(settles(chain), 0, "the lock is not declined: call 1 is owed");
  model.fail = false;
  assert.equal((await call(2)).status, 200);
});

test("an idle session is settled by the sweep, and later calls are refused (RAP-SESSION-S4)", async () => {
  const { call, handler, chain, clock, read } = setup();
  assert.equal((await call(1)).status, 200);
  assert.deepEqual(await handler.settleDueSessions(), []);
  clock.ms += 600_000;
  const ended = await handler.settleDueSessions();
  assert.equal(ended[0]?.status, "settled");
  assert.equal(settles(chain), 1);
  assert.equal(chain.sent[0]![0]!.data.readBigUInt64LE(8), 5_355n);
  const after = await call(2);
  assert.equal(after.status, 409);
  assert.equal(((await after.json()) as { error: { code: string } }).error.code, "session_closed");
  const summary = (await (await read()).json()) as { session: { settled: boolean }; closing: { receipt: string; summary: string } };
  assert.equal(summary.session.settled, true);
  assert.ok(summary.closing.receipt);
});

test("closing a session with no call recorded declines the lock: the buyer gets it all back", async () => {
  const { call, close, chain, model } = setup();
  model.fail = true;
  assert.equal((await call(1)).status, 502);
  const closed = await close();
  assert.equal(closed.status, 200);
  assert.equal(((await closed.json()) as { status: string }).status, "declined");
  assert.equal(settles(chain), 1);
  const cancel = createHash("sha256").update("global:cancel_token_escrow").digest().subarray(0, 8);
  assert.deepEqual([...chain.sent[0]![0]!.data.subarray(0, 8)], [...cancel], "a decline, not a settle");
  assert.equal(chain.sent[0]![0]!.data.length, 16, "named by the escrow's lock slot");
});

test("a settle that does not land leaves the session closing and is tried again", async () => {
  const { call, close, chain, handler } = setup();
  assert.equal((await call(1)).status, 200);
  chain.failSends = 2;
  const first = await close();
  assert.equal(first.status, 202);
  assert.equal(((await first.json()) as { status: string }).status, "pending");
  const again = await handler.settleDueSessions();
  assert.equal(again[0]?.status, "settled");
});

test("a restart restores the session from its file and goes on from the last recorded call (RAP-SESSION-S5)", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "rap-sessions-")), "sessions.jsonl");
  const replayStore = new MemoryNonceReplayStore();
  const chain = fakeChain();
  const first = setup({ chain, store: new FileSessionStore(file), replayStore });
  assert.equal((await first.call(1)).status, 200);
  assert.equal((await first.call(2)).status, 200);
  const store = new FileSessionStore(file);
  const second = setup({ chain, store, replayStore });
  assert.equal(await second.ledger.restore(), 1);
  assert.equal((await second.call(2)).status, 409);
  const third = await second.call(3, { "x402-session": "close" });
  assert.equal(third.status, 200);
  assert.equal(chain.sent[0]![0]!.data.readBigUInt64LE(8), 16_065n);
  store.close();
});

test("a lock used for a session cannot pay for a single call, nor the other way round", async () => {
  const sessionFirst = setup();
  assert.equal((await sessionFirst.call(1)).status, 200);
  assert.equal((await sessionFirst.call()).status, 409);
  const singleFirst = setup();
  assert.equal((await singleFirst.call()).status, 200);
  assert.equal((await singleFirst.call(1)).status, 409);
});

test("malformed session headers and a provider without sessions are refused before any check", async () => {
  const { call } = setup();
  assert.equal((await call(undefined, { "x402-session": "close" })).status, 400);
  assert.equal((await call(undefined, { "x402-session-sequence": "0" })).status, 400);
  const none = setup({ sessions: false });
  const refused = await none.call(1);
  assert.equal(refused.status, 400);
  assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "sessions_not_offered");
});

test("someone who knows the public lock but is not the payer cannot call, close or read the session (security review S-1, S-3)", async () => {
  const { call, close, read, model, chain } = setup();
  const stranger = Keypair.generate();
  for (const response of [await call(1, {}, { unsigned: true }), await call(1, {}, { payer: stranger, key: stranger })]) {
    assert.equal(response.status, 401);
    assert.match(((await response.json()) as { error: { code: string } }).error.code, /^session_auth_/);
  }
  assert.equal(model.calls, 0, "the model never ran for the stranger");
  assert.equal((await call(1)).status, 200, "the buyer still starts at call 1");
  for (const response of [await close({ unsigned: true }), await read({ unsigned: true }), await close({ payer: stranger, key: stranger })]) assert.equal(response.status, 401);
  assert.equal(settles(chain), 0, "nothing was closed by the stranger");
  assert.equal((await read()).status, 200);
});

test("a second key delegated by the payer cannot take over a session already started", async () => {
  const { call, close } = setup();
  assert.equal((await call(1)).status, 200);
  const other = Keypair.generate();
  const response = await call(2, {}, { key: other });
  assert.equal(response.status, 409);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "session_key_mismatch");
  assert.equal((await close({ key: other })).status, 409);
});

test("a signed call whose body was changed in transit is refused", async () => {
  const { handler, clock, model } = setup();
  const headers = { "content-type": "application/json", "x402-payment": paymentHeader(), "x402-session-sequence": "1", ...(await signed("call", 1, BODY, clock.ms)) };
  const response = await handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers, body: BODY.replace("x", "y") }));
  assert.equal(response.status, 401);
  assert.equal(model.calls, 0);
});

test("a later escrow locked at the session's address is not settled for the session's calls", async () => {
  const { call, close, chain, events } = setup();
  assert.equal((await call(1)).status, 200);
  // The buyer refunded the session's escrow and locked another at the same address in a later slot.
  const account = chain.accounts.get(ESCROW)!;
  const data = Buffer.from(account.data);
  data.writeBigUInt64LE(data.readBigUInt64LE(193) + 5n, 193);
  chain.accounts.set(ESCROW, { ...account, data });
  const refused = await call(2);
  assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "session_lock_mismatch");
  const closed = await close();
  assert.equal(((await closed.json()) as { status: string }).status, "refunded_unpaid");
  assert.equal(settles(chain), 0, "nothing is sent against the later escrow");
  assert.ok(events.some((e) => e.event === "session_lock_replaced"));
});

test("a lock the buyer refunded before the settle is recorded as unpaid, not settled (security review S-2)", async () => {
  const { call, close, chain, events } = setup();
  assert.equal((await call(1)).status, 200);
  chain.accounts.delete(ESCROW);
  const refund = "R".repeat(88);
  chain.latestSuccess = async () => refund;
  chain.settlement = { failed: false, programIds: [config().terms.programId.toBase58()], accounts: [ESCROW], tokenBalances: [{ account: config().terms.payee.toBase58(), mint: config().terms.mint.toBase58(), before: 0n, after: 0n }] };
  const closed = await close();
  assert.equal(((await closed.json()) as { status: string }).status, "refunded_unpaid");
  assert.ok(events.some((e) => e.event === "session_refunded_unpaid" && e.signature === refund));
});
