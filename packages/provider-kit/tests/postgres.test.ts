/**
 * The Postgres stores, against a real database with the migration applied
 * (supabase/migrations/20261123120000_provider_kit_state.sql and
 * 20261124180000_provider_kit_budgets.sql). Set
 * RAP_TEST_DATABASE_URL to run them; CI does. Each test uses its own provider
 * id, so tests never see each other's rows.
 *
 * The races here are the ones a serverless host makes real: several instances
 * of one provider, each with its own memory, sharing one database.
 */
import { pinLaunchRateClock } from "./launch-clock.js";
import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign as edSign } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createProviderHandler, PROVIDER_RECEIPT_HEADER } from "../src/handler.js";
import { Capacity } from "../src/capacity.js";
import { postgresProviderStores, PostgresCapacityStore, PostgresHeldAnswerStore, PostgresLockLease, PostgresPendingSettleStore, PostgresReplayStore, type PgPool } from "../src/postgres.js";
import type { Upstream } from "../src/upstream.js";
import { PostgresBudgetSliceStore, type BudgetSlice } from "../src/budgets.js";
import { config, CURRENT_SLOT, escrowAddress, escrowBytes, fakeChain, NONCE, paymentHeader, PROGRAM, provider, SETTLE_SIGNATURE, singleCallHeaders, type FakeChain } from "./helpers.js";

pinLaunchRateClock();

const url = process.env.RAP_TEST_DATABASE_URL;
if (!url && process.env.CI) throw new Error("RAP_TEST_DATABASE_URL is not set: the Postgres store tests must run in CI");
const skip = !url ? "set RAP_TEST_DATABASE_URL to run the Postgres store tests" : false;
const pool = url ? new pg.Pool({ connectionString: url, max: 20 }) : undefined;
const db = () => pool as unknown as PgPool;
const id = () => `test-${randomUUID()}`;

test.after(async () => {
  await pool?.end();
});

test("a key is accepted once, even when twenty instances present it at the same moment", { skip }, async () => {
  const provider = id();
  const stores = Array.from({ length: 20 }, () => new PostgresReplayStore(db(), provider));
  const results = await Promise.all(stores.map((store) => store.checkAndStore("escrow:abc")));
  assert.equal(results.filter(Boolean).length, 1);
  // Another provider's keys are its own.
  assert.equal(await new PostgresReplayStore(db(), id()).checkAndStore("escrow:abc"), true);
});

test("several keys are recorded all together or not at all", { skip }, async () => {
  const store = new PostgresReplayStore(db(), id());
  assert.equal(await store.checkAndStoreAll(["a", "b"]), true);
  assert.equal(await store.checkAndStoreAll(["c", "b"]), false);
  // "c" was rolled back with the refused batch, so it is still new.
  assert.equal(await store.checkAndStore("c"), true);
  await assert.rejects(() => store.checkAndStoreAll(["d", "d"]));
});

test("one lease per lock: one of twenty claims wins, it expires, and only its holder can end it", { skip }, async () => {
  const provider = id();
  const now = 1_000_000;
  const leases = Array.from({ length: 20 }, () => new PostgresLockLease(db(), provider));
  const won = await Promise.all(leases.map((lease) => lease.claim("E1", 60_000, now)));
  assert.equal(won.filter(Boolean).length, 1);
  const holder = leases[won.indexOf(true)]!;
  const other = leases[won.indexOf(false)]!;
  assert.equal(await other.held("E1", now + 1), true);
  // A release by an instance that does not hold it changes nothing.
  await other.release("E1");
  assert.equal(await other.claim("E1", 60_000, now + 1), false);
  // Once it has expired, another instance may take it, and the old holder's release does not end the new lease.
  assert.equal(await other.claim("E1", 60_000, now + 60_001), true);
  await holder.release("E1");
  assert.equal(await holder.held("E1", now + 60_002), true);
  await other.release("E1");
  assert.equal(await holder.held("E1", now + 60_002), false);
});

