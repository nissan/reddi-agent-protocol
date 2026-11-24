/** Server only. Shared bits of the agent pass routes (#1048). */
import { tryError } from "@/lib/try/http";
import { agentPassStore, type AgentPassStore } from "./store";

export const PASS_PAY_PATH = "/api/pass/v1/pay";

/** The pass store, or a 503 when this server has none: no pass is started that could not be kept. */
export function storeOrResponse(headers: Record<string, string> = {}): { ok: true; store: AgentPassStore } | { ok: false; response: Response } {
  const store = agentPassStore();
  return store ? { ok: true, store } : { ok: false, response: tryError(503, "pass_not_configured", "Agent passes are not switched on for this server. Nothing was asked of your wallet.", headers) };
}

/** The `solana:` link for a pass: a Solana Pay transaction request to this app. */
export function passPayLink(origin: string, passId: string): { payUrl: string; solanaPayUrl: string } {
  const payUrl = `${origin}${PASS_PAY_PATH}?p=${encodeURIComponent(passId)}`;
  return { payUrl, solanaPayUrl: `solana:${encodeURIComponent(payUrl)}` };
}

/** OpenAI-style error body, which assistants that speak that API show as is. */
export function passError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message, type: "rap_pass_error" } }, { status, headers: { "cache-control": "no-store" } });
}
