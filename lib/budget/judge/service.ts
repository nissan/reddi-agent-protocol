/**
 * Server only. The RAP judge project's request handlers (`apps/budget-judge`).
 * The judge is its own Vercel project, the only one its KMS issuer is granted
 * to, so no code in the main app or the Budget signer can sign a ruling.
 *
 * - `/api/v1/health`: the judge's address, network, program, balance and
 *   whether it can rule. Public, no secret.
 * - `/api/cron/judge`: one pass (`./pass`). `BUDGET_JUDGE_CRON_SECRET`.
 * - `/api/v1/evidence`: a provider sends its signed receipt for a disputed
 *   slice. Public: the receipt must verify for that slice before it is kept.
 * - `/api/v1/ops`: Nissan's override (hold, release, rule by hand).
 *   `BUDGET_JUDGE_OPS_SECRET`.
 */

import { PublicKey } from "@solana/web3.js";
import { decodeBudget, decodeReservation, reservationAddress } from "@redditech/x402-solana/budget";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import type { JudgeChain } from "./chain";
import type { JudgeSigner } from "./kms";
import { runJudgePass, ruleByHand, type JudgeDeps } from "./pass";
import { MAX_RECEIPT_CHARS, readSliceReceipt, type JudgeNetwork } from "./receipts";
import { appendOverride, type JudgeStore, type SliceKey } from "./store";
import { JUDGE_RULE_VERSION } from "./rule";

