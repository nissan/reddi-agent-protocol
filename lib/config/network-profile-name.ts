/**
 * Single owner of "which network profile did the environment select?".
 *
 * The runtime resolver (`lib/config/network.ts`), the build-time Playwright signer guard
 * (`next.config.ts`), and the Playwright web-server precondition check
 * (`scripts/check-browser-wallet-command-preconditions.mjs`) all consult this module rather than
 * reimplementing the alias table and env precedence, so they cannot drift apart and let one of them
 * resolve a different profile than the one the app will actually run against.
 *
 * `NETWORK_PROFILE` is the only true runtime selector; `NEXT_PUBLIC_BUILD_NETWORK_PROFILE` is emitted
 * by the build; `NEXT_PUBLIC_NETWORK_PROFILE` is a build-time selector frozen into the bundles.
 * Blank and whitespace-only values are skipped rather than treated as a selection.
 */

export type NetworkProfileName = "local-surfpool" | "devnet" | "mainnet";

export const NETWORK_PROFILE_ENV_KEYS = [
  "NETWORK_PROFILE",
  "NEXT_PUBLIC_BUILD_NETWORK_PROFILE",
  "NEXT_PUBLIC_NETWORK_PROFILE",
] as const;

export function normalizeNetworkProfileName(raw: string): NetworkProfileName {
  const value = raw.trim().toLowerCase();
  if (value === "local-surfpool" || value === "local" || value === "localnet" || value === "surfpool") return "local-surfpool";
  if (value === "mainnet" || value === "mainnet-beta") return "mainnet";
  return "devnet";
}

export function resolveNetworkProfileNameFromEnv(env: Record<string, string | undefined>): NetworkProfileName {
  for (const key of NETWORK_PROFILE_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return normalizeNetworkProfileName(value);
  }
  return "devnet";
}
