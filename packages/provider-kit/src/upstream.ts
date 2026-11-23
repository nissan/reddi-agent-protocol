/**
 * The model behind the provider: any server that speaks the OpenAI chat
 * completions API (OpenRouter, a hosted API, a local Ollama or vLLM), or
 * Claude through the Anthropic API.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface UpstreamMessage {
  role: string;
  content: string;
}

export interface UpstreamRequest {
  model: string;
  messages: UpstreamMessage[];
  temperature?: number;
  max_tokens: number;
}

export interface Upstream {
  /** Resolves with the upstream's JSON answer. Rejects when there is no usable answer. */
  createChatCompletion(request: UpstreamRequest): Promise<Record<string, unknown>>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class UpstreamError extends Error {
  /** The model's HTTP status, when it answered with one. 429 means it is rate limited. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "UpstreamError";
    if (status !== undefined) this.status = status;
  }
}

export function createOpenAiCompatibleUpstream(options: { baseUrl: string; apiKey?: string; timeoutMs?: number; fetchImpl?: FetchLike }): Upstream {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  return {
    async createChatCompletion(request) {
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
          body: JSON.stringify({ ...request, stream: false }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
        });
      } catch {
        // The cause is not passed on: it can carry the request, key included.
        throw new UpstreamError("the model could not be reached");
      }
      if (!response.ok) throw new UpstreamError(`the model answered with status ${response.status}`, response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new UpstreamError("the model's answer was not JSON");
      }
      const choices = (body as { choices?: unknown } | null)?.choices;
      if (!body || typeof body !== "object" || !Array.isArray(choices) || choices.length === 0) throw new UpstreamError("the model returned no answer");
      return body as Record<string, unknown>;
    },
  };
}

/** A canned answer with a usage report, for trying the payment flow without a model. */
export function createMockUpstream(): Upstream {
  return {
    async createChatCompletion(request) {
      const last = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const content = `Mock answer from ${request.model}. You said: ${last.slice(0, 200)}`;
      const promptTokens = request.messages.reduce((total, m) => total + Math.ceil(m.content.length / 4), 0);
      return {
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: request.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: Math.min(request.max_tokens, Math.ceil(content.length / 4)), total_tokens: 0 },
      };
    },
  };
}

/** How much thinking a Claude model does before it answers. "off" maps to what the model accepts. */
export type ClaudeThinking = "adaptive" | "off";
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** The part of the Anthropic client this upstream uses, so tests can stand in for it. */
export interface AnthropicMessagesLike {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number }): Promise<Anthropic.Message> };
}

/**
 * Claude through the Anthropic Messages API. The answer comes back in the
 * chat completions shape the handler reads, with usage counting every input
 * token (cache reads and writes included) and every output token (thinking
 * included), so the buyer is charged for what the model was paid for.
 */
export function createAnthropicUpstream(options: { apiKey?: string; timeoutMs?: number; effort?: ClaudeEffort; thinking?: ClaudeThinking; client?: AnthropicMessagesLike }): Upstream {
  const client: AnthropicMessagesLike = options.client ?? new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), maxRetries: 1 });
  return {
    async createChatCompletion(request) {
      const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const messages: Anthropic.MessageParam[] = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const thinking = claudeThinking(request.model, options.thinking);
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model: request.model,
            max_tokens: request.max_tokens,
            ...(system ? { system } : {}),
            messages,
            ...(thinking ? { thinking } : {}),
            ...(options.effort ? { output_config: { effort: options.effort } } : {}),
          },
          { timeout: options.timeoutMs ?? 120_000 },
        );
      } catch (error) {
        // Only the status is passed on: the error can carry the request, key included.
        if (error instanceof Anthropic.APIError && typeof error.status === "number") throw new UpstreamError(`the model answered with status ${error.status}`, error.status);
        throw new UpstreamError("the model could not be reached");
      }
      if (message.stop_reason === "refusal") throw new UpstreamError("the model declined to answer");
      const content = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      if (!content) throw new UpstreamError("the model returned no answer");
      const usage = message.usage;
      const promptTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      return {
        id: message.id,
        object: "chat.completion",
        model: message.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: message.stop_reason === "max_tokens" ? "length" : "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: usage.output_tokens, total_tokens: promptTokens + usage.output_tokens },
      };
    },
  };
}

/** Thinking off is spelled differently per model, and Opus 5.5 cannot turn it off (lower the effort instead). */
function claudeThinking(model: string, thinking: ClaudeThinking | undefined): Anthropic.ThinkingConfigParam | undefined {
  if (thinking !== "off") return undefined;
  if (model.startsWith("claude-opus-5-5")) return undefined;
  if (model.startsWith("claude-sonnet-5-5")) return { type: "between_tools" };
  return { type: "disabled" };
}
