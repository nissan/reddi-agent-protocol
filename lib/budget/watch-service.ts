/**
 * Server only. The Budget watcher as its own deployment (`apps/budget-watch`,
 * #1208, audit 1079ce8 task 8): the watcher and the payer alerts run outside
 * the relay's project, so a fault, a bad deploy or a paused project on the
 * relay's side does not also stop the payer hearing about a reserve or a post
 * while they can still dispute it.
 *
 * One deployment watches one network (`BUDGET_WATCH_NETWORK`), with its own
 * RPC, cron secret and Resend key, all from its own environment, never from a
 * request. It holds no signing key: it reads the chain, reads and updates the
 * custody records, and sends email.
 *
 * The promise it is held to: a payer's alert within 10 minutes of the chain
 * event (`WATCH_ALERT_PROMISE_MS`). A timer outside this project calls the
 * pass every 5 minutes and a pass stops itself after 4, so a healthy watcher
 * keeps it with room; `/api/v1/health` turns red when no complete pass
 * finished inside the promise, and the outside monitor
 * (`ops/budget-watch-worker`) pages the owner then.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import devnetProfile from "@/config/networks/devnet.json";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { defaultAlertSender, type AlertSender } from "./alerts";
import { GENESIS_HASH, budgetCustodyStore, type BudgetCustodyStore, type BudgetNetwork } from "./store";
import { budgetChainReader, budgetLinkOrigin, watchBudgets, type BudgetChainReader } from "./watch";
import { releaseViaSigner } from "./signer-client";

/** Whether this watcher can ask the signer to release no-judge slices (`BUDGET_SIGNER_URL` and `BUDGET_RELEASE_TOKEN`). */
export function releaseConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.BUDGET_SIGNER_URL?.trim() && env.BUDGET_RELEASE_TOKEN?.trim());
}

/** A payer's alert is sent within this long of the chain event. */
export const WATCH_ALERT_PROMISE_MS = 10 * 60 * 1000;

const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

export type WatcherContext = {
  network: BudgetNetwork | undefined;
  programId: PublicKey | undefined;
  chain: BudgetChainReader | undefined;
  store: BudgetCustodyStore | undefined;
  sender: AlertSender;
  origin: string;
  env: Record<string, string | undefined>;
  nowMs?: number;
};

export function watcherNetwork(env: Record<string, string | undefined>): BudgetNetwork | undefined {
  const value = env.BUDGET_WATCH_NETWORK?.trim() || "solana-devnet";
  return value === "solana-devnet" || value === "solana-mainnet-beta" ? value : undefined;
}

/** Devnet's program comes from the repository's devnet profile; mainnet's must be set (`BUDGET_WATCH_PROGRAM_ID`). */
function programFor(network: BudgetNetwork | undefined, env: Record<string, string | undefined>): PublicKey | undefined {
  if (!network) return undefined;
  const configured = env.BUDGET_WATCH_PROGRAM_ID?.trim();
  try {
    if (network === "solana-devnet") return new PublicKey(configured || devnetProfile.programs.escrowProgramId);
    return configured ? new PublicKey(configured) : undefined;
  } catch {
    return undefined;
  }
}

function rpcFor(network: BudgetNetwork | undefined, env: Record<string, string | undefined>): string | undefined {
  const raw = env.BUDGET_WATCH_RPC_URL?.trim() || (network === "solana-devnet" ? DEFAULT_DEVNET_RPC : undefined);
  if (!raw) return undefined;
  try {
    return new URL(raw).protocol === "https:" ? raw : undefined;
  } catch {
    return undefined;
  }
}

let context: WatcherContext | undefined;

export function watcherContext(env: Record<string, string | undefined> = process.env): WatcherContext {
  if (context) return context;
  const network = watcherNetwork(env);
  const programId = programFor(network, env);
  const rpc = rpcFor(network, env);
  context = {
    network,
    programId,
    chain: programId && rpc ? budgetChainReader(new Connection(rpc, "confirmed") as never, programId) : undefined,
    store: budgetCustodyStore(env),
    sender: defaultAlertSender(env),
    origin: budgetLinkOrigin(env),
    env,
  };
  return context;
}

