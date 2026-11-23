/**
 * The serverless entry: what it refuses to start with, how it reads its key
 * and private prompt from the environment, and how it routes under a mount
 * path. The paid call through it runs against Postgres when
 * RAP_TEST_DATABASE_URL is set (CI sets it).
 */
import { pinLaunchRateClock } from "./launch-clock.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { Keypair } from "@solana/web3.js";
import { createServerlessProvider, redactLogEvent, type ServerlessProviderOptions } from "../src/serverless.js";
import type { PgPool } from "../src/postgres.js";
import type { Upstream } from "../src/upstream.js";
import { configFile, fakeChain, paymentHeader, provider, singleCallHeaders } from "./helpers.js";

pinLaunchRateClock();

const KEY_ENV = "HUMANISER_KEYPAIR";
const PROMPT_ENV = "HUMANISER_PROMPT";
const keyEnv = () => JSON.stringify([...provider.secretKey]);
const unusedPool: PgPool = {
  query: async () => {
    throw new Error("no database in this test");
  },
  connect: async () => {
    throw new Error("no database in this test");
  },
};

function options(overrides: Partial<ServerlessProviderOptions> = {}): ServerlessProviderOptions {
  return {
    file: configFile({ publicUrl: "https://providers.example.com/humaniser" }),
    env: { [KEY_ENV]: keyEnv(), [PROMPT_ENV]: "Rewrite the text so it reads like a person wrote it." },
    pool: unusedPool,
    keyEnv: KEY_ENV,
    promptEnv: PROMPT_ENV,
    basePath: "/humaniser",
    chain: fakeChain(),
    ...overrides,
  };
}

const refused = (o: ServerlessProviderOptions) => {
  const result = createServerlessProvider(o);
  assert.equal(result.ok, false);
  return (result as { message: string }).message;
};

test("starts with its key and private prompt from the environment", () => {
  const result = createServerlessProvider(options());
  assert.ok(result.ok);
  assert.equal(result.provider.config.wallet, provider.publicKey.toBase58());
});

test("a missing or blank prompt variable is refused, naming the variable", () => {
  assert.match(refused(options({ env: { [KEY_ENV]: keyEnv() } })), /HUMANISER_PROMPT/);
  assert.match(refused(options({ env: { [KEY_ENV]: keyEnv(), [PROMPT_ENV]: "   " } })), /HUMANISER_PROMPT/);
});

test("a systemPromptFile in the config is never read", () => {
  const file = { ...configFile({ publicUrl: "https://providers.example.com/humaniser" }), systemPromptFile: "/etc/passwd" };
  const result = createServerlessProvider(options({ file }));
  assert.ok(result.ok);
});

test("a key that is missing, malformed or for another wallet is refused without echoing it", () => {
  assert.match(refused(options({ env: { [PROMPT_ENV]: "p" } })), /HUMANISER_KEYPAIR/);
  const secret = "[1,2,3]";
  const message = refused(options({ env: { [KEY_ENV]: secret, [PROMPT_ENV]: "p" } }));
  assert.ok(!message.includes(secret));
  const other = JSON.stringify([...Keypair.generate().secretKey]);
  const otherMessage = refused(options({ env: { [KEY_ENV]: other, [PROMPT_ENV]: "p" } }));
  assert.ok(!otherMessage.includes(other));
});

test("sessions, the refund-account subsidy and mock answers on mainnet are refused", () => {
  assert.match(refused(options({ file: configFile({ publicUrl: "https://providers.example.com/humaniser", sessions: { enabled: true } } as never) })), /sessions/);
  assert.match(refused(options({ file: configFile({ publicUrl: "https://providers.example.com/humaniser", refundAccountSubsidy: { maxPerDay: 5 } } as never) })), /refundAccountSubsidy/);
});

test("a real model without its key is refused, naming the variable", () => {
  const file = configFile({ publicUrl: "https://providers.example.com/humaniser", upstream: { mock: false, baseUrl: "https://upstream.example.com/v1", apiKeyEnv: "UPSTREAM_KEY" } } as never);
  assert.match(refused(options({ file })), /UPSTREAM_KEY/);
  assert.ok(createServerlessProvider(options({ file, env: { ...options().env, UPSTREAM_KEY: "k" } })).ok);
});

