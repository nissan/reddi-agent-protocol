/**
 * Providers run apart from the Budget relay (#1203, final security round task 1, AG-M-c).
 *
 * The app project holds the Budget relay. On a mainnet build it must hold nothing of any
 * provider's: no payee key, no provider slice ledger, no payout job. Otherwise one compromised
 * project could both spend a payer's Budget and collect it.
 *
 * - `assertNoProviderSecretsOnMainnet` refuses a mainnet build (next.config.ts) and a mainnet
 *   server start (instrumentation.ts) that carries a sandbox payee key variable, and says why.
 * - `isDevnetOnlyPath` names the pages and API routes that exist only for the devnet sandbox
 *   providers. On a mainnet build `proxy.ts` sends those pages to the devnet app
 *   (`DEVNET_APP_ORIGIN`) when one is configured and answers 404 for the API routes.
 *
 * Plain module with no Next.js or Solana imports, so next.config.ts can load it.
 */
import { resolveNetworkProfileNameFromEnv } from "./network-profile-name";

type Env = Record<string, string | undefined>;

/** Every variable that has ever carried sandbox provider payee keys. */
export const PROVIDER_SECRET_ENV_KEYS = ["SANDBOX_DEVNET_PAYEE_KEYS", "SANDBOX_PAYEE_KEYS"] as const;

export const MAINNET_PROVIDER_SECRET_REFUSAL =
  "This is a mainnet build of the app, which holds the Budget relay, and it carries a provider payee key variable. " +
  "A mainnet app must hold no provider key, ledger or payout job (#1203). Remove the variable from this project's " +
  "Production environment; the devnet sandbox providers run in the devnet app.";

export function isMainnetEnv(env: Env): boolean {
  return resolveNetworkProfileNameFromEnv(env) === "mainnet";
}

/** The provider secret variables set (non-blank) in this environment. Names only, never values. */
export function providerSecretsPresent(env: Env): string[] {
  return PROVIDER_SECRET_ENV_KEYS.filter((key) => (env[key] ?? "").trim() !== "");
}

export function assertNoProviderSecretsOnMainnet(env: Env): void {
  if (!isMainnetEnv(env)) return;
  const present = providerSecretsPresent(env);
  if (present.length > 0) throw new Error(`${MAINNET_PROVIDER_SECRET_REFUSAL} Found: ${present.join(", ")}.`);
}

/** Pages whose payments run only on devnet, through the sandbox providers. */
export const DEVNET_ONLY_PAGE_PREFIXES = ["/try", "/pass", "/planner", "/sandbox"] as const;

/** API routes that serve, settle or pay out the devnet sandbox providers. */
export const DEVNET_ONLY_API_PREFIXES = [
  "/api/try",
  "/api/pass",
  "/api/sandbox",
  "/api/cron/sandbox-budgets",
  "/api/cron/seller-ratings",
] as const;

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isDevnetOnlyPage(pathname: string): boolean {
  return DEVNET_ONLY_PAGE_PREFIXES.some((prefix) => under(pathname, prefix));
}

export function isDevnetOnlyApi(pathname: string): boolean {
  return DEVNET_ONLY_API_PREFIXES.some((prefix) => under(pathname, prefix));
}

/**
 * The devnet app's origin, for sending devnet-only pages there from a mainnet build. Only a
 * plain https origin (no path, query, credentials or port) is taken; anything else is ignored,
 * so the pages answer 404 instead of redirecting somewhere unexpected.
 */
export function devnetAppOrigin(env: Env): string | undefined {
  const raw = env.DEVNET_APP_ORIGIN?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return undefined;
  if (url.pathname !== "/" && url.pathname !== "") return undefined;
  return url.origin;
}
