// Whether this build has analytics at all. Without a valid NEXT_PUBLIC_POSTHOG_KEY the site loads nothing, asks nothing
// and shows no privacy banner. Referenced literally so Next inlines the values at build time.
import { readAnalyticsConfig } from "./config.ts";

export const ANALYTICS_CONFIG = readAnalyticsConfig({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, host: process.env.NEXT_PUBLIC_POSTHOG_HOST });
export const ANALYTICS_ENABLED = ANALYTICS_CONFIG !== null;

// Where the measurement provider keeps the data, for the wording of the choice. Null when the host is not one of
// PostHog's two public regions (then the wording names no region).
export function analyticsRegion(host: string | undefined): "United States" | "European Union" | null {
  if (!host) return null;
  if (/^https:\/\/us\.(i\.)?posthog\.com$/.test(host)) return "United States";
  if (/^https:\/\/eu\.(i\.)?posthog\.com$/.test(host)) return "European Union";
  return null;
}
export const ANALYTICS_REGION = analyticsRegion(ANALYTICS_CONFIG?.host);
