// The app's copy of the marketing site's campaign allowlist and URL hygiene (apps/marketing/lib/analytics/campaign.ts).
// Keep the two lists the same: lib/analytics/__tests__/analytics.test.ts compares them. Pure functions, unit-tested.
// The app differs in one place: safePath also replaces ids in the path (wallet and program addresses, job, run and
// agent ids, keys), so a recorded path never carries one.
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
export const isTokenRoute = (path: string) => /^\/(newsletter|pass)(\/|$)/.test(path);

// Only a plain path is ever recorded: no query, no fragment, bounded length and character set.
// A path segment that looks like an identifier is replaced by ":id". That covers Solana addresses and signatures
// (base58, 32 characters or more), UUIDs, hex, long numbers, prefixed keys (rap_pass_..., rap_budget_...) and any other
// long opaque token. Route names in the app are short words joined by hyphens, which are kept.
const ID_SEGMENT = /^(?:[1-9A-HJ-NP-Za-km-z]{32,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:0x)?[0-9a-fA-F]{16,}|[0-9]{4,}|[a-z]+_[a-z_]*[A-Za-z0-9]{12,}|[A-Za-z0-9_-]{25,})$/;
export const scrubSegment = (segment: string) => (segment !== "" && (ID_SEGMENT.test(segment) || (/[0-9]/.test(segment) && /[A-Z]/.test(segment) && segment.length >= 12)) ? ":id" : segment);

export function safePath(pathname: string): string {
  const raw = pathname.split(/[?#]/)[0] ?? "";
  if (raw.length === 0 || raw.length > 400 || !/^\/[A-Za-z0-9/_\-.:]*$/.test(raw)) return "/unknown";
  const path = raw.split("/").map(scrubSegment).join("/");
  return path.length > 120 ? "/unknown" : path;
}

// The host of a referrer, never its path or query. Empty or unparsable becomes undefined; the site's own host is dropped.
export function referrerHost(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host && host !== ownHost.toLowerCase() ? host : undefined;
  } catch { return undefined; }
}
