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
 * - `/api/v1/sign-call` answers the main app the same way: the spender's
 *   signature over one paid call, for a provider the payer named.
 * - `/api/v1/release` answers only the watcher (`BUDGET_RELEASE_TOKEN`, a
 *   secret of its own): it releases one posted slice of a Budget the payer
 *   opened without a judge, and pays it out (`./release`). Nothing else.
 * - `/api/v1/incident` is the operator's (`BUDGET_INCIDENT_SECRET`): pause,
 *   or pause and close every open Budget.
 * - `/api/v1/freeze` is the payer's (#1209): a request signed by the payer's
 *   own wallet stops every further call and reserve approval for one Budget.
 *   No token: the signature is the proof, and all it can do is freeze.
 * - `/api/v1/health` says which key and network this signer serves, and
 *   whether its RPC is on that network. No secret.
 *
 * Two signers run this code, one per network, each a Vercel project of its
 * own (#1205): `./signer-runtime` says what a mainnet signer needs.
 */

import type { PublicKey } from "@solana/web3.js";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { PublicKey as SolanaPublicKey } from "@solana/web3.js";
import { BUDGET_FREEZE_MAX_AGE_SECONDS, BUDGET_FREEZE_MAX_AHEAD_SECONDS, budgetFreezeMessage } from "@redditech/x402-solana/budget-recover";
import { ed25519Verify } from "@redditech/x402-solana/ed25519";
import { approveAsSpender, freezeSpender, signCallAsSpender, type CustodyDeps, type CustodyFailure } from "./custody";
import { addHold, recordFrozen } from "./holds";
import { closeAllBudgets, pauseBudgets, readOpsFeePayer, releaseBudgets, type IncidentChain } from "./incident";
import { budgetJudgeProblem, defaultBudgetJudge } from "./page";
import { releaseSlice } from "./release";
import { encodeApproved, parseApprovalRequest } from "./signer-wire";
import { GENESIS_HASH, type BudgetNetwork } from "./store";

export type SignerContext = {
  /** Undefined when the store or the KMS signer is not configured. */
  custody: (CustodyDeps & { network: BudgetNetwork }) | undefined;
  chain: IncidentChain;
  programId: PublicKey;
  env: Record<string, string | undefined>;
  /** The network `BUDGET_SIGNER_NETWORK` names, or null when it names none this code serves. */
  network?: BudgetNetwork | null;
  /** Why this deployment does not sign, by setting name (`signerProblems`). */
  problems?: string[];
};

/** Contexts whose RPC was seen to serve their network. Only a pass is kept: a failure is checked again. */
const genesisPassed = new WeakSet<SignerContext>();

/**
 * Whether the signer's own RPC serves the network it signs for
 * (RAP-MB3-S4). Asked on the first request and by the health route; every
 * signing route refuses until it has passed.
 */
export async function genesisCheck(ctx: SignerContext): Promise<"ok" | "mismatch" | "unreachable"> {
  const network = ctx.custody?.network ?? ctx.network;
  if (!network) return "mismatch";
  if (genesisPassed.has(ctx)) return "ok";
  try {
    if ((await ctx.chain.genesisHash()) !== GENESIS_HASH[network]) return "mismatch";
  } catch {
    return "unreachable";
  }
  genesisPassed.add(ctx);
  return "ok";
}

async function genesisRefusal(ctx: SignerContext): Promise<Response | undefined> {
  const genesis = await genesisCheck(ctx);
  if (genesis === "ok") return undefined;
  return genesis === "mismatch"
    ? json({ ok: false, code: "wrong_cluster", message: "The signer's RPC does not serve the network it signs for." }, 409)
    : json({ ok: false, code: "chain_unavailable", message: "The signer could not read the chain; try again." }, 503);
}

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
  const offCluster = await genesisRefusal(ctx);
  if (offCluster) return offCluster;
  const result = await approveAsSpender({ id, auth: { agentSecret }, request, programId: ctx.programId, ...(caller ? { caller } : {}) }, { ...ctx.custody, chain: ctx.chain });
  if (!result.ok) return json(result, refusalStatus(result));
  return json(encodeApproved(result));
}

