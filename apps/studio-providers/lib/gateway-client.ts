/**
 * Signed calls from one studio desk to the GPU gateway (apps/gpu-gateway). Each request carries the
 * desk's name, a timestamp, a fresh nonce and an HMAC-SHA256 over them, the method, the path and the
 * body's hash, so the gateway can tell the four desks apart and refuse replays.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

export interface GatewayFile {
  size: number;
  sha256: string;
  type: string;
  hosted_until: string;
}

export interface GatewayTask {
  task: string;
  desk: string;
  budget: string;
  kind: string;
  status: "queued" | "running" | "ready" | "failed" | "refused" | "cancelled";
  stage: string;
  progress: number | null;
  eta_s: number | null;
  error: string;
  files: Record<string, GatewayFile>;
}

export class GatewayError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GatewayClient {
  createTask(budget: string, job: unknown): Promise<GatewayTask>;
  getTask(task: string): Promise<GatewayTask>;
  link(task: string, file: string, ttlS?: number): Promise<{ url: string; expires: number }>;
  fileBytes(task: string, file: string): Promise<Uint8Array>;
  markCollected(task: string): Promise<boolean>;
}

export function signRequest(secret: string, method: string, path: string, body: string, timestamp: string, nonce: string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`).digest("hex");
}

export function createGatewayClient(options: { origin: string; desk: string; secret: string; fetchImpl?: FetchLike; now?: () => number }): GatewayClient {
  const origin = options.origin.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const now = options.now ?? Date.now;

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const timestamp = String(Math.floor(now() / 1000));
    const nonce = randomBytes(18).toString("base64url");
    const headers: Record<string, string> = {
      "x-rap-desk": options.desk,
      "x-rap-timestamp": timestamp,
      "x-rap-nonce": nonce,
      "x-rap-signature": signRequest(options.secret, method, path, raw, timestamp, nonce),
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(origin + path, { method, headers, ...(body === undefined ? {} : { body: raw }), signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new GatewayError("the studio gateway could not be reached", 503);
    }
    return response;
  }

  async function jsonOf<T>(response: Response): Promise<T> {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new GatewayError(body.error || `the studio gateway answered ${response.status}`, response.status);
    return body as T;
  }

  return {
    async createTask(budget, job) {
      return jsonOf<GatewayTask>(await call("POST", "/v1/tasks", { budget, job }));
    },
    async getTask(task) {
      return jsonOf<GatewayTask>(await call("GET", `/v1/tasks/${encodeURIComponent(task)}`));
    },
    async link(task, file, ttlS) {
      const { path, expires } = await jsonOf<{ path: string; expires: number }>(await call("POST", `/v1/tasks/${encodeURIComponent(task)}/link`, { file, ...(ttlS ? { ttl_s: ttlS } : {}) }));
      return { url: origin + path, expires };
    },
    async markCollected(task) {
      return (await jsonOf<{ first: boolean }>(await call("POST", `/v1/tasks/${encodeURIComponent(task)}/collected`, {}))).first;
    },
    async fileBytes(task, file) {
      const response = await call("GET", `/v1/tasks/${encodeURIComponent(task)}/files/${encodeURIComponent(file)}`);
      if (!response.ok) await jsonOf(response);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
