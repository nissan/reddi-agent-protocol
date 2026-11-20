// The typed capture helpers. Each takes only the properties the taxonomy lists for that event; with no consent, no
// controller or an inert build (no key) they do nothing and return false. page_view and outbound_link are sent by the
// Analytics component; the signup steps by Signup, NewsletterAction and the confirmed-state page; update_opened by a
// build update's page.
import type { Controller } from "./controller.ts";
import type { EventName, EventProps } from "./taxonomy.ts";

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

export const captureSignupSectionSeen = (props?: EventProps<"signup_section_seen">) => capture("signup_section_seen", props);
export const captureSignupSubmitted = (props?: EventProps<"signup_submitted">) => capture("signup_submitted", props);
export const captureSignupConfirmOpened = (props?: EventProps<"signup_confirm_opened">) => capture("signup_confirm_opened", props);
export const captureSignupConfirmed = (props?: EventProps<"signup_confirmed">) => capture("signup_confirmed", props);
export const captureUpdateOpened = (props: EventProps<"update_opened">) => capture("update_opened", props);
export const captureOutboundLink = (props: EventProps<"outbound_link">) => capture("outbound_link", props);
