/**
 * Which network each part of the app runs on, and the copy that says so (#1151).
 *
 * Owner decision, 26 November 2026: the 5 December launch runs Budgets on Solana mainnet, while
 * single paid calls (Try it, the Planner and the Agent pass) stay on devnet with test funds until
 * their pricing and demand are worked out. So a mainnet build of the app is mixed: Budgets take
 * real funds and every per-call page says it is devnet.
 *
 * Two inputs, both fixed at build time:
 * - the build's network profile (`NEXT_PUBLIC_BUILD_NETWORK_PROFILE`, emitted by next.config.ts);
 * - the launch switch `NEXT_PUBLIC_RAP_MAINNET_LIVE=true`, set on the production project only
 *   after runbook section 6 has verified a collected fee on mainnet. It changes copy only (footer,
 *   home stage line, fee wording); it never enables a payment path, and it is ignored on a devnet
 *   or local build.
 */
import { resolveNetworkProfileNameFromEnv, type NetworkProfileName } from "@/lib/config/network-profile-name";

export const MAINNET_LIVE_ENV = "NEXT_PUBLIC_RAP_MAINNET_LIVE";

type Env = Record<string, string | undefined>;

function buildEnv(): Env {
  // Spelled out so Next.js inlines each NEXT_PUBLIC_ value into the browser bundle.
  return {
    NETWORK_PROFILE: process.env.NETWORK_PROFILE,
    NEXT_PUBLIC_BUILD_NETWORK_PROFILE: process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE,
    NEXT_PUBLIC_NETWORK_PROFILE: process.env.NEXT_PUBLIC_NETWORK_PROFILE,
    NEXT_PUBLIC_RAP_MAINNET_LIVE: process.env.NEXT_PUBLIC_RAP_MAINNET_LIVE,
  };
}

export function appNetwork(env: Env = buildEnv()): NetworkProfileName {
  return resolveNetworkProfileNameFromEnv(env);
}

/** The launch copy switch: true only on a mainnet build with the switch set to exactly "true". */
export function mainnetLaunchLive(env: Env = buildEnv()): boolean {
  return appNetwork(env) === "mainnet" && env.NEXT_PUBLIC_RAP_MAINNET_LIVE?.trim() === "true";
}

/**
 * Single paid calls that follow the build's profile (the Planner's wallet payment) are refused on
 * a mainnet build. Kept in code, not in an env variable, so a setting cannot open per-call
 * payments on mainnet: that takes a reviewed change to this line.
 */
export function perCallPaymentsRefusedOnThisBuild(env: Env = buildEnv()): boolean {
  return appNetwork(env) === "mainnet";
}

export const PER_CALL_MAINNET_REFUSAL =
  "Single paid calls run on Solana devnet for now, while we work out their pricing. On mainnet, pay through a Budget instead. Nothing was signed.";

/** Routes whose payments always run on devnet, whatever the build's profile. */
export const DEVNET_ONLY_ROUTES = ["/try", "/pass", "/planner", "/sandbox"] as const;

export function isDevnetOnlyRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return DEVNET_ONLY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export type StageCopy = {
  /** One line for the footer and the home page's top bar. */
  stage: string;
  /** Label for the protocol fee row. */
  feeLabel: string;
  /** Sentence for pages that run single paid calls on devnet. */
  perCallNetwork: string;
};

export function stageCopy(env: Env = buildEnv()): StageCopy {
  if (mainnetLaunchLive(env)) {
    return {
      stage: "Budgets run on Solana mainnet. Single paid calls run on devnet with test funds for now.",
      feeLabel: "fee",
      perCallNetwork:
        "Single paid calls run on Solana devnet with test funds for now, while we work out their pricing. Budgets run on mainnet.",
    };
  }
  return {
    stage: "Running on Solana devnet. Mainnet is coming soon.",
    feeLabel: "fee (planned)",
    perCallNetwork: "Test SOL has no monetary value. Mainnet is coming soon.",
  };
}
