/**
 * Pages that work only through the legacy, demo and file-store API routes.
 *
 * `lib/http/route-gates.ts` turns those routes off (404) in a production build and on the
 * mainnet profile. A page that needs them would load and then fail, so in that case its
 * links are dropped or pointed at the page that replaced it, and `next.config.ts`
 * redirects the page itself there. Local development and the Playwright server keep them.
 *
 * Paths match exactly: `/onboarding/intake` and `/onboarding/profile-editor` use their own
 * routes and stay.
 */
import { resolveNetworkProfileNameFromEnv } from "./config/network-profile-name";

export const LEGACY_PAGE_REPLACEMENTS: Readonly<Record<string, string>> = {
  "/onboarding": "/register",
  "/specialist": "/register",
  "/runs": "/jobs",
  "/audit": "/jobs",
  "/attestation": "/jobs",
  "/orchestrator": "/docs",
  "/demo": "/sandbox",
};

// Read as literals so Next inlines them into the client bundle at build time.
const BUILD_ENV: Record<string, string | undefined> = {
  NODE_ENV: process.env.NODE_ENV,
  NETWORK_PROFILE: process.env.NETWORK_PROFILE,
  NEXT_PUBLIC_BUILD_NETWORK_PROFILE: process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE,
  NEXT_PUBLIC_NETWORK_PROFILE: process.env.NEXT_PUBLIC_NETWORK_PROFILE,
};

/** Same rule as `legacyRoutesEnabled`: off in production builds and on mainnet. */
export function legacyPagesEnabled(env: Record<string, string | undefined> = BUILD_ENV): boolean {
  if (env.NODE_ENV === "production") return false;
  return resolveNetworkProfileNameFromEnv(env) !== "mainnet";
}

export function isLegacyPath(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return Object.prototype.hasOwnProperty.call(LEGACY_PAGE_REPLACEMENTS, path);
}

/** The href to show: unchanged while legacy pages run, otherwise the page that replaced it. */
export function liveHref(href: string, enabled: boolean = legacyPagesEnabled()): string {
  if (enabled || !isLegacyPath(href)) return href;
  return LEGACY_PAGE_REPLACEMENTS[href.split(/[?#]/)[0].replace(/\/+$/, "")];
}

/** Drops links to legacy pages while they are off. */
export function withoutLegacyLinks<T extends { href: string }>(links: readonly T[], enabled: boolean = legacyPagesEnabled()): T[] {
  return enabled ? [...links] : links.filter((link) => !isLegacyPath(link.href));
}

/** Redirects for `next.config.ts`; empty while legacy pages run. Temporary, since dev keeps them. */
export function legacyPageRedirects(env: Record<string, string | undefined>) {
  if (legacyPagesEnabled(env)) return [];
  return Object.entries(LEGACY_PAGE_REPLACEMENTS).map(([source, destination]) => ({ source, destination, permanent: false }));
}