test("a held answer reads back the same on another instance, keys and amounts included, and expires", { skip }, async () => {
  const provider = id();
  const a = new PostgresHeldAnswerStore(db(), provider);
  const b = new PostgresHeldAnswerStore(db(), provider);
  const payer = PublicKey.unique();
  const lock = { ok: true, payer, maxBaseUnits: 20_000n, createdSlot: 7n, rated: false, terms: { nonce: Uint8Array.from([1, 2, 3]), payee: payer }, payout: { treasuryToken: payer, refundTo: payer, harvestWithheldFees: false } } as never;
  await a.hold({ escrow: "E1", lock, requestId: "r1", requestHash: "h", upstream: { choices: [] }, usage: { inputTokens: 1, outputTokens: 2 }, createdMs: 100 });
  const read = await b.get("E1");
  assert.ok(read);
  const l = read.lock as unknown as { payer: PublicKey; maxBaseUnits: bigint; terms: { nonce: Uint8Array } };
  assert.ok(l.payer instanceof PublicKey && l.payer.equals(payer));
  assert.equal(l.maxBaseUnits, 20_000n);
  assert.deepEqual([...l.terms.nonce], [1, 2, 3]);
  await b.expire(50);
  assert.ok(await a.get("E1"));
  await b.expire(101);
  assert.equal(await a.get("E1"), undefined);
});

test("only pending settles are loaded, and the last record for an escrow wins", { skip }, async () => {
  const store = new PostgresPendingSettleStore(db(), id());
  const record = { escrow: "E1", requestHash: "h", status: "pending" as const, signature: "s", transaction: "t", lastValidBlockHeight: 5, instruction: { programId: "p", keys: [], data: "" }, destination: "d", treasuryToken: "x", refundTo: "r", requestId: "q" } as never;
  await store.save(record);
  assert.equal((await store.load()).length, 1);
  assert.equal((await store.findPending("E1"))?.escrow, "E1");
  await store.save({ ...(record as object), status: "landed" } as never);
  assert.deepEqual(await store.load(), []);
  assert.equal(await store.findPending("E1"), undefined);
});

test("the model's per-minute limit holds across instances: twenty takes at once, five get through", { skip }, async () => {
  const provider = id();
  const instances = Array.from({ length: 20 }, () => new Capacity({ requestsPerMinute: 5, cooldownSeconds: 60 }, new PostgresCapacityStore(db(), provider)));
  const now = Date.parse("2026-12-05T00:00:00Z");
  const results = await Promise.all(instances.map((c) => c.take(now)));
  assert.equal(results.filter((r) => r.ok).length, 5);
  assert.equal((await instances[0]!.check(now + 1_000)).ok, false);
  assert.equal((await instances[0]!.check(now + 61_000)).ok, true);
});

// Handler level: two instances of one provider, each with its own memory, sharing the database.
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(provider.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
const signMessage = (message: Uint8Array) => edSign(null, message, privateKey);
const BODY = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(400) }] });
const NOW = "2026-12-05T00:00:00.000Z";

