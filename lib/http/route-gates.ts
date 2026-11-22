/**
 * Route gates for the developer app's legacy, demo and file-store API routes.
 *
 * Security audit round 1 (S2-claude-01, -02, -03; condition C3): these routes have no
 * caller authentication, write the server's `data/` files, spawn local processes or
 * fetch caller-chosen URLs. They exist for local development and the onboarding
 * wizard's file mode. In a production build, and on the mainnet profile in any build,
 * they answer 404 so they cannot change shared state or be used as a relay.
 */
import { resolveNetworkProfileName } from "@/lib/config/network";

/** True when legacy local-development routes may run in this process. */
export function legacyRoutesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return resolveNetworkProfileName() !== "mainnet";
}

/** A plain 404 that does not say why, so production does not advertise the route. */
export function routeNotFound(): Response {
  return Response.json({ ok: false, error: "Not found." }, { status: 404, headers: { "cache-control": "no-store" } });
}

/**
 * Returns a 404 response when legacy routes are off, otherwise null.
 * Use as the first statement of a gated handler:
 *   const gated = legacyRouteGate(); if (gated) return gated;
 */
export function legacyRouteGate(env: Record<string, string | undefined> = process.env): Response | null {
  return legacyRoutesEnabled(env) ? null : routeNotFound();
}
