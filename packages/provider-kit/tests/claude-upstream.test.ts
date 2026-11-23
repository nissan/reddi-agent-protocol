import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { parseProviderConfig } from "../src/config.js";
import { runDoctor } from "../src/doctor.js";
import { upstreamFor } from "../src/server.js";
import { createAnthropicUpstream, UpstreamError, type AnthropicMessagesLike } from "../src/upstream.js";
import { config, configFile, fakeChain, provider } from "./helpers.js";

function fakeClaude(reply: Partial<Anthropic.Message> | Error) {
  const calls: Array<{ body: Anthropic.MessageCreateParamsNonStreaming; options?: { timeout?: number } }> = [];
  const client: AnthropicMessagesLike = {
    messages: {
      async create(body, options) {
        calls.push({ body, ...(options ? { options } : {}) });
        if (reply instanceof Error) throw reply;
        return {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: "Hello there.", citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 20, cache_read_input_tokens: 300 },
          ...reply,
        } as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

const request = { model: "claude-sonnet-5-5", max_tokens: 500, temperature: 0.7, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "user", content: "Again" }] };

test("sends system text apart from the turns, drops sampling settings, and counts every input and output token", async () => {
  const { client, calls } = fakeClaude({});
  const answer = await createAnthropicUpstream({ client, effort: "low", timeoutMs: 30_000 }).createChatCompletion(request);
  const { body, options } = calls[0];
  assert.equal(body.system, "Be brief.");
  assert.deepEqual(body.messages, [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "user", content: "Again" }]);
  assert.equal((body as { temperature?: number }).temperature, undefined);
  assert.equal(body.max_tokens, 500);
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal(body.thinking, undefined);
  assert.equal(options?.timeout, 30_000);
  // Cache writes and reads are input the model was paid for; thinking is inside output_tokens.
  assert.deepEqual(answer.usage, { prompt_tokens: 420, completion_tokens: 40, total_tokens: 460 });
  assert.deepEqual((answer.choices as Array<{ message: unknown; finish_reason: string }>)[0], { index: 0, message: { role: "assistant", content: "Hello there." }, finish_reason: "stop" });
});

test("turns thinking off the way each model accepts, and leaves Opus 5.5 on (it cannot be turned off)", async () => {
  const thinkingFor = async (model: string) => {
    const { client, calls } = fakeClaude({});
    await createAnthropicUpstream({ client, thinking: "off" }).createChatCompletion({ ...request, model });
    return calls[0].body.thinking;
  };
  assert.deepEqual(await thinkingFor("claude-haiku-5-5"), { type: "disabled" });
  assert.deepEqual(await thinkingFor("claude-sonnet-5-5"), { type: "between_tools" });
  assert.equal(await thinkingFor("claude-opus-5-5"), undefined);
});

test("a refusal, an empty answer or an API error is no answer, and the error names only the status", async () => {
  const run = (reply: Partial<Anthropic.Message> | Error) => createAnthropicUpstream({ client: fakeClaude(reply).client }).createChatCompletion(request);
  await assert.rejects(run({ stop_reason: "refusal" }), (e: unknown) => e instanceof UpstreamError && /declined/.test(e.message));
  await assert.rejects(run({ content: [] }), (e: unknown) => e instanceof UpstreamError && /no answer/.test(e.message));
  const apiError = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "secret-in-body" } }, "secret-in-body", new Headers());
  await assert.rejects(run(apiError), (e: unknown) => e instanceof UpstreamError && e.message === "the model answered with status 429");
  await assert.rejects(run(new Error("socket hang up sk-ant-xyz")), (e: unknown) => e instanceof UpstreamError && e.message === "the model could not be reached");
  // A cut-off answer is still an answer, marked as such.
  const cut = await run({ stop_reason: "max_tokens" });
  assert.equal((cut.choices as Array<{ finish_reason: string }>)[0].finish_reason, "length");
});

test("config: the anthropic provider needs no base URL, takes effort and thinking, and refuses them elsewhere", () => {
  const claude = parseProviderConfig(configFile({ upstream: { provider: "anthropic", model: "claude-haiku-5-5", effort: "low", thinking: "off", apiKeyEnv: "ANTHROPIC_API_KEY" } }), { ANTHROPIC_API_KEY: "k" });
  assert.ok(claude.ok, claude.ok ? "" : claude.errors.join("\n"));
  assert.deepEqual({ ...claude.config.upstream, apiKey: claude.config.upstream.apiKey ? "set" : "unset" }, { provider: "anthropic", model: "claude-haiku-5-5", apiKey: "set", apiKeyEnv: "ANTHROPIC_API_KEY", mock: false, timeoutMs: 120_000, effort: "low", thinking: "off" });
  const errors = (file: Parameters<typeof configFile>[0]) => { const r = parseProviderConfig(configFile(file), {}); return r.ok ? [] : r.errors; };
  assert.ok(errors({ upstream: { provider: "anthropic", effort: "extreme" } }).some((e) => e.startsWith("upstream.effort")));
  assert.ok(errors({ upstream: { provider: "anthropic", thinking: "sometimes" } }).some((e) => e.startsWith("upstream.thinking")));
  assert.ok(errors({ upstream: { baseUrl: "https://model.example/v1", effort: "low" } }).some((e) => e.startsWith("upstream.effort")));
  assert.ok(errors({ upstream: { provider: "gemini" } }).some((e) => e.startsWith("upstream.provider")));
  // Existing configs keep working and are read as OpenAI-compatible.
  const plain = parseProviderConfig(configFile({ upstream: { baseUrl: "https://model.example/v1" } }), {});
  assert.ok(plain.ok && plain.config.upstream.provider === "openai-compatible");
  assert.ok(upstreamFor(claude.config));
});

test("doctor asks the Anthropic API for the model, and says which key is missing or wrong", async () => {
  const key = { ok: true as const, key: { keypair: provider, signMessage: () => new Uint8Array(64) } };
  const okFetch = async () => ({ ok: true, status: 200 });
  const seen: string[] = [];
  const answer = (status: number): typeof fetch => async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify(status === 200 ? { type: "model", id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-01-01T00:00:00Z" } : { type: "error", error: { type: "authentication_error", message: "bad key" } }), { status, headers: { "content-type": "application/json" } });
  };
  const run = (env: Record<string, string>, anthropicFetch?: typeof fetch) =>
    runDoctor({ config: config({ upstream: { provider: "anthropic", model: "claude-haiku-5-5" }, publicUrl: "https://provider.example" }, env), chain: fakeChain(null), key, fetchImpl: okFetch, canWrite: () => true, ...(anthropicFetch ? { anthropicFetch } : {}) });
  const model = (r: Awaited<ReturnType<typeof runDoctor>>) => r.checks.find((c) => c.name === "Model")!;

  assert.equal(model(await run({ UPSTREAM_API_KEY: "k" }, answer(200))).status, "pass");
  assert.match(seen[0], /\/v1\/models\/claude-haiku-5-5$/);
  const wrong = model(await run({ UPSTREAM_API_KEY: "k" }, answer(401)));
  assert.equal(wrong.status, "fail");
  assert.match(wrong.fix ?? "", /UPSTREAM_API_KEY/);
  const unset = model(await run({}));
  assert.equal(unset.status, "fail");
  assert.match(unset.detail, /UPSTREAM_API_KEY is not set/);
});
