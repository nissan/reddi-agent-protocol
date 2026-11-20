import assert from "node:assert/strict";
import test from "node:test";
import { MockOpenRouterClient } from "../src/openrouter.js";
import { chooseReplayStore, createDatabaseReplayStore, handleRuntimeRequest, replayDatabaseOrigin, type RuntimeConfig } from "../src/index.js";

const ORIGIN = "https://project.supabase.example";
const KEY = "test-service-key";

type Call = { url: string; headers: Record<string, string>; body: string };

function fakeDatabase(answer: (key: string) => { ok: boolean; status?: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const result = answer(JSON.parse(init.body).p_key);
    if (result instanceof Error) throw result;
    return { ok: result.ok, status: result.status ?? (result.ok ? 200 : 500), json: async () => result.body };
  };
  return { calls, fetchImpl };
}

test("replay database origin accepts only a bare https origin", () => {
  assert.equal(replayDatabaseOrigin("https://project.supabase.example"), ORIGIN);
  assert.equal(replayDatabaseOrigin("https://project.supabase.example/"), ORIGIN);
  for (const bad of [undefined, "", "not a url", "http://project.supabase.example", "https://user:pw@project.supabase.example", "https://project.supabase.example/rest", "https://project.supabase.example?x=1", "https://project.supabase.example/#f"]) {
    assert.equal(replayDatabaseOrigin(bad), undefined, String(bad));
  }
});

test("a durable store accepts a key once, across separate store instances", async () => {
  const seen = new Set<string>();
  const db = fakeDatabase((key) => {
    if (seen.has(key)) return { ok: true, body: false };
    seen.add(key);
    return { ok: true, body: true };
  });
  const first = createDatabaseReplayStore(ORIGIN, KEY, db.fetchImpl);
  assert.equal(await first.checkAndStore("nonce-1"), true);
  // A second instance stands in for the service after a restart.
  const restarted = createDatabaseReplayStore(ORIGIN, KEY, db.fetchImpl);
  assert.equal(await restarted.checkAndStore("nonce-1"), false);
  assert.equal(db.calls[0].url, `${ORIGIN}/rest/v1/rpc/replay_check_and_store`);
  assert.equal(db.calls[0].headers.apikey, KEY);
  assert.deepEqual(JSON.parse(db.calls[0].body), { p_key: "nonce-1" });
});

test("a durable store fails closed and never leaks the key in the error", async () => {
  for (const answer of [() => ({ ok: false, status: 500 }), () => new Error(`network down ${KEY}`), () => ({ ok: true, body: "yes" }), () => ({ ok: true, body: null })]) {
    const store = createDatabaseReplayStore(ORIGIN, KEY, fakeDatabase(answer as never).fetchImpl);
    await assert.rejects(
      async () => store.checkAndStore("nonce-2"),
      (error: Error) => /^replay store /.test(error.message) && !error.message.includes(KEY),
    );
  }
});

test("store choice: real payments need the database unless memory is explicitly allowed", () => {
  const memory = chooseReplayStore({});
  assert.equal(memory.ok && memory.durable, false);
  assert.equal(memory.ok, true);

  const refused = chooseReplayStore({ ALLOW_REAL_X402_PAYMENT: "1" });
  assert.equal(refused.ok, false);

  const local = chooseReplayStore({ ALLOW_REAL_X402_PAYMENT: "1", ALLOW_MEMORY_REPLAY_STORE: "1" });
  assert.equal(local.ok && !local.durable, true);

  const durable = chooseReplayStore({ ALLOW_REAL_X402_PAYMENT: "1", SUPABASE_URL: ORIGIN, SUPABASE_SERVICE_ROLE_KEY: KEY });
  assert.equal(durable.ok && durable.durable, true);
  if (durable.ok) assert.equal(durable.description.includes(KEY), false);

  assert.equal(chooseReplayStore({ SUPABASE_URL: ORIGIN }).ok, false);
  assert.equal(chooseReplayStore({ SUPABASE_SERVICE_ROLE_KEY: KEY }).ok, false);
  assert.equal(chooseReplayStore({ SUPABASE_URL: "http://insecure.example", SUPABASE_SERVICE_ROLE_KEY: KEY }).ok, false);
});

const demoConfig: RuntimeConfig = {
  profileId: "planning-agent",
  endpointBaseUrl: "https://planning.example.test",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  mockOpenRouter: true,
  requirePayment: true,
  allowDemoPayment: true,
};

function paidRequest(nonce: string) {
  return new Request("https://planning.example.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "x402-payment": `demo:${nonce}` },
    body: JSON.stringify({ messages: [{ role: "user", content: "plan a launch" }] }),
  });
}

test("runtime uses the supplied store: a receipt accepted before a restart is refused after it", async () => {
  const seen = new Set<string>();
  const db = fakeDatabase((key) => ({ ok: true, body: seen.has(key) ? false : (seen.add(key), true) }));
  const client = new MockOpenRouterClient();
  const before = await handleRuntimeRequest(paidRequest("restart-1"), demoConfig, client, { replayStore: createDatabaseReplayStore(ORIGIN, KEY, db.fetchImpl) });
  assert.equal(before.status, 200);
  const after = await handleRuntimeRequest(paidRequest("restart-1"), demoConfig, client, { replayStore: createDatabaseReplayStore(ORIGIN, KEY, db.fetchImpl) });
  assert.equal(after.status, 402);
});

test("runtime answers 503 and serves nothing when the replay store is down", async () => {
  const db = fakeDatabase(() => ({ ok: false, status: 503 }));
  const response = await handleRuntimeRequest(paidRequest("down-1"), demoConfig, new MockOpenRouterClient(), { replayStore: createDatabaseReplayStore(ORIGIN, KEY, db.fetchImpl) });
  assert.equal(response.status, 503);
  const body = (await response.json()) as { error: { code: string }; choices?: unknown };
  assert.equal(body.error.code, "payment_check_unavailable");
  assert.equal(body.choices, undefined);
});
