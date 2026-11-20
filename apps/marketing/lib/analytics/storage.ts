// WEB-17-S02: removing PostHog's identifiers. Its keys all start with `ph_` or `__ph_` (localStorage and
// sessionStorage: `ph_<token>_posthog`, `__ph_opt_in_out_<token>`; cookies of the same shape). The site's own
// consent key (`rap.consent`) never matches and is left alone.
export const isAnalyticsKey = (name: string) => /^(__)?ph_/.test(name) || name.toLowerCase().includes("posthog");

export type KeyedStorage = { length: number; key(index: number): string | null; removeItem(key: string): void };

export function clearKeyedStorage(storage: KeyedStorage): string[] {
  const removed: string[] = [];
  try {
    const names: string[] = [];
    for (let i = 0; i < storage.length; i++) { const name = storage.key(i); if (name !== null) names.push(name); }
    for (const name of names) if (isAnalyticsKey(name)) { storage.removeItem(name); removed.push(name); }
  } catch { /* Storage may be disabled: there is then nothing of ours in it. */ }
  return removed;
}

export function cookieNames(cookie: string): string[] {
  return cookie.split(";").map((part) => part.split("=")[0]?.trim() ?? "").filter(Boolean);
}

// Expire every analytics cookie on the page host and its parent domains, since PostHog may have scoped one upward.
export function clearCookies(doc: { cookie: string }, hostname: string): string[] {
  const removed: string[] = [];
  try {
    const labels = hostname.split(".");
    const domains = ["", ...labels.map((_, i) => labels.slice(i).join(".")).filter((d) => d.includes("."))];
    for (const name of cookieNames(doc.cookie)) {
      if (!isAnalyticsKey(name)) continue;
      for (const domain of domains) doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ""}`;
      removed.push(name);
    }
  } catch { /* Cookies may be disabled. */ }
  return removed;
}