/** One paid call's spender signature (`signCallAsSpender`), for the main app only. */
export async function handleSignCall(req: Request, ctx: SignerContext): Promise<Response> {
  const token = ctx.env.BUDGET_SIGNER_TOKEN?.trim();
  if (!token) return json({ ok: false, code: "signer_not_configured", message: "BUDGET_SIGNER_TOKEN is not set." }, 503);
  if (!bearerMatchesSecret(req.headers.get("authorization"), token)) return json({ ok: false, code: "unauthorized", message: "unauthorized" }, 401);
  if (!ctx.custody) return json({ ok: false, code: "custody_not_configured", message: "The signer's store or KMS key is not configured." }, 503);
  const body = await readBody(req, 2048);
  const call = body?.call as Record<string, unknown> | undefined;
  const id = body?.id;
  const agentSecret = body?.agentSecret;
  const caller = typeof body?.caller === "string" ? body.caller.slice(0, 120) : undefined;
  if (
    typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id) ||
    typeof agentSecret !== "string" || agentSecret.length === 0 || agentSecret.length > 200 ||
    !call || typeof call !== "object" || typeof call.payee !== "string" || typeof call.bodyHash !== "string" ||
    // Only paid calls: the signer numbers them itself, and signs no read or close (audit 2026-11-25, bbe1828).
    (call.action !== undefined && call.action !== "call") || call.sequence !== undefined
  ) {
    return json({ ok: false, code: "invalid_request", message: 'Send { "id", "agentSecret", "call": { "payee", "bodyHash" } }. The signer picks the call number.' }, 400);
  }
  const offCluster = await genesisRefusal(ctx);
  if (offCluster) return offCluster;
  const result = await signCallAsSpender(
    { id, agentSecret, call: { payee: call.payee, bodyHash: call.bodyHash }, ...(caller ? { caller } : {}) },
    ctx.custody,
  );
  if (!result.ok) return json(result, refusalStatus(result));
  return json({ ok: true, budget: result.budget, createdSlot: result.createdSlot.toString(), sequence: result.sequence, publicKey: Buffer.from(result.publicKey).toString("hex"), signature: Buffer.from(result.signature).toString("hex") });
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The watcher releases one posted slice of a Budget without a judge
 * (`./release`). Its token is its own, never the app's or the operator's:
 * all it can do is release what the end of the dispute window would pay.
 */
export async function handleRelease(req: Request, ctx: SignerContext): Promise<Response> {
  const token = ctx.env.BUDGET_RELEASE_TOKEN?.trim();
  if (!token) return json({ ok: false, code: "release_not_configured", message: "BUDGET_RELEASE_TOKEN is not set." }, 503);
  if (token === ctx.env.BUDGET_SIGNER_TOKEN?.trim() || token === ctx.env.BUDGET_INCIDENT_SECRET?.trim()) {
    return json({ ok: false, code: "release_not_configured", message: "BUDGET_RELEASE_TOKEN must differ from BUDGET_SIGNER_TOKEN and BUDGET_INCIDENT_SECRET." }, 503);
  }
  if (!bearerMatchesSecret(req.headers.get("authorization"), token)) return json({ ok: false, code: "unauthorized", message: "unauthorized" }, 401);
  if (!ctx.custody) return json({ ok: false, code: "custody_not_configured", message: "The signer's store or KMS key is not configured." }, 503);
  const body = await readBody(req, 1024);
  const id = body?.id;
  const payee = body?.payee;
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id) || typeof payee !== "string" || !ADDRESS.test(payee)) {
    return json({ ok: false, code: "invalid_request", message: 'Send { "id", "payee" }.' }, 400);
  }
  const offCluster = await genesisRefusal(ctx);
  if (offCluster) return offCluster;
  const result = await releaseSlice({ id, payee, programId: ctx.programId, chain: ctx.chain, env: ctx.env }, ctx.custody);
  if (!result.ok) return json(result, result.code === "fee_payer_not_configured" ? 503 : result.code === "send_failed" ? 502 : refusalStatus(result));
  return json(result);
}
/** What a frozen-by-payer hold says in the log. */
export const PAYER_FREEZE_REASON = "frozen by the payer";

/**
 * A payer freezes their own Budget (#1209, RAP-MB7-S2 and S3): after this the
 * signer signs no call and approves no reserve or waive for it; the close
 * still goes through, and only the operator's incident step lifts the freeze.
 * The request is `budgetFreezeMessage` signed by the payer's wallet, at most
 * ten minutes old. Anything not signed by the Budget's own payer is refused.
 * Sending the same request again changes nothing.
 */
