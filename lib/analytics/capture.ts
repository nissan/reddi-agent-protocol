// The typed capture helpers (a copy of apps/marketing/lib/analytics/capture.ts with the app's events). Each takes only
// the properties the taxonomy lists for that event; with no consent, no controller or an inert build (no key) they do
// nothing and return false. page_view and outbound_link are sent by components/analytics/Analytics.tsx.
import type { Controller } from "./controller";
import type { EventName, EventProps } from "./taxonomy";

let current: Controller | null = null;
export const setController = (controller: Controller | null) => { current = controller; };

export function capture<E extends EventName>(name: E, props: EventProps<E> = {} as EventProps<E>): boolean {
  // WEB-46: analytics must never be able to cost a signup or break a page. Any failure inside the controller or the
  // library (a throw from a blocked or half-loaded script, a bad build) is swallowed here and reported as "not sent".
  // The event is not retried: a failed measurement is simply lost.
  try {
    return current ? current.track(name, props as Record<string, unknown>) : false;
  } catch {
    return false;
  }
}

export const captureOutboundLink = (props: EventProps<"outbound_link">) => capture("outbound_link", props);
