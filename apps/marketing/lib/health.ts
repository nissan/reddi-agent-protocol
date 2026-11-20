// The health report behind /api/health. Pure, so tests can call it with any environment. It says whether the site's
// own parts are switched on and which build is answering; it never returns a secret, an address or a count of people.
import { resolveIndexable, resolveShowDrafts, type SiteEnv } from "./site.ts";
import { visibleUpdates, type Update } from "./updates.ts";
import { visibleVideos, type Video } from "./videos.ts";

export type HealthReport = {
  status: "ok";
  site: "rap-marketing";
  time: string;
  build: { environment: string; commit: string | null };
  indexable: boolean;
  newsletter: { enabled: boolean; signupForm: boolean; publicCollection: boolean; autosend: boolean };
  updates: { published: number; latest: string | null };
  videos: { published: number };
};

const on = (v: string | undefined) => v === "1";

export function healthReport(env: SiteEnv, now: number, updates?: readonly Update[], videos?: readonly Video[]): HealthReport {
  const published = visibleUpdates(false, updates);
  return {
    status: "ok",
    site: "rap-marketing",
    time: new Date(now).toISOString(),
    build: { environment: env.VERCEL_ENV ?? (resolveShowDrafts(env) ? "development" : "production"), commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    indexable: resolveIndexable(env),
    newsletter: { enabled: on(env.NEWSLETTER_ENABLED), signupForm: on(env.NEXT_PUBLIC_NEWSLETTER_FORM), publicCollection: on(env.NEWSLETTER_PUBLIC), autosend: on(env.NEWSLETTER_AUTOSEND) },
    updates: { published: published.length, latest: published[0]?.date ?? null },
    videos: { published: visibleVideos(false, videos).length },
  };
}