function instance(chain: FakeChain, providerId: string, upstream: Upstream) {
  const stores = postgresProviderStores(db(), providerId);
  const events: Record<string, unknown>[] = [];
  const handler = createProviderHandler(config(), {
    chain,
    upstream,
    replayStore: stores.replayStore,
    pendingSettles: stores.pendingSettles,
    lease: stores.lease,
    heldAnswers: stores.heldAnswers,
    capacity: new Capacity({ cooldownSeconds: 60 }, stores.capacityStore),
    signMessage,
    now: () => new Date(NOW),
    log: (event) => events.push(event),
  });
  // Another wallet, signing with its own key, naming the victim's escrow and repeating the victim's request.
  const callAs = async (signer: Keypair) => handler(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x402-payment": JSON.stringify({ settlement: "metered-escrow", escrow: escrowAddress().toBase58(), payer: signer.publicKey.toBase58(), nonce: NONCE }), ...(await singleCallHeaders(BODY, Date.parse(NOW), signer)) }, body: BODY }));
  const call = async () => handler(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x402-payment": paymentHeader(), ...(await singleCallHeaders(BODY, Date.parse(NOW))) }, body: BODY }));
  return { handler, call, callAs, events };
}

const countingUpstream = (): Upstream & { calls: number } => {
  const u = {
    calls: 0,
    async createChatCompletion() {
      u.calls += 1;
      await new Promise((done) => setTimeout(done, 30));
      return { id: "c1", choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 120, completion_tokens: 333 } };
    },
  };
  return u;
};

test("the same paid request sent to two instances at once is answered and settled once", { skip }, async () => {
  const providerId = id();
  const chain = fakeChain();
  const upstream = countingUpstream();
  const [a, b] = [instance(chain, providerId, upstream), instance(chain, providerId, upstream)];
  const [ra, rb] = await Promise.all([a.call(), b.call()]);
  // The other is refused: told to wait while the first holds the lock, or that the lock has paid for a call.
  assert.equal([ra.status, rb.status].filter((s) => s === 200).length, 1);
  assert.ok([ra.status, rb.status].every((s) => s === 200 || s === 409 || s === 503));
  assert.equal(upstream.calls, 1, "the model was asked once");
  assert.equal(chain.signed.size, 1, "one settle was signed");
});

test("an answer held on one instance is collected through another once its settle lands", { skip }, async () => {
  const providerId = id();
  const chain = fakeChain();
  chain.failSend = true;
  chain.statusUnknown = true;
  const upstream = countingUpstream();
  const a = instance(chain, providerId, upstream);
  const b = instance(chain, providerId, upstream);
  assert.equal((await a.call()).status, 503);
  chain.failSend = false;
  chain.statusUnknown = false;
  chain.landed.add(SETTLE_SIGNATURE);
  const collected = await b.call();
  assert.equal(collected.status, 200);
  const body = (await collected.json()) as { choices: { message: { content: string } }[]; reddi: { metered: Record<string, unknown> } };
  assert.equal(body.choices[0]!.message.content, "hello");
  assert.deepEqual([body.reddi.metered.settleSignature, body.reddi.metered.confirmed], [SETTLE_SIGNATURE, true]);
  assert.ok(collected.headers.get(PROVIDER_RECEIPT_HEADER));
  assert.equal(upstream.calls, 1);
  assert.equal(chain.signed.size, 1);
  // Collected once: the held answer is gone, and the settle is recorded as landed.
  assert.equal(await new PostgresHeldAnswerStore(db(), providerId).get(escrowAddress().toBase58()), undefined);
  assert.deepEqual(await new PostgresPendingSettleStore(db(), providerId).load(), []);
});

test("two instances retrying a held answer at once: one looks at the settle, the other is told to wait", { skip }, async () => {
  const providerId = id();
  const chain = fakeChain();
  chain.failSend = true;
  chain.statusUnknown = true;
  const upstream = countingUpstream();
  const a = instance(chain, providerId, upstream);
  const b = instance(chain, providerId, upstream);
  assert.equal((await a.call()).status, 503);
  chain.failSend = false;
  chain.statusUnknown = false;
  chain.landed.add(SETTLE_SIGNATURE);
  let looks = 0;
  const realRead = chain.readSettlement;
  chain.readSettlement = async (signature) => {
    looks += 1;
    await new Promise((done) => setTimeout(done, 50));
    return realRead(signature);
  };
  const [ra, rb] = await Promise.all([a.call(), b.call()]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 503]);
  assert.equal(looks, 1, "the settle was read back once");
});

test("a settle whose answer is no longer held is found by the sweep on any instance and given back when it never landed", { skip }, async () => {
  const providerId = id();
  const chain = fakeChain();
  chain.failSend = true;
  chain.statusUnknown = true;
  const upstream = countingUpstream();
  const a = instance(chain, providerId, upstream);
  assert.equal((await a.call()).status, 503);
  // The held answer is gone (expired); the settle never landed.
  await new PostgresHeldAnswerStore(db(), providerId).drop(escrowAddress().toBase58());
  chain.failSend = false;
  chain.statusUnknown = false;
  const b = instance(chain, providerId, upstream);
  await b.handler.settleDueSessions();
  assert.ok(b.events.some((e) => e.event === "pending_settle_declined"));
  assert.deepEqual(await new PostgresPendingSettleStore(db(), providerId).load(), []);
});

