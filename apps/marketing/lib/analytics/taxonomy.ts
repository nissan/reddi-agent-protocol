// WEB-17: the one list of events the site may send and the properties each may carry. Taxonomy v0.1 is PROPOSED,
// awaiting owner approval. The capture helper and the PostHog `before_send` hook both read this table, so an
// event or property that is not here cannot leave the browser (tests/analytics.test.ts enforces that).
// Never add an email address, token, contact key, typed text or full URL as a property.
import { UTM_SOURCES, UTM_MEDIUMS, UTM_CAMPAIGNS, allowedContent } from "./campaign.ts";

export type Category = "product" | "acquisition";
type Validator = (value: unknown) => string | undefined;

const text = (pattern: RegExp): Validator => (v) => (typeof v === "string" && pattern.test(v) ? v : undefined);
const oneOf = (list: readonly string[]): Validator => (v) => (typeof v === "string" && list.includes(v) ? v : undefined);

// The wire name of the page view. PostHog's built-in Web Analytics reads `$pageview` (owner decision A8, 4 October 2026).
// `page_view` stays the internal taxonomy name; this constant is the single place it becomes the PostHog name, at the send
// point in controller.ts. It is the only `$`-named event the site sends, and the site sends it itself, after consent:
// posthog-js automatic pageview capture (`capture_pageview`) stays off.
export const PAGE_VIEW_EVENT = "$pageview";

type PropertySpec = { check: Validator; category: Category | "base" };

// "base" properties travel with any enabled category; the others only when their own category is on.
const P = {
  path: { check: text(/^\/[A-Za-z0-9/_\-.]{0,119}$/), category: "base" },
  utm_source: { check: oneOf(UTM_SOURCES), category: "acquisition" },
  utm_medium: { check: oneOf(UTM_MEDIUMS), category: "acquisition" },
  utm_campaign: { check: oneOf(UTM_CAMPAIGNS), category: "acquisition" },
  utm_content: { check: (v: unknown) => (typeof v === "string" ? (allowedContent(v) ?? undefined) : undefined), category: "acquisition" },
  referrer_host: { check: text(/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/), category: "acquisition" },
  host: { check: text(/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/), category: "product" },
  slug: { check: text(/^[a-z0-9-]{1,80}$/), category: "product" },
} as const satisfies Record<string, PropertySpec>;

export type PropertyName = keyof typeof P;

type EventSpec = {
  // "product": needs the product category. "landing": also allowed with acquisition alone, for the landing page view only.
  needs: "product" | "landing";
  properties: readonly PropertyName[];
  // Wired to a call site? (Every event in the table is wired as of WEB-41; the flag stays so a future proposal can be listed first.)
  wired: boolean;
};

const CAMPAIGN_PROPS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer_host"] as const;

export const EVENTS = {
  page_view: { needs: "landing", properties: ["path", ...CAMPAIGN_PROPS], wired: true },
  outbound_link: { needs: "product", properties: ["path", "host"], wired: true },
  // WEB-40: the signup funnel. None of them carries a property derived from the address, the token, the server's
  // answer or anything the visitor typed: the only property is the plain path. (v0.1 listed `outcome` on
  // signup_submitted and `state` on signup_confirm_opened; WEB-40 removed both so the server's answer can never
  // reach analytics, and added signup_confirmed for the confirmed-state page.)
  signup_section_seen: { needs: "product", properties: ["path"], wired: true },
  signup_submitted: { needs: "product", properties: ["path"], wired: true },
  signup_confirm_opened: { needs: "product", properties: ["path"], wired: true },
  signup_confirmed: { needs: "product", properties: ["path"], wired: true },
  // A build update's page was opened. The only properties are the plain path and the update's slug, which the site
  // itself publishes. Nothing typed, no text.
  update_opened: { needs: "product", properties: ["path", "slug"], wired: true },
} as const satisfies Record<string, EventSpec>;

export type EventName = keyof typeof EVENTS;
export type EventProps<E extends EventName> = { [K in (typeof EVENTS)[E]["properties"][number]]?: string };

export const isEventName = (name: unknown): name is EventName => typeof name === "string" && Object.hasOwn(EVENTS, name);

export type Consented = { product: boolean; acquisition: boolean };

// The mapping from consent to what is sent (documented in apps/marketing/README.md):
//   product only      every page view (path only) and the named interaction events, no campaign fields;
//   acquisition only  the landing page view only, with path, allowlisted campaign fields and referrer host;
//   both              all events, campaign fields on page views;
//   neither           nothing.
// `landing` is true for the first page view of the page load.
export function prepare(event: string, props: Record<string, unknown>, consent: Consented, landing: boolean): { name: EventName; properties: Record<string, string> } | null {
  if (!isEventName(event)) return null;
  const spec: EventSpec = EVENTS[event];
  const allowedByCategory = consent.product || (spec.needs === "landing" && consent.acquisition && landing);
  if (!allowedByCategory) return null;
  const properties: Record<string, string> = {};
  for (const key of spec.properties) {
    const def: PropertySpec = P[key];
    if (def.category !== "base" && !consent[def.category]) continue;
    const value = def.check(props[key]);
    if (value !== undefined) properties[key] = value;
  }
  return { name: event, properties };
}

// Every property name an event may carry on the wire, for the stub-host check.
export const ALL_PROPERTY_NAMES: readonly string[] = Object.keys(P);