export async function handleFreeze(req: Request, ctx: SignerContext): Promise<Response> {
  const deps = ctx.custody;
  if (!deps) return json({ ok: false, code: "custody_not_configured", message: "The signer's store or KMS key is not configured." }, 503);
  const body = await readBody(req, 1024);
  const { network, budget, payer, issuedAt, signature } = body ?? {};
  const signatureBytes = typeof signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(signature) ? Uint8Array.from(Buffer.from(signature, "base64")) : undefined;
  if (typeof budget !== "string" || !ADDRESS.test(budget) || typeof payer !== "string" || !ADDRESS.test(payer) || typeof issuedAt !== "number" || !Number.isInteger(issuedAt) || signatureBytes?.length !== 64 || (network !== "solana-devnet" && network !== "solana-mainnet-beta")) {
    return json({ ok: false, code: "invalid_request", message: 'Send { "network", "budget", "payer", "issuedAt", "signature" }.' }, 400);
  }
  if (network !== deps.network) return json({ ok: false, code: "wrong_cluster", message: `This signer serves only ${deps.network} Budgets.` }, 409);
  const nowS = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  if (issuedAt < nowS - BUDGET_FREEZE_MAX_AGE_SECONDS || issuedAt > nowS + BUDGET_FREEZE_MAX_AHEAD_SECONDS) {
    return json({ ok: false, code: "request_expired", message: "The freeze request is too old (or dated ahead): sign it again." }, 400);
  }
  // The signature is checked before the store is read, so an unsigned request costs the signer nothing.
  let signed = false;
  try {
    signed = ed25519Verify(new SolanaPublicKey(payer), budgetFreezeMessage({ network, budget, payer, issuedAt }), signatureBytes);
  } catch {
    signed = false;
  }
  const notThePayer = () => json({ ok: false, code: "not_the_payer", message: "Only the Budget's payer can freeze it: the request is not signed by that wallet." }, 403);
  if (!signed) return notThePayer();
  let record;
  try {
    record = await deps.store.byBudget(budget);
  } catch {
    return json({ ok: false, code: "store_unavailable", message: "The signer could not read its records; try again." }, 503);
  }
  // The same answer for a Budget the relay does not hold and for one of another payer: the route says nothing about other payers' Budgets.
  if (!record || record.network !== deps.network || record.payer !== payer) return notThePayer();
  const env = { ...deps.env, ...ctx.env };
  // A log that cannot be read counts as not frozen here, so the freeze is written again rather than skipped.
  const frozenNow = () => recordFrozen(deps.store, record.id, env).catch(() => false);
  if (!(await frozenNow())) {
    // An open record: mark it frozen, write its hold and tell the operator, as any freeze does.
    if (record.status === "open" || record.status === "pending") await freezeSpender(record, PAYER_FREEZE_REASON, deps);
    // The hold is what the signer goes by, whatever the record's status says: make sure it is there.
    if (!(await frozenNow())) {
      const written = await addHold(deps.store, { scope: "spender", spenderId: record.id }, PAYER_FREEZE_REASON, deps.nowMs ?? Date.now()).catch(() => false);
      if (!written) return json({ ok: false, code: "store_unavailable", message: "The freeze could not be written; try again." }, 503);
    }
  }
  return json({ ok: true, budget, frozen: true });
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
  const id = body?.id;
  if (!["pause", "close-all", "resume", "unfreeze"].includes(action as string) || !reason || (action === "unfreeze" && (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)))) {
    return json({ ok: false, error: 'Send { "action": "pause" | "close-all" | "resume" | "unfreeze", "reason": "...", "id" (for unfreeze) }.' }, 400);
  }
  const deps = ctx.custody;
  if (!deps) return json({ ok: false, error: "budget_custody_not_configured" }, 503);
  if (action === "pause") return json({ ok: await pauseBudgets(reason, deps) });
  // Only this route lifts a hold: the main app can ask for a pause but not end one (RT-M2).
  if (action === "resume") return json({ ok: await releaseBudgets({ scope: "all" }, reason, { ...deps, env: { ...deps.env, ...ctx.env } }) });
  if (action === "unfreeze") return json({ ok: await releaseBudgets({ scope: "spender", spenderId: id as string }, reason, { ...deps, env: { ...deps.env, ...ctx.env } }) });
  const result = await closeAllBudgets({ reason, feePayer: readOpsFeePayer(ctx.env), programId: ctx.programId, chain: ctx.chain }, deps);
  const ok = result.paused && result.unreached.length === 0 && result.results.every((r) => r.ok);
  return json({ ok, ...result }, ok ? 200 : 207);
}

export async function handleHealth(ctx: SignerContext): Promise<Response> {
  const network = ctx.custody?.network ?? ctx.network ?? null;
  const genesis = await genesisCheck(ctx);
  return json({
    ok: Boolean(ctx.custody) && genesis === "ok",
    network,
    programId: ctx.programId.toBase58(),
    spenderKey: ctx.custody?.signer ? Buffer.from(ctx.custody.signer.publicKey).toString("hex") : null,
    // Whether the signer's own RPC serves `network` (RAP-MB3-S4).
    genesis,
    // Setting names only, never values.
    problems: ctx.problems ?? [],
    // The judge new Budgets name (audit 1079ce8 S2-claude-16), so a missing or mistyped one shows here.
    judge: defaultBudgetJudge(ctx.env)?.toBase58() ?? null,
    judgeProblem: budgetJudgeProblem(network ?? "solana-devnet", ctx.env) ?? null,
    // Whether this signer can release no-judge slices on completion (`./release`): setting names only.
    releaseProblems: [
      ...(ctx.env.BUDGET_RELEASE_TOKEN?.trim() ? [] : ["BUDGET_RELEASE_TOKEN"]),
      ...(readOpsFeePayer(ctx.env) ? [] : ["BUDGET_OPS_FEE_PAYER"]),
    ],
  });
}
