// Wires the flow to the real environment for route handlers. Kept separate so tests import flow.ts only.
// Outside production, NEWSLETTER_TEST_DOUBLES=1 swaps in the in-memory store and fake mailer so route handlers
// can be exercised end to end in unit tests without a network; production ignores the switch.
import { readConfig, type ConfigResult, type NewsletterEnv } from "./config.ts";
import type { Deps } from "./flow.ts";
import { logStoreFailure } from "./http.ts";
import { FakeMailer, ResendMailer } from "./mailer.ts";
import { BlobStore, MemoryStore } from "./store.ts";
import { siteUrl } from "../site.ts";

export const testDoubles = { store: new MemoryStore(), mailer: new FakeMailer() };

export function runtimeDeps(env: NodeJS.ProcessEnv & NewsletterEnv = process.env as NodeJS.ProcessEnv & NewsletterEnv): { ok: true; deps: Deps } | { ok: false; reason: string } {
  const cfg: ConfigResult = readConfig(env);
  if (!cfg.ok) return cfg;
  const useDoubles = env.NEWSLETTER_TEST_DOUBLES === "1" && env.NODE_ENV !== "production";
  return {
    ok: true,
    deps: {
      store: useDoubles ? testDoubles.store : new BlobStore(),
      mailer: useDoubles ? testDoubles.mailer : new ResendMailer(cfg.config.resendApiKey, cfg.config.from, cfg.config.replyTo),
      config: cfg.config,
      siteUrl,
      now: () => Date.now(),
    },
  };
}

// Runs `work` after the response has been sent (WEB-27-S02): the store write and the provider call leave the
// response path, so the subscribe reply's latency is the same for a new, a pending, a confirmed and an unknown
// address, and a provider outage changes nothing the caller can observe. Inside a Next.js request scope `after()`
// keeps the function alive until the work settles; where Next is not loaded or no request scope exists (unit
// tests, scripts) the work starts at once. Failures are logged by logStoreFailure (operation and error class only, WEB-54); no address or token is logged.
// Next is loaded dynamically so this module stays importable under plain Node for the tests and owner scripts.
export function defer(label: string, work: () => Promise<unknown>): void {
  const guarded = () => work().then(() => undefined, (error: unknown) => { logStoreFailure(label, error); });
  void import("next/server").then((next) => { next.after(guarded); }, () => guarded()).catch(() => guarded());
}
