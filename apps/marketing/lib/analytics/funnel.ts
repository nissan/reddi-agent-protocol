// The signup funnel's browser events. Each fires at most once per page view and only through the typed
// capture helpers, so the consent gate and the taxonomy decide whether anything leaves the browser. None of them
// takes an argument: no address, token, response or typed text can be passed in, because there is nowhere to put it.
//
//   signup_section_seen    the signup section scrolls into view (IntersectionObserver)
//   signup_submitted       the form's request is dispatched (before, and independent of, the server's answer)
//   signup_confirm_opened  the one-button confirm page is shown for a link that carries a token (presence only)
//   signup_confirmed       the confirmed-state page is shown
import { captureSignupConfirmed, captureSignupConfirmOpened, captureSignupSectionSeen, captureSignupSubmitted, captureUpdateOpened } from "./capture.ts";

// Fires `send` at most once per page view, and only when it is accepted at the moment the thing happens.
// Nothing is remembered. A moment that happens while the product category is not
// accepted is simply not recorded: no flag, no queue, no retry, so accepting later on the same page sends nothing for it.
// Moments after acceptance are sent when they happen. A refused attempt does not use up the "once", so the next
// moment after acceptance (the signup section scrolled into view after accepting) still goes out.
export function oncePerPageView(send: () => boolean) {
  let done = false;
  return {
    happened() { if (!done && send()) done = true; return done; },
    isDone: () => done,
  };
}

export type Once = ReturnType<typeof oncePerPageView>;
export const signupSectionSeenOnce = () => oncePerPageView(() => captureSignupSectionSeen());
export const signupConfirmOpenedOnce = () => oncePerPageView(() => captureSignupConfirmOpened());
export const signupConfirmedOnce = () => oncePerPageView(() => captureSignupConfirmed());
export const signupSubmitted = () => captureSignupSubmitted();
// A build update's page was shown. The slug is one the site itself publishes.
export const updateOpenedOnce = (slug: string) => oncePerPageView(() => captureUpdateOpened({ slug }));

// For a moment that is "the page was shown" (a post, the confirm page): evaluate it on the next tick, not in the same
// commit, because the Analytics component's controller mounts in that commit and a returning visitor's saved choice is
// applied by it. If product consent is not live at that tick the moment is dropped, never held. Returns the cleanup.
export function whenPageShown(once: Once): () => void {
  const tick = setTimeout(() => { once.happened(); }, 0);
  return () => clearTimeout(tick);
}