test("a mount path must be well formed and match the public URL", () => {
  assert.match(refused(options({ basePath: "/Humaniser" })), /basePath/);
  assert.match(refused(options({ basePath: "humaniser" })), /basePath/);
  assert.match(refused(options({ basePath: "/writing-style" })), /publicUrl must end with \/writing-style/);
});

test("routes under its mount path and nowhere else", async () => {
  const result = createServerlessProvider(options());
  assert.ok(result.ok);
  const { handle } = result.provider;
  const metadata = await handle(new Request("https://providers.example.com/humaniser/.well-known/reddi-agent.json"));
  assert.equal(metadata.status, 200);
  const body = (await metadata.json()) as Record<string, unknown>;
  assert.ok(!JSON.stringify(body).includes("Rewrite the text"), "the private prompt is not published");
  assert.equal((await handle(new Request("https://providers.example.com/humaniser/v1/models"))).status, 200);
  assert.equal((await handle(new Request("https://providers.example.com/writing-style/v1/models"))).status, 404);
  assert.equal((await handle(new Request("https://providers.example.com/humaniserx/v1/models"))).status, 404);
});

test("the sweep reads nothing from a chain on another cluster", async () => {
  const chain = fakeChain();
  chain.genesis = "1".repeat(44);
  const events: Record<string, unknown>[] = [];
  const result = createServerlessProvider(options({ chain, log: (e) => events.push(e) }));
  assert.ok(result.ok);
  await result.provider.sweep();
  assert.ok(events.some((e) => e.event === "cluster_check_failed" && e.alert === true));
});

test("log events never carry a URL, so an RPC key in one cannot reach the host's logs", () => {
  const event = { event: "sweep_failed", error: "fetch failed: https://mainnet.helius-rpc.com/?api-key=SECRET (reason)", nested: { at: ["wss://x.example/k?token=T"] }, n: 3 };
  const out = JSON.stringify(redactLogEvent(event));
  assert.ok(!out.includes("SECRET") && !out.includes("helius") && !out.includes("token=T"));
  assert.match(out, /https:\/\/\[redacted\] \(reason\)/);
  assert.equal((redactLogEvent(event) as { n: number }).n, 3);
});

const url = process.env.RAP_TEST_DATABASE_URL;
if (!url && process.env.CI) throw new Error("RAP_TEST_DATABASE_URL is not set: the Postgres tests must run in CI");
const pool = url ? new pg.Pool({ connectionString: url, max: 5 }) : undefined;
test.after(async () => {
  await pool?.end();
});

test("a paid call through the mount path is answered, with the private prompt sent to the model", { skip: !url ? "set RAP_TEST_DATABASE_URL" : false }, async () => {
  const seen: unknown[] = [];
  const upstream: Upstream = {
    async createChatCompletion(request) {
      seen.push(request);
      return { id: "c1", choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 120, completion_tokens: 333 } };
    },
  };
  const result = createServerlessProvider(options({ pool: pool as unknown as PgPool, providerId: `test-${randomUUID()}`, upstream, file: configFile({ publicUrl: "https://providers.example.com/humaniser", upstream: { mock: false, baseUrl: "https://upstream.example.com/v1", apiKeyEnv: "UPSTREAM_KEY" } } as never), env: { [KEY_ENV]: keyEnv(), [PROMPT_ENV]: "Rewrite the text so it reads like a person wrote it.", UPSTREAM_KEY: "k" } }));
  assert.ok(result.ok, result.ok ? "" : result.message);
  const BODY = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(400) }] });
  const response = await result.provider.handle(new Request("https://providers.example.com/humaniser/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x402-payment": paymentHeader(), ...(await singleCallHeaders(BODY, Date.now())) }, body: BODY }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(JSON.stringify(seen[0]), /reads like a person wrote it/);
});
