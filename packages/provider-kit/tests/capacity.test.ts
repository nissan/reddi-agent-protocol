import assert from "node:assert/strict";
import { createPrivateKey, sign as edSign } from "node:crypto";
import test from "node:test";
import { MemoryNonceReplayStore } from "@redditech/x402-solana";
import { Capacity, type CapacityCheck } from "../src/capacity.js";
import { parseProviderConfig, type ProviderConfigFile } from "../src/config.js";
import { createProviderHandler } from "../src/handler.js";
import { UpstreamError, type Upstream } from "../src/upstream.js";
import { config, configFile, fakeChain, paymentHeader, provider, singleCallHeaders, type FakeChain } from "./helpers.js";

const NOW = Date.parse("2026-12-05T00:00:00.000Z");
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(provider.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
const signMessage = (message: Uint8Array) => edSign(null, message, privateKey);
const BODY = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(400) }] });
const answering = (): Upstream & { calls: number } => {
  const u = { calls: 0, async createChatCompletion() { u.calls += 1; return { id: "c1", choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 120, completion_tokens: 333 } }; } };
  return u;
};

function setup(options: { file?: Partial<ProviderConfigFile>; upstream?: Upstream; chain?: FakeChain; capacity?: Capacity; now?: () => number } = {}) {
  const chain = options.chain ?? fakeChain();
  const replayStore = new MemoryNonceReplayStore();
  const events: Record<string, unknown>[] = [];
  const handler = createProviderHandler(config(options.file ?? {}), { chain, upstream: options.upstream ?? answering(), replayStore, signMessage, now: () => new Date(options.now?.() ?? NOW), log: (e) => events.push(e), ...(options.capacity ? { capacity: options.capacity } : {}) });
  const unpaid = () => handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: BODY }));
  const paid = async () => handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...(await singleCallHeaders(BODY, NOW)), "x402-payment": paymentHeader() }, body: BODY }));
  const health = async () => (await handler(new Request("http://localhost:8787/healthz"))).json() as Promise<Record<string, unknown>>;
  return { chain, unpaid, paid, health, events };
}

test("limits per minute and per day, and a cooldown, each say when to come back", async () => {
  const c = new Capacity({ requestsPerMinute: 2, requestsPerDay: 3, cooldownSeconds: 30 });
  assert.deepEqual(await c.take(NOW), { ok: true });
  assert.deepEqual(await c.take(NOW + 10_000), { ok: true });
  assert.deepEqual(await c.check(NOW + 20_000), { ok: false, reason: "minute_limit", retryAfterSeconds: 40 });
  // A check takes nothing; a minute after the first call there is room again.
  assert.deepEqual(await c.take(NOW + 60_001), { ok: true });
  // Three today: offline until midnight UTC.
  assert.deepEqual(await c.check(NOW + 120_000), { ok: false, reason: "day_limit", retryAfterSeconds: 86_400 - 120 });
  assert.deepEqual(await c.check(NOW + 86_400_000), { ok: true });
  await c.coolDown(NOW + 86_400_000);
  assert.deepEqual(await c.check(NOW + 86_410_000), { ok: false, reason: "cooling_down", retryAfterSeconds: 20 });
  assert.deepEqual(await c.check(NOW + 86_430_000), { ok: true });
});

test("config: capacity limits are whole numbers, with a 60 second cooldown by default", () => {
  const ok = parseProviderConfig(configFile({ capacity: { requestsPerMinute: 20, requestsPerDay: 200 } }), {});
  assert.ok(ok.ok && ok.config.capacity.requestsPerMinute === 20 && ok.config.capacity.requestsPerDay === 200 && ok.config.capacity.cooldownSeconds === 60);
  const none = parseProviderConfig(configFile(), {});
  assert.ok(none.ok);
  assert.deepEqual(none.config.capacity, { cooldownSeconds: 60 });
  const bad = parseProviderConfig(configFile({ capacity: { requestsPerMinute: 0, requestsPerDay: 1.5, cooldownSeconds: -1 } }), {});
  assert.ok(!bad.ok);
  assert.equal(bad.errors.filter((e) => e.startsWith("capacity.")).length, 3);
});

