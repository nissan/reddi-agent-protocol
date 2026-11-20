// WEB-17: configuration and the PostHog init options. Pure, so the "everything optional is off" settings are tested.
// The key is PostHog's public ingestion key (NEXT_PUBLIC_POSTHOG_KEY); without it analytics is inert, which is how
// local and CI runs stay away from the real service. They point the host at a local stub instead.
import type { Consented } from "./taxonomy.ts";

export const DEFAULT_HOST = "https://us.i.posthog.com";

export type AnalyticsConfig = { key: string; host: string };

export function readAnalyticsConfig(env: { key?: string; host?: string }): AnalyticsConfig | null {
  const key = env.key?.trim();
  if (!key || !/^phc_[A-Za-z0-9]{8,}$/.test(key)) return null;
  const rawHost = env.host?.trim() || DEFAULT_HOST;
  let url: URL;
  try { url = new URL(rawHost); } catch { return null; }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (!(url.protocol === "https:" || (url.protocol === "http:" && loopback))) return null; // no plain-http beyond a local stub
  return { key, host: url.origin };
}

// Persistence follows the consent given: nothing is written for acquisition alone (one landing event, no returning
// visitor identifier needed); product analytics keeps a random anonymous id in localStorage (never a cookie).
export type Persistence = "memory" | "localStorage";
export const persistenceFor = (consent: Consented): Persistence => (consent.product ? "localStorage" : "memory");

export function initOptions(config: AnalyticsConfig, persistence: Persistence, beforeSend: (event: unknown) => unknown) {
  return {
    api_host: config.host,
    // Capture only what the site sends explicitly; no automatic collection of any kind.
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    rageclick: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_conversations: true,
    disable_web_experiments: true,
    advanced_disable_flags: true,
    advanced_disable_toolbar_metrics: true,
    disable_external_dependency_loading: true,
    save_campaign_params: false,
    // The site never identifies anyone, so no person profile is created.
    person_profiles: "identified_only" as const,
    persistence: persistence as Persistence,
    cross_subdomain_cookie: false,
    // Send each event at once: no queue can outlive a withdrawal.
    request_batching: false,
    // `ip` is left to the PostHog project setting (owner decision pending).
    before_send: beforeSend,
  };
}
