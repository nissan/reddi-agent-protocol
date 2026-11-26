/**
 * Server only. The providers a Budget can pay, by token (Nissan chose
 * "Both", 25 Nov 2026):
 *
 * - SOL: the devnet sandbox providers that take real devnet payments for
 *   text. The app's own sandbox gateway serves them, so the relay calls them
 *   in process.
 * - USDC: RAP's own providers (the provider kit on `apps/providers`), listed
 *   in `BUDGET_USDC_PROVIDERS` as a JSON array of
 *   `{ id, name, tagline?, model?, url, payee, inputPerMillionUsd, outputPerMillionUsd }`.
 *   `url` is the provider's https chat endpoint, `payee` its wallet. Empty
 *   until those providers are set up; a Budget then holds SOL only.
 *
 * A Budget holds one token, so a provider only shows for the token it is paid in.
 */

import { PublicKey } from "@solana/web3.js";
import { SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import { isMainnetEnv } from "@/lib/config/mainnet-provider-guard";

export type BudgetTokenName = "SOL" | "USDC";

export type BudgetProvider = {
  id: string;
  name: string;
  tagline: string;
  /** The model a call names. */
  model: string;
  /** The provider's wallet: the Budget's allowlist entry and the reservation's payee. */
  payee: string;
  token: BudgetTokenName;
  pricing: { inputPerMillionUsd: string; outputPerMillionUsd: string };
  /** `sandbox`: the app's own gateway. `url`: a provider kit endpoint. */
  endpoint: { kind: "sandbox" } | { kind: "url"; url: string };
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PRICE = /^\d{1,6}(\.\d{1,6})?$/;
const MAX_USDC_PROVIDERS = 8;

function sandboxProviders(): BudgetProvider[] {
  return SANDBOX_PROVIDERS.filter((p) => p.behaviour !== "offline" && !p.simulatedOnly && !p.studio && !p.media).map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    model: p.model,
    payee: p.payTo,
    token: "SOL" as const,
    pricing: { inputPerMillionUsd: p.pricing.inputPerMillionUsd, outputPerMillionUsd: p.pricing.outputPerMillionUsd },
    endpoint: { kind: "sandbox" as const },
  }));
}

/** Parses `BUDGET_USDC_PROVIDERS`. An entry that is not exactly right is left out, never guessed at. */
export function parseUsdcProviders(raw: string | undefined, taken: Set<string> = new Set()): BudgetProvider[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: BudgetProvider[] = [];
  const ids = new Set(taken);
  const payees = new Set<string>();
  for (const entry of parsed.slice(0, MAX_USDC_PROVIDERS)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !ID.test(e.id) || ids.has(e.id)) continue;
    if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 60) continue;
    if (typeof e.payee !== "string" || !BASE58.test(e.payee) || payees.has(e.payee)) continue;
    try {
      new PublicKey(e.payee);
    } catch {
      continue;
    }
    if (typeof e.url !== "string") continue;
    let url: URL;
    try {
      url = new URL(e.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) continue;
    if (typeof e.inputPerMillionUsd !== "string" || !PRICE.test(e.inputPerMillionUsd)) continue;
    if (typeof e.outputPerMillionUsd !== "string" || !PRICE.test(e.outputPerMillionUsd)) continue;
    ids.add(e.id);
    payees.add(e.payee);
    out.push({
      id: e.id,
      name: e.name.trim(),
      tagline: typeof e.tagline === "string" ? e.tagline.slice(0, 120) : "",
      model: typeof e.model === "string" && e.model.trim() ? e.model.trim().slice(0, 100) : e.id,
      payee: e.payee,
      token: "USDC",
      pricing: { inputPerMillionUsd: e.inputPerMillionUsd, outputPerMillionUsd: e.outputPerMillionUsd },
      endpoint: { kind: "url", url: url.toString() },
    });
  }
  return out;
}

/**
 * Every provider a Budget can name, SOL ones first. On a mainnet build only the kit providers in
 * `BUDGET_USDC_PROVIDERS`: the scripted sandbox providers are devnet only (#1203).
 */
export function budgetProviderDirectory(env: Record<string, string | undefined> = process.env): BudgetProvider[] {
  const sol = isMainnetEnv(env) ? [] : sandboxProviders();
  return [...sol, ...parseUsdcProviders(env.BUDGET_USDC_PROVIDERS, new Set(sol.map((p) => p.id)))];
}

export function budgetProviderByPayee(payee: string, env: Record<string, string | undefined> = process.env): BudgetProvider | undefined {
  return budgetProviderDirectory(env).find((p) => p.payee === payee);
}

/** What the page shows of a provider: no endpoint. */
export function budgetProviderView(p: BudgetProvider) {
  return { id: p.id, name: p.name, model: p.model, tagline: p.tagline, payTo: p.payee, token: p.token, pricing: p.pricing };
}
