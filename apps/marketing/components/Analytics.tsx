"use client";

// Mounts the consent-gated analytics controller. Before a visitor allows a category this component only
// reads the saved choice and the current route in memory: no script, request, cookie or storage key. The PostHog
// library is a dynamic import that exists only behind the first accepted category. Inert without a project key.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_EVENT, readConsent, type ConsentPreference } from "../lib/consent";
import { ANALYTICS_CONFIG as CONFIG } from "../lib/analytics/enabled";
import { createController, type Controller, type PostHogLike } from "../lib/analytics/controller";
import { clearCookies, clearKeyedStorage } from "../lib/analytics/storage";
import { captureOutboundLink, setController } from "../lib/analytics/capture";


function clearBrowserStorage() {
  try { clearKeyedStorage(window.localStorage); } catch { /* blocked */ }
  try { clearKeyedStorage(window.sessionStorage); } catch { /* blocked */ }
  clearCookies(document, window.location.hostname);
}

export default function Analytics() {
  const pathname = usePathname();
  const controller = useRef<Controller | null>(null);

  useEffect(() => {
    if (!CONFIG) return; // inert: no key in this build
    const instance = createController({
      config: CONFIG,
      load: async () => (await import("posthog-js")).default as unknown as PostHogLike,
      clearStorage: clearBrowserStorage,
      origin: window.location.origin,
      ownHost: window.location.hostname,
    });
    controller.current = instance;
    setController(instance);
    // The route may already have been announced by the effect below; the controller keeps it in memory.
    instance.navigate(window.location.pathname, window.location.search, document.referrer);
    let saved: ConsentPreference | null = null;
    try { saved = readConsent(window.localStorage); } catch { /* storage blocked: a choice made this visit arrives by event */ }
    instance.apply(saved).catch(() => { /* analytics never throws into the page */ });
    const onConsent = (event: Event) => { instance.apply((event as CustomEvent<ConsentPreference | null>).detail).catch(() => { /* ditto */ }); };
    window.addEventListener(CONSENT_EVENT, onConsent);
    // outbound_link: the destination host only, never the URL.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !/^https?:$/.test(anchor.protocol) || anchor.hostname === window.location.hostname) return;
      captureOutboundLink({ host: anchor.hostname.toLowerCase() });
    };
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener(CONSENT_EVENT, onConsent); document.removeEventListener("click", onClick, true); setController(null); controller.current = null; };
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // the mount effect announced the first route
    controller.current?.navigate(pathname, "", "");
  }, [pathname]);

  return null;
}
