/**
 * Server only. The Budget signer project's request handlers (audit round 5,
 * R5-M2; owner decision, 25 November 2026). The signer is its own small
 * Vercel project (`apps/budget-signer`), the only project the KMS issuer is
 * granted to, so no code in the main app can ask KMS to sign. It runs every
 * check of `approveAsSpender` itself, against the custody store, with its own
 * RPC and its own program id: the main app forwards the agent's request and
 * gets back the two instructions, or a refusal.
 *
 * - `/api/v1/approve` answers only the main app (`BUDGET_SIGNER_TOKEN`), and
 *   only for an agent (its secret is checked against the record). There is no
 *   operator path here: the incident close runs in the signer itself.
 * - `/api/v1/incident` is the operator's (`BUDGET_INCIDENT_SECRET`): pause,
 *   or pause and close every open Budget.
 * - `/api/v1/health` says which key and network this signer serves. No secret.
 */

import type { PublicKey } from "@solana/web3.js";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { approveAsSpender, type CustodyDeps, type CustodyFailure } from "./custody";
import { closeAllBudgets, pauseBudgets, readOpsFeePayer, type IncidentChain } from "./incident";
import { encodeApproved, parseApprovalRequest } from "./signer-wire";
import type { BudgetNetwork } from "./store";

export type SignerContext = {
  /** Undefined when the store or the KMS signer is not configured. */
  custody: (CustodyDeps & { network: BudgetNetwork }) | undefined;
  chain: IncidentChain;
  programId: PublicKey;
  env: Record<string, string | undefined>;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function readBody(req: Request, maxBytes: number): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await req.text();
    if (text.length > maxBytes) return undefined;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const STATUS: Record<string, number> = {
  not_authorized: 403,
  unknown_budget_key: 404,
  key_overuse: 429,
  payer_overuse: 429,
  global_overuse: 429,
  budgets_paused: 423,
  custody_not_configured: 503,
  signer_elsewhere: 503,
  chain_unavailable: 503,
  store_unavailable: 503,
  kms_unavailable: 503,
  kms_key_mismatch: 503,
  wrong_cluster: 409,
};

/** How a refusal maps to an HTTP status: client mistakes 400, state 409, the rest as above. */
export function refusalStatus(failure: CustodyFailure): number {
  return STATUS[failure.code] ?? (failure.code.startsWith("invalid_") ? 400 : 409);
}

export async function handleApprove(req: Request, ctx: SignerContext): Promise<Response> {
  const token = ctx.env.BUDGET_SIGNER_TOKEN?.trim();
  if (!token) return json({ ok: false, code: "signer_not_configured", message: "BUDGET_SIGNER_TOKEN is not set." }, 503);
  if (!bearerMatchesSecret(req.headers.get("authorization"), token)) return json({ ok: false, code: "unauthorized", message: "unauthorized" }, 401);
  if (!ctx.custody) return json({ ok: false, code: "custody_not_configured", message: "The signer's store or KMS key is not configured." }, 503);
  const body = await readBody(req, 4096);
  const id = body?.id;
  const agentSecret = body?.agentSecret;
  const request = parseApprovalRequest(body?.request);
  const caller = typeof body?.caller === "string" ? body.caller.slice(0, 120) : undefined;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id) || typeof agentSecret !== "string" || agentSecret.length === 0 || agentSecret.length > 200 || !request) {
    return json({ ok: false, code: "invalid_request", message: 'Send { "id", "agentSecret", "request" }.' }, 400);
  }
  const result = await approveAsSpender({ id, auth: { agentSecret }, request, programId: ctx.programId, ...(caller ? { caller } : {}) }, { ...ctx.custody, chain: ctx.chain });
  if (!result.ok) return json(result, refusalStatus(result));
  return json(encodeApproved(result));
}

export async function handleIncident(req: Request, ctx: SignerContext): Promise<Response> {
  const secret = ctx.env.BUDGET_INCIDENT_SECRET?.trim();
  if (!secret) return json({ ok: false, error: "BUDGET_INCIDENT_SECRET is not configured" }, 503);
  // The main app holds BUDGET_SIGNER_TOKEN; the incident route must need something the app does not have.
  if (secret === ctx.env.BUDGET_SIGNER_TOKEN?.trim()) return json({ ok: false, error: "BUDGET_INCIDENT_SECRET must differ from BUDGET_SIGNER_TOKEN" }, 503);
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await readBody(req, 4096);
  const action = body?.action;
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 300).trim() : "";
  if ((action !== "pause" && action !== "close-all") || !reason) {
    return json({ ok: false, error: 'Send { "action": "pause" | "close-all", "reason": "..." }.' }, 400);
  }
  const deps = ctx.custody;
  if (!deps) return json({ ok: false, error: "budget_custody_not_configured" }, 503);
  if (action === "pause") return json({ ok: await pauseBudgets(reason, deps) });
  const result = await closeAllBudgets({ reason, feePayer: readOpsFeePayer(ctx.env), programId: ctx.programId, chain: ctx.chain }, deps);
  const ok = result.paused && result.unreached.length === 0 && result.results.every((r) => r.ok);
  return json({ ok, ...result }, ok ? 200 : 207);
}

export function handleHealth(ctx: SignerContext): Response {
  return json({
    ok: Boolean(ctx.custody),
    network: ctx.custody?.network ?? null,
    programId: ctx.programId.toBase58(),
    spenderKey: ctx.custody?.signer ? Buffer.from(ctx.custody.signer.publicKey).toString("hex") : null,
  });
}
