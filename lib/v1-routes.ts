/**
 * The V1 launch surface: the only pages and API routes a production build serves.
 *
 * Owner decision, 26 November 2026 (issue #1149): everything else in `app/` is
 * a legacy, demo or evidence surface and answers 404 in a production build, so
 * a stale page cannot make a claim V1 does not stand behind and the release
 * security round reviews only what ships. `proxy.ts` enforces this list;
 * `lib/__tests__/v1-routes.test.ts` holds it against the `app/` tree.
 *
 * Local development and the Playwright server keep every route (same rule as
 * `legacyPagesEnabled`), unless V1_ROUTES_ONLY=1 forces the launch surface.
 *
 * A prefix matches itself and anything below it. Static files are not routes
 * and are not listed here.
 */
export const V1_PAGE_PREFIXES = [
  "/budget",
  "/try",
  "/pass",
  "/agent-setup",
  "/agents",
  "/register",
  "/jobs",
  "/dashboard",
  "/sandbox",
  "/start",
  "/planner",
  "/docs",
  "/faq",
  "/adl",
  "/terms",
  "/privacy",
] as const;

export const V1_API_PREFIXES = [
  "/api/auth",
  "/api/budget",
  "/api/cron",
  "/api/jobs",
  "/api/listings",
  "/api/onboarding/capabilities",
  "/api/onboarding/planner",
  "/api/pass",
  "/api/payments",
  "/api/planner/tools",
  "/api/register",
  "/api/registry",
  "/api/rpc",
  "/api/sandbox",
  "/api/try",
] as const;

/** Pages below an allowed prefix that are still not part of V1. */
export const V1_EXCLUDED_PREFIXES = ["/agents/candidates"] as const;

/** Markdown aliases and agent files served from `public/` or by rewrite. */
const FILE_LIKE = /\.[a-z0-9]+$/i;

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function normalisePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** True when a production build serves this path. */
export function isV1Path(pathname: string): boolean {
  const path = normalisePath(pathname);
  if (path === "/") return true;
  if (path.startsWith("/_next/")) return true;
  if (path.startsWith("/api/")) return V1_API_PREFIXES.some((prefix) => under(path, prefix));
  if (V1_EXCLUDED_PREFIXES.some((prefix) => under(path, prefix))) return false;
  if (V1_PAGE_PREFIXES.some((prefix) => under(path, prefix))) return true;
  // Files in public/ (llms.txt, skill.md, images) and the ".md" page aliases.
  return FILE_LIKE.test(path);
}

/** True when only the V1 surface is served: production builds, or V1_ROUTES_ONLY=1. There is no switch that widens a production build. */
export function v1RoutesOnly(env: Record<string, string | undefined> = process.env): boolean {
  if (env.V1_ROUTES_ONLY === "1") return true;
  return env.NODE_ENV === "production";
}
