/**
 * The model behind the provider: any server that speaks the OpenAI chat
 * completions API (OpenRouter, a hosted API, a local Ollama or vLLM).
 */
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
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
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
      if (!response.ok) throw new UpstreamError(`the model answered with status ${response.status}`);
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