export type JudgeContext = {
  network: JudgeNetwork | undefined;
  programId: PublicKey | undefined;
  chain: JudgeChain | undefined;
  store: JudgeStore | undefined;
  signer: JudgeSigner | undefined;
  /** The judge's address, even when it cannot sign (health shows it). */
  address: PublicKey | undefined;
  env: Record<string, string | undefined>;
  notify(subject: string, text: string): Promise<boolean>;
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
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

/** Everything a pass needs, or the reason it cannot run. */
export function judgeDeps(ctx: JudgeContext): JudgeDeps | string {
  if (!ctx.network || !ctx.programId) return "network_not_configured";
  if (!ctx.chain) return "chain_not_configured";
  if (!ctx.store) return "store_not_configured";
  if (!ctx.signer) return "key_not_configured";
  return { chain: ctx.chain, store: ctx.store, signer: ctx.signer, programId: ctx.programId, network: ctx.network, env: ctx.env, notify: ctx.notify };
}

export async function handleHealth(ctx: JudgeContext): Promise<Response> {
  const deps = judgeDeps(ctx);
  let balanceLamports: number | null = null;
  if (ctx.chain && ctx.address) {
    try {
      balanceLamports = await ctx.chain.balance(ctx.address);
    } catch {
      balanceLamports = null;
    }
  }
  return json({
    ok: typeof deps !== "string",
    ...(typeof deps === "string" ? { problem: deps } : {}),
    network: ctx.network ?? null,
    programId: ctx.programId?.toBase58() ?? null,
    judge: ctx.address?.toBase58() ?? null,
    rule: JUDGE_RULE_VERSION,
    balanceLamports,
    opsOverride: Boolean(ctx.env.BUDGET_JUDGE_OPS_SECRET && ctx.env.BUDGET_JUDGE_OPS_SECRET.trim().length >= 32),
  });
}

export async function handleCron(req: Request, ctx: JudgeContext): Promise<Response> {
  const secret = ctx.env.BUDGET_JUDGE_CRON_SECRET?.trim();
  if (!secret) return json({ ok: false, code: "cron_not_configured" }, 503);
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return json({ ok: false, code: "unauthorized" }, 401);
  const deps = judgeDeps(ctx);
  if (typeof deps === "string") return json({ ok: false, code: deps }, 503);
  const result = await runJudgePass(deps);
  return json(result, result.ok ? 200 : 500);
}

/** A provider's receipt for a disputed slice: kept only when it verifies for that slice, which names this judge. */
export async function handleEvidence(req: Request, ctx: JudgeContext): Promise<Response> {
  const deps = judgeDeps(ctx);
  if (typeof deps === "string") return json({ ok: false, code: deps }, 503);
  const body = await readBody(req, MAX_RECEIPT_CHARS + 512);
  const budget = body?.budget;
  const payee = body?.payee;
  const receipt = body?.receipt;
  if (typeof budget !== "string" || !BASE58.test(budget) || typeof payee !== "string" || !BASE58.test(payee) || typeof receipt !== "string" || receipt.length > MAX_RECEIPT_CHARS) {
    return json({ ok: false, code: "invalid_request", message: 'Send { "budget", "payee", "receipt" } with the receipt as its header value (base64url JSON).' }, 400);
  }
  const budgetKey = new PublicKey(budget);
  const payeeKey = new PublicKey(payee);
  try {
    const sliceAccount = await deps.chain.readAccount(reservationAddress(budgetKey, payeeKey, deps.programId));
    const budgetAccount = await deps.chain.readAccount(budgetKey);
    if (!sliceAccount || !budgetAccount || !sliceAccount.owner.equals(deps.programId) || !budgetAccount.owner.equals(deps.programId)) return json({ ok: false, code: "slice_not_found" }, 404);
    const reservation = decodeReservation(sliceAccount.data);
    const onChain = decodeBudget(budgetAccount.data);
    if (reservation.budgetCreatedSlot !== onChain.createdSlot || !reservation.payee.equals(payeeKey)) return json({ ok: false, code: "slice_not_found" }, 404);
    if (!onChain.judge || !onChain.judge.equals(deps.signer.address)) return json({ ok: false, code: "not_this_judge", message: "This Budget names another judge, or none." }, 409);
    if (reservation.state !== "disputed") return json({ ok: false, code: "not_disputed", message: `This slice is ${reservation.state}.` }, 409);
    const slice: SliceKey = { budget, createdSlot: onChain.createdSlot.toString(), payee };
    const read = readSliceReceipt(receipt, { network: deps.network, ...slice, reservation: reservationAddress(budgetKey, payeeKey, deps.programId).toBase58(), payer: onChain.payer.toBase58() });
    if (!read.ok) return json({ ok: false, code: read.reason, message: "The receipt does not verify for this slice." }, 422);
    if (!(await deps.store.addReceipt(slice, "provider", receipt))) return json({ ok: false, code: "store_unavailable" }, 503);
    return json({ ok: true, served: read.receipt.served, cumulativeCost: read.receipt.cumulativeCost.toString() });
  } catch {
    return json({ ok: false, code: "chain_unavailable" }, 503);
  }
}

/** Nissan's override. `{ action: "hold" | "release", budget, payee, reason }` or `{ action: "rule", budget, payee, payout, reason }`. */
export async function handleOps(req: Request, ctx: JudgeContext): Promise<Response> {
  const secret = ctx.env.BUDGET_JUDGE_OPS_SECRET?.trim();
  if (!secret || secret.length < 32) return json({ ok: false, code: "ops_not_configured" }, 503);
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return json({ ok: false, code: "unauthorized" }, 401);
  const deps = judgeDeps(ctx);
  if (typeof deps === "string") return json({ ok: false, code: deps }, 503);
  const body = await readBody(req, 4096);
  const action = body?.action;
  const budget = body?.budget;
  const payee = body?.payee;
  const reason = typeof body?.reason === "string" ? body.reason : "";
  if ((action !== "hold" && action !== "release" && action !== "rule") || typeof budget !== "string" || !BASE58.test(budget) || typeof payee !== "string" || !BASE58.test(payee)) {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  if (action === "rule") {
    const payout = typeof body?.payout === "string" && /^(0|[1-9][0-9]{0,19})$/.test(body.payout) ? BigInt(body.payout) : undefined;
    if (payout === undefined) return json({ ok: false, code: "invalid_payout", message: "payout is a decimal string of base units." }, 400);
    const result = await ruleByHand({ budget, payee, payout, reason }, deps);
    return json(result, result.status === "ruled" ? 200 : 409);
  }
  try {
    const account = await deps.chain.readAccount(new PublicKey(budget));
    if (!account || !account.owner.equals(deps.programId)) return json({ ok: false, code: "budget_not_found" }, 404);
    const slice: SliceKey = { budget, createdSlot: decodeBudget(account.data).createdSlot.toString(), payee };
    const ok = await appendOverride(deps.store, slice, action, reason || action, deps.env);
    return json({ ok, action, ...slice }, ok ? 200 : 409);
  } catch {
    return json({ ok: false, code: "store_unavailable" }, 503);
  }
}
