// WEB-17-S03: the campaign allowlist and the URL hygiene around it. Pure functions, no browser access, so every
// rule is unit-tested. Taxonomy v0.1 is PROPOSED and awaits owner approval (see apps/marketing/README.md).
// A value that is not on the list, or that looks personal, is discarded; it is never trimmed into shape.

export const UTM_SOURCES = ["x", "linkedin", "youtube", "github", "newsletter", "superteam", "solana"] as const;
export const UTM_MEDIUMS = ["organic_social", "video", "community", "email"] as const;
export const UTM_CAMPAIGNS = ["launch_2026", "sandbox_2026"] as const;
export const UTM_CONTENT_PREFIXES = ["post_", "video_", "update_", "msg_"] as const;
const UTM_CONTENT_PATTERN = /^[a-z0-9_]{1,40}$/;

type Source = (typeof UTM_SOURCES)[number];
type Medium = (typeof UTM_MEDIUMS)[number];

// Which mediums make sense for which source. A medium outside its source's row is discarded.
export const SOURCE_MEDIUMS: Record<Source, readonly Medium[]> = {
  x: ["organic_social"],
  linkedin: ["organic_social"],
  youtube: ["video"],
  github: ["community"],
  newsletter: ["email"],
  superteam: ["community"],
  solana: ["community"],
};

export type Campaign = { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string };

const has = (list: readonly string[], value: string) => list.includes(value);

export function allowedContent(raw: string): string | null {
  if (!UTM_CONTENT_PATTERN.test(raw)) return null; // also rejects "@", dots, spaces, upper case and anything over 40
  const prefix = UTM_CONTENT_PREFIXES.find((p) => raw.startsWith(p));
  if (!prefix) return null;
  const rest = raw.slice(prefix.length);
  if (rest.length === 0) return null;
  if (/^[0-9_]+$/.test(rest) && rest.replace(/_/g, "").length > 6) return null; // a long digits-only tail looks like a phone number or an ID
  return raw;
}

export function parseCampaign(search: string): Campaign {
  const params = new URLSearchParams(search);
  const out: Campaign = {};
  const source = params.get("utm_source");
  const medium = params.get("utm_medium");
  const campaign = params.get("utm_campaign");
  const content = params.get("utm_content");
  if (source && has(UTM_SOURCES, source)) out.utm_source = source;
  if (medium && has(UTM_MEDIUMS, medium)) {
    const source = out.utm_source as Source | undefined;
    if (!source || has(SOURCE_MEDIUMS[source], medium)) out.utm_medium = medium;
  }
  if (campaign && has(UTM_CAMPAIGNS, campaign)) out.utm_campaign = campaign;
  if (content) { const ok = allowedContent(content); if (ok) out.utm_content = ok; }
  return out;
}

// Routes whose query strings carry single-use tokens: their campaign fields are never read either.
export const isTokenRoute = (path: string) => /^\/newsletter(\/|$)/.test(path);

// Only a plain path is ever recorded: no query, no fragment, bounded length and character set.
export function safePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (path.length === 0 || path.length > 120 || !/^\/[A-Za-z0-9/_\-.]*$/.test(path)) return "/unknown";
  return path;
}

// The host of a referrer, never its path or query. Empty or unparsable becomes undefined; the site's own host is dropped.
export function referrerHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host && host !== ownHost.toLowerCase() ? host : undefined;
  } catch { return undefined; }
}
