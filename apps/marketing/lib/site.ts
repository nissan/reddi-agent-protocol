// Environment resolution for the marketing site (WEB-08, hardened in WEB-10).
// Pure helpers take an env record so tests can exercise every combination.

export type SiteEnv = Record<string, string | undefined>;

// Drafts and approved posts are shown only where a reviewer is expected: Vercel preview and
// development deployments, local `next dev`, or when SITE_SHOW_DRAFTS=1 is set explicitly.
// Any other production build, on Vercel or elsewhere, hides them.
export function resolveShowDrafts(env: SiteEnv): boolean {
  if (env.SITE_SHOW_DRAFTS === "1") return true;
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") return true;
  if (!env.VERCEL_ENV && env.NODE_ENV !== "production") return true;
  return false;
}

// The one public host (WEB-45). The project's `*.vercel.app` production alias can serve the same
// pages; every page names this origin as canonical so they never count as duplicates, whichever host answered.
export const APEX_ORIGIN = "https://agent-protocol.reddi.tech";

// Canonical origin: an explicit NEXT_PUBLIC_SITE_URL wins; a Vercel production build is always the apex (WEB-45: it no longer
// depends on which production alias Vercel reports); previews use their own deployment URL so draft links never point at a
// production 404.
export function resolveSiteUrl(env: SiteEnv): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (env.VERCEL_ENV === "production") return APEX_ORIGIN;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

// WEB-15: the one launch switch. Search engines may index the site ONLY when both hold: the build is a Vercel
// production deployment (VERCEL_ENV === "production") and the owner has set SITE_PUBLIC=1 on that environment.
// Everything else keeps `X-Robots-Tag: noindex, nofollow` and the robots metadata: previews, local builds, production
// without the variable, and any build that shows drafts. Read at build time (next.config.ts and the root layout), so
// changing the variable needs a redeploy. Draft posts and the newsletter state pages carry their own noindex regardless.
export function resolveIndexable(env: SiteEnv): boolean {
  if (resolveShowDrafts(env)) return false;
  return env.VERCEL_ENV === "production" && env.SITE_PUBLIC === "1";
}

// The robots.txt rules for a given switch state (app/robots.ts calls this): everything disallowed unless the site is
// indexable; once it is, the public pages are open, the API, the emailed-link pages and the internal design page stay
// out (they also carry their own noindex) and the sitemap is announced on the canonical origin.
export function robotsRules(isIndexable: boolean, origin: string) {
  if (!isIndexable) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/newsletter/"] }, sitemap: `${origin}/sitemap.xml` };
}

export const showDrafts: boolean = resolveShowDrafts(process.env);
export const indexable: boolean = resolveIndexable(process.env);
// Kept for callers that think in terms of "production"; true means drafts are hidden.
export const isProduction: boolean = !showDrafts;
export const siteUrl: string = resolveSiteUrl(process.env);
