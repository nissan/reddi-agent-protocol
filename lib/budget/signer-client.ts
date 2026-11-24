/**
 * Server only. The main app's side of the Budget signer (`./signer-service`):
 * it forwards an agent's approval request to the signer project and checks
 * what comes back is the precompile and a call to our own program, for the
 * purpose asked. The main app holds no KMS grant, so this is the only way it
 * gets a Budget approval.
 *
 * `BUDGET_SIGNER_URL` is the signer's https origin and `BUDGET_SIGNER_TOKEN`
 * the bearer secret it expects; both come from the environment, never from a
 * request.
 */

import type { PublicKey } from "@solana/web3.js";
import type { ApprovalRequest, Approved, CustodyFailure } from "./custody";
import { decodeApproved, encodeApprovalRequest } from "./signer-wire";

export const SIGNER_TIMEOUT_MS = 20_000;

export type SignerConfig = { origin: string; token: string };

/** The signer's origin and token, or undefined while either is unset or the URL is not a bare https origin. */
export function readSignerConfig(env: Record<string, string | undefined> = process.env): SignerConfig | undefined {
  const token = env.BUDGET_SIGNER_TOKEN?.trim();
  const raw = env.BUDGET_SIGNER_URL?.trim();
  if (!token || !raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return undefined;
  return { origin: url.origin, token };
}

const fail = (code: string, message: string): CustodyFailure => ({ ok: false, code, message });

export async function approveViaSigner(
  input: { id: string; agentSecret: string; request: ApprovalRequest; caller?: string },
  options: { programId: PublicKey; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<Approved | CustodyFailure> {
  const config = readSignerConfig(options.env ?? process.env);
  if (!config) return fail("signer_not_configured", "Budget approvals are not set up: BUDGET_SIGNER_URL or BUDGET_SIGNER_TOKEN is missing.");
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${config.origin}/api/v1/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ id: input.id, agentSecret: input.agentSecret, request: encodeApprovalRequest(input.request), ...(input.caller ? { caller: input.caller.slice(0, 120) } : {}) }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? SIGNER_TIMEOUT_MS),
    });
  } catch {
    return fail("signer_unavailable", "The Budget signer could not be reached; try again.");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fail("signer_unavailable", `The Budget signer answered ${response.status} without JSON.`);
  }
  if (response.ok) {
    const approved = decodeApproved(body, { programId: options.programId, purpose: input.request.purpose });
    return approved ?? fail("signer_bad_answer", "The Budget signer sent back something other than the approval asked for; nothing was used.");
  }
  const refusal = body as { code?: unknown; message?: unknown };
  const code = typeof refusal?.code === "string" && /^[a-z_]{1,40}$/.test(refusal.code) ? refusal.code : "signer_refused";
  const message = typeof refusal?.message === "string" ? refusal.message.slice(0, 300) : `The Budget signer refused (${response.status}).`;
  return fail(code, message);
}
