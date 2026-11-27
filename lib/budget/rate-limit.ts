/**
 * Server only. Durable rate limits for the Budget routes (#1204, task list
 * line 13, S2-claude-06): counters in the database (`budget_rate_hit`,
 * migration 20261126141000), so a limit holds across every server instance,
 * not per warm instance as the in-memory limiter in `lib/try/http` does (that
 * one still runs first, as a cheap guard).
 *
 * Each route has limits per client address, and where it can name them, per
 * Budget key and per payer, sized well below the route's global limit so a
 * few clients cannot use the whole allowance. Client addresses are hashed
 * before they are stored.
 *
 * When the counters cannot be reached: opening a Budget on mainnet is refused
 * (fail closed); everything else goes ahead, so a database outage never stops
 * a payer from closing or disputing, or an agent mid-task.
 */

import { createHash } from "crypto";
import { rpcClientKey } from "@/lib/rpc/rate-limit";
import type { BudgetNetwork } from "./network";

export type BudgetRoute = "prepare" | "start" | "read" | "chat";
type Scope = "ip" | "key" | "payer" | "global";
type Rule = { scope: Scope; windowSeconds: number; limit: number };

/** The limits. `read` covers status, activate, action and dispute: the page polls status every few seconds. */
export const BUDGET_RATE_RULES: Record<BudgetRoute, Rule[]> = {
  prepare: [
    { scope: "ip", windowSeconds: 3_600, limit: 30 },
    { scope: "global", windowSeconds: 3_600, limit: 600 },
  ],
  start: [
    { scope: "ip", windowSeconds: 3_600, limit: 10 },
    { scope: "payer", windowSeconds: 3_600, limit: 6 },
    { scope: "global", windowSeconds: 3_600, limit: 200 },
  ],
  read: [{ scope: "ip", windowSeconds: 60, limit: 120 }],
  chat: [
    { scope: "key", windowSeconds: 60, limit: 60 },
    { scope: "ip", windowSeconds: 60, limit: 240 },
  ],
};

/** Counts one hit; answers the seconds to wait (0: allowed), or "unavailable". */
export type DurableCounter = (bucket: string, windowSeconds: number, limit: number) => Promise<number | "unavailable">;

/**
 * The counter on Supabase, reached with the same credentials as the custody
 * store of that network: on devnet the service key and the public schema; on
 * mainnet the mainnet app role's token in the `budget_mainnet` schema, never
 * the service key (#1205). Undefined when those are not configured.
 */
export function supabaseCounter(network: BudgetNetwork, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): DurableCounter | undefined {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!url || !/^https:\/\//.test(url)) return undefined;
  let headers: Record<string, string>;
  if (network === "solana-mainnet-beta") {
    const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const token = env.BUDGET_CUSTODY_ROLE_TOKEN?.trim();
    const schema = env.BUDGET_CUSTODY_SCHEMA?.trim();
    if (!anon || !token || schema !== "budget_mainnet") return undefined;
    headers = { apikey: anon, authorization: `Bearer ${token}`, "content-profile": schema };
  } else {
    const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!key) return undefined;
    headers = { apikey: key, authorization: `Bearer ${key}` };
  }
  return async (bucket, windowSeconds, limit) => {
    try {
      const response = await fetchImpl(`${url}/rest/v1/rpc/budget_rate_hit`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return "unavailable";
      const wait = await response.json();
      return typeof wait === "number" && Number.isInteger(wait) && wait >= 0 ? wait : "unavailable";
    } catch {
      return "unavailable";
    }
  };
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

/**
 * A 429 (or, for a mainnet open with no counters, a 503) when this request is
 * over a limit, else undefined. `key` is the Budget key's record id, `payer`
 * the payer's wallet, when the route knows them.
 */
export async function budgetRateLimited(
  request: Request,
  route: BudgetRoute,
  input: { network: BudgetNetwork; counter: DurableCounter | undefined; key?: string; payer?: string; headers?: Record<string, string> },
): Promise<Response | undefined> {
  const failClosed = input.network === "solana-mainnet-beta" && (route === "prepare" || route === "start");
  const refuse = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { code, message }, charged: false }), { status, headers: { ...JSON_HEADERS, ...(input.headers ?? {}), ...extra } });
  if (!input.counter) return failClosed ? refuse(503, "rate_limit_unavailable", "New Budgets are paused for a moment. Nothing was signed; try again shortly.") : undefined;
  const values: Record<Scope, string | undefined> = { ip: rpcClientKey(request.headers), key: input.key, payer: input.payer, global: "all" };
  for (const rule of BUDGET_RATE_RULES[route]) {
    const value = values[rule.scope];
    if (!value) continue;
    const wait = await input.counter(`${input.network}:${route}:${rule.scope}:${hash(value)}`, rule.windowSeconds, rule.limit);
    if (wait === "unavailable") {
      if (failClosed) return refuse(503, "rate_limit_unavailable", "New Budgets are paused for a moment. Nothing was signed; try again shortly.");
      continue;
    }
    if (wait > 0) {
      const who = rule.scope === "global" ? "Everyone together has" : rule.scope === "key" ? "This Budget key has" : rule.scope === "payer" ? "This wallet has" : "This client has";
      return refuse(429, "rate_limited", `${who} made too many requests. Try again in ${wait} seconds.`, { "retry-after": String(wait) });
    }
  }
  return undefined;
}
