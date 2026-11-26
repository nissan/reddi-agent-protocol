// Vercel Web Analytics: the cookie-free visit count that runs for every visitor, before and without any consent
// choice. It stores nothing in the browser and has no identifier that lasts beyond the day. This hook decides the one
// thing it records about the page: the plain path, with ids replaced (safePath), plus only the campaign tags on our
// allowlist (parseCampaign). The rest of the query string and the fragment are dropped, so a key, address or token in
// a URL never reaches it. The Vercel script adds the referring page itself; Vercel's reports show only its site name.
import { isTokenRoute, parseCampaign, safePath } from "./campaign";

type VercelEvent = { type: "pageview" | "event"; url: string };

export function scrubVercelEvent<E extends VercelEvent>(event: E): E | null {
  try {
    const url = new URL(event.url);
    const path = safePath(url.pathname);
    const campaign = isTokenRoute(path) ? {} : parseCampaign(url.search);
    const query = new URLSearchParams(campaign as Record<string, string>).toString();
    return { ...event, url: `${url.origin}${path}${query ? `?${query}` : ""}` };
  } catch {
    return null; // an address we cannot read is not sent
  }
}