test("a database that cannot be reached accepts nothing", { skip }, async () => {
  const broken: PgPool = {
    query: async () => {
      throw new Error("down");
    },
    connect: async () => {
      throw new Error("down");
    },
  };
  const upstream = countingUpstream();
  const stores = postgresProviderStores(broken, id());
  const handler = createProviderHandler(config(), { chain: fakeChain(), upstream, ...stores, capacity: new Capacity({ cooldownSeconds: 60 }, stores.capacityStore), signMessage, now: () => new Date(NOW) });
  const response = await handler(new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x402-payment": paymentHeader(), ...(await singleCallHeaders(BODY, Date.parse(NOW))) }, body: BODY }));
  assert.equal(response.status >= 500, true);
  const body = (await response.json()) as { charged?: unknown };
  assert.equal(body.charged, false);
  assert.equal(upstream.calls, 0);
});

test("another wallet naming the escrow cannot collect, use up or learn about a held answer; the payer still collects it", { skip }, async () => {
  const providerId = id();
  const chain = fakeChain();
  chain.failSend = true;
  chain.statusUnknown = true;
  const upstream = countingUpstream();
  const a = instance(chain, providerId, upstream);
  const b = instance(chain, providerId, upstream);
  assert.equal((await a.call()).status, 503);
  chain.failSend = false;
  chain.statusUnknown = false;
  chain.landed.add(SETTLE_SIGNATURE);
  const thief = Keypair.generate();
  for (const attempt of [await b.callAs(thief), await a.callAs(thief)]) {
    assert.equal(attempt.status, 402);
    const text = await attempt.text();
    assert.ok(!text.includes("hello") && !text.includes(SETTLE_SIGNATURE) && !text.includes("settle_pending"), text);
  }
  assert.ok(await new PostgresHeldAnswerStore(db(), providerId).get(escrowAddress().toBase58()), "the held answer is still there");
  const collected = await b.call();
  assert.equal(collected.status, 200);
  assert.equal(((await collected.json()) as { choices: { message: { content: string } }[] }).choices[0]!.message.content, "hello");
  assert.equal(upstream.calls, 1);
});

test("another wallet cannot learn the state of a settle whose answer is no longer held", { skip }, async () => {
  const providerId = id();
  const chain = fakeChain();
  chain.failSend = true;
  chain.statusUnknown = true;
  const upstream = countingUpstream();
  const a = instance(chain, providerId, upstream);
  assert.equal((await a.call()).status, 503);
  await new PostgresHeldAnswerStore(db(), providerId).drop(escrowAddress().toBase58());
  chain.statusUnknown = false;
  chain.landed.add(SETTLE_SIGNATURE);
  const probe = await instance(chain, providerId, upstream).callAs(Keypair.generate());
  assert.equal(probe.status, 402);
  assert.ok(!(await probe.text()).includes(SETTLE_SIGNATURE));
  // The settle is still pending: the probe did not look at it or close it.
  assert.equal((await new PostgresPendingSettleStore(db(), providerId).load()).length, 1);
});

test("the sweep gives back only the lock its settle was for, not a later lock at the same address", { skip }, async () => {
  const providerId = id();
  const chain = fakeChain();
  chain.failSend = true;
  chain.statusUnknown = true;
  const upstream = countingUpstream();
  const a = instance(chain, providerId, upstream);
  assert.equal((await a.call()).status, 503);
  await new PostgresHeldAnswerStore(db(), providerId).drop(escrowAddress().toBase58());
  chain.failSend = false;
  chain.statusUnknown = false;
  // The first lock was refunded and the address locked again in a later slot: another job.
  chain.accounts.set(escrowAddress().toBase58(), { owner: PROGRAM, data: escrowBytes({ createdSlot: CURRENT_SLOT - 3n }), lamports: 2_000_000n, executable: false });
  const b = instance(chain, providerId, upstream);
  await b.handler.settleDueSessions();
  assert.equal(chain.sent.length, 0, "the later lock was not declined");
  assert.ok(!b.events.some((e) => e.event === "pending_settle_declined"));
  assert.deepEqual(await new PostgresPendingSettleStore(db(), providerId).load(), []);
});

test("a budget slice reads back on another instance, and only slices not yet done are due", { skip }, async () => {
  const provider = id();
  const one = new PostgresBudgetSliceStore(db(), provider);
  const other = new PostgresBudgetSliceStore(db(), provider);
  const slice: BudgetSlice = { budget: "B1", createdSlot: "100", payer: "P", spender: "S", reserved: "500000", spent: "1234", inputTokens: 10, outputTokens: 20, sequence: 3, lastCallMs: 1, status: "open" };
  await one.save(slice);
  await one.save({ ...slice, budget: "B2", status: "done" });
  assert.deepEqual(await other.get("B1"), slice);
  assert.deepEqual((await other.due()).map((s) => s.budget), ["B1"]);
  await other.save({ ...slice, status: "posted", posted: "1234" });
  assert.equal((await one.get("B1"))?.status, "posted");
  await other.save({ ...slice, status: "done" });
  assert.deepEqual(await one.due(), []);
  assert.equal(await new PostgresBudgetSliceStore(db(), id()).get("B1"), undefined, "another provider's slices are not seen");
});