test("once the day's calls are used, the provider says busy before any lock, and a lock sent anyway is not read or used", async () => {
  const upstream = answering();
  const { unpaid, paid, chain, health } = setup({ file: { capacity: { requestsPerDay: 1 } }, upstream });
  assert.equal((await unpaid()).status, 402);
  assert.equal((await paid()).status, 200);
  assert.equal(upstream.calls, 1);
  const sentAfterFirst = chain.sent.length;

  const offer = await unpaid();
  assert.equal(offer.status, 503);
  assert.equal(offer.headers.get("retry-after"), "86400");
  const body = (await offer.json()) as { error: { code: string; message: string }; charged: boolean; busy: { reason: string } };
  assert.equal(body.error.code, "provider_busy");
  assert.equal(body.busy.reason, "day_limit");
  assert.equal(body.charged, false);
  assert.match(body.error.message, /offline until midnight UTC/);

  const again = await paid();
  assert.equal(again.status, 503);
  assert.match(((await again.json()) as { error: { message: string } }).error.message, /lock is untouched/);
  assert.equal(chain.sent.length, sentAfterFirst, "nothing was sent on chain");
  assert.equal(upstream.calls, 1, "the model was not called");
  const h = await health();
  assert.equal(h.available, false);
  assert.deepEqual(h.busy, { reason: "day_limit", retryAfterSeconds: 86_400 });
});

test("a 429 from the model refunds the lock and cools the provider down; afterwards it takes calls again", async () => {
  let rateLimited = true;
  const upstream: Upstream = { async createChatCompletion() { if (rateLimited) throw new UpstreamError("the model answered with status 429", 429); return { id: "c", choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }; } };
  let now = NOW;
  const { unpaid, paid, chain } = setup({ file: { capacity: { cooldownSeconds: 45 } }, upstream, now: () => now });
  const failed = await paid();
  assert.equal(failed.status, 502);
  assert.equal(chain.sent.length, 1, "the lock was declined in full");
  const cooling = await unpaid();
  assert.equal(cooling.status, 503);
  assert.equal(cooling.headers.get("retry-after"), "45");
  assert.equal(((await cooling.json()) as { busy: { reason: string } }).busy.reason, "cooling_down");
  rateLimited = false;
  now += 46_000;
  assert.equal((await unpaid()).status, 402);
  // Any other failure does not cool down.
  const other = setup({ upstream: { async createChatCompletion() { throw new UpstreamError("the model answered with status 500", 500); } } });
  assert.equal((await other.paid()).status, 502);
  assert.equal((await other.unpaid()).status, 402);
});

test("filling up between the check and the call gives the lock back whole; a capacity store that fails counts as busy", async () => {
  const racing = new Capacity({ cooldownSeconds: 60 });
  racing.take = async (): Promise<CapacityCheck> => ({ ok: false, reason: "minute_limit", retryAfterSeconds: 7 });
  const upstream = answering();
  const raced = setup({ capacity: racing, upstream });
  const response = await raced.paid();
  assert.equal(response.status, 503);
  const body = (await response.json()) as { refundSignature?: string; charged: boolean };
  assert.equal(body.charged, false);
  assert.ok(body.refundSignature, "the decline was sent");
  assert.equal(raced.chain.sent.length, 1);
  assert.equal(upstream.calls, 0);
  assert.ok(raced.events.some((e) => e.event === "provider_busy" && e.declined === true));

  const broken = new Capacity({ cooldownSeconds: 60 });
  broken.check = async () => { throw new Error("store down"); };
  const b = setup({ capacity: broken });
  const offer = await b.unpaid();
  assert.equal(offer.status, 503);
  assert.equal(offer.headers.get("retry-after"), "10");
});