/** Why this deployment cannot watch, or undefined when it can. Names the setting, never a value. */
export function watcherProblem(ctx: WatcherContext): string | undefined {
  if (!ctx.network) return "BUDGET_WATCH_NETWORK is not solana-devnet or solana-mainnet-beta";
  if (!ctx.programId) return "BUDGET_WATCH_PROGRAM_ID is not set or not an address";
  if (!ctx.chain) return "BUDGET_WATCH_RPC_URL is not set or not an https URL";
  if (!ctx.store) return "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set";
  if (!ctx.env.RESEND_API_KEY?.trim() || !ctx.env.BUDGET_ALERT_FROM?.trim()) return "RESEND_API_KEY or BUDGET_ALERT_FROM is not set: no payer could be told anything";
  if (!ctx.env.BUDGET_OPS_EMAIL?.trim()) return "BUDGET_OPS_EMAIL is not set: the operator could not be told anything";
  return undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * One watcher pass over this deployment's network. Only with
 * `BUDGET_WATCH_CRON_SECRET`. Answers 503 when the deployment is not set up,
 * its RPC is on another cluster, any Budget could not be watched, the pass ran
 * out of time or an operator alert is still undelivered, so the timer's run
 * fails visibly. The body carries counts and per-Budget reports, no contact
 * details.
 */
export async function handleWatchCron(req: Request, ctx: WatcherContext): Promise<Response> {
  const secret = ctx.env.BUDGET_WATCH_CRON_SECRET?.trim();
  if (!secret) return json({ ok: false, code: "cron_not_configured" }, 503);
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return json({ ok: false, code: "unauthorized" }, 401);
  const problem = watcherProblem(ctx);
  if (problem || !ctx.network || !ctx.programId || !ctx.chain || !ctx.store) return json({ ok: false, code: "not_configured", problem }, 503);
  // Before anything is read as a Budget: this deployment's RPC must serve its own network.
  let genesis: string;
  try {
    genesis = await ctx.chain.genesisHash();
  } catch {
    return json({ ok: false, code: "rpc_unavailable", network: ctx.network }, 503);
  }
  if (genesis !== GENESIS_HASH[ctx.network]) return json({ ok: false, code: "wrong_cluster", network: ctx.network }, 503);
  const release = releaseConfigured(ctx.env) ? (input: { id: string; payee: string }) => releaseViaSigner(input, { env: ctx.env }) : undefined;
  const reports = await watchBudgets({ store: ctx.store, chain: ctx.chain, programId: ctx.programId, sender: ctx.sender, origin: ctx.origin, env: ctx.env, network: ctx.network, ...(release ? { release } : {}), ...(ctx.nowMs !== undefined ? { nowMs: ctx.nowMs } : {}) });
  const errors = reports.filter((r) => r.error);
  const ok = reports.complete !== false && errors.length === 0 && !reports.operatorAlertsUndelivered;
  return json(
    { ok, network: ctx.network, complete: reports.complete !== false, operatorAlertsUndelivered: reports.operatorAlertsUndelivered === true, budgets: reports.length, errors: errors.length, alerts: reports.reduce((n, r) => n + r.alerts.length, 0), reports },
    ok ? 200 : 503,
  );
}

/**
 * For the outside monitor. 200 when this network's watcher finished a
 * complete, error-free pass inside the alert promise, 503 otherwise. Public:
 * it says how old that pass is and what the promise is, nothing about any
 * Budget, and never a setting's value.
 */
export async function handleWatchHealth(ctx: WatcherContext): Promise<Response> {
  const problem = watcherProblem(ctx);
  const base = { network: ctx.network ?? null, programId: ctx.programId?.toBase58() ?? null, promiseSeconds: WATCH_ALERT_PROMISE_MS / 1000 };
  if (problem || !ctx.store || !ctx.network) return json({ ok: false, ...base, problem: problem ?? "not_configured", lastCompletePassAgeSeconds: null }, 503);
  let at: string | undefined;
  try {
    at = await ctx.store.watchedAt(ctx.network);
  } catch {
    return json({ ok: false, ...base, problem: "store_unavailable", lastCompletePassAgeSeconds: null }, 503);
  }
  const now = ctx.nowMs ?? Date.now();
  const ageSeconds = at ? Math.max(0, Math.round((now - Date.parse(at)) / 1000)) : null;
  const ok = ageSeconds !== null && ageSeconds * 1000 <= WATCH_ALERT_PROMISE_MS;
  return json({ ok, ...base, lastCompletePassAgeSeconds: ageSeconds }, ok ? 200 : 503);
}
