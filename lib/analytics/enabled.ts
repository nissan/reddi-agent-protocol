// Whether this build of the app has PostHog at all. Without a valid NEXT_PUBLIC_POSTHOG_KEY the app loads nothing, asks
// nothing and shows no privacy banner. Referenced literally so Next inlines the values at build time.
import { readAnalyticsConfig } from "./config";

export const ANALYTICS_CONFIG = readAnalyticsConfig({ key: process.env.NEXT_PUBLIC_POSTHOG_KEY, host: process.env.NEXT_PUBLIC_POSTHOG_HOST });
export const ANALYTICS_ENABLED = ANALYTICS_CONFIG !== null;

// Where PostHog keeps the data, for the wording of the choice. Null when the host is not one of its two public regions.
export function analyticsRegion(host: string | undefined): "United States" | "European Union" | null {
  if (!host) return null;
  if (/^https:\/\/us\.(i\.)?posthog\.com$/.test(host)) return "United States";
  if (/^https:\/\/eu\.(i\.)?posthog\.com$/.test(host)) return "European Union";
  return null;
}
export const ANALYTICS_REGION = analyticsRegion(ANALYTICS_CONFIG?.host);
