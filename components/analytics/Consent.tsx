"use client";

// The app's privacy choice, the same choice and wording as the marketing site's banner
// (apps/marketing/components/Consent.tsx), styled for the app. The two sites are separate origins, so a visitor is
// asked once on each. Rendered in the footer only when the build has a PostHog key.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ANALYTICS_REGION } from "@/lib/analytics/enabled";
import { CONSENT_EVENT, preference, readConsent, writeConsent, type ConsentPreference } from "@/lib/analytics/consent";

const button =
  "min-h-11 cursor-pointer border border-foreground px-3 py-2 text-[13px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2";

export default function Consent() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ConsentPreference>(preference());
  const [notice, setNotice] = useState("");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const banner = useRef<HTMLElement>(null);

  // The saved choice is read after hydration (the server cannot see it), on the next tick.
  useEffect(() => {
    const tick = setTimeout(() => {
      let saved: ConsentPreference | null = null;
      try { saved = readConsent(window.localStorage); } catch { /* Storage may be disabled. */ }
      setChoice(saved ?? preference());
      setOpen(saved === null);
    }, 0);
    return () => clearTimeout(tick);
  }, []);

  // While the fixed banner is open, pad the page by its height so focused controls and the last lines stay clear of it.
  useEffect(() => {
    const element = banner.current;
    if (!open || !element) return;
    const body = document.body;
    const root = document.documentElement;
    const publish = () => {
      const clearance = `${Math.ceil(window.innerHeight - element.getBoundingClientRect().top)}px`;
      body.style.paddingBottom = clearance;
      root.style.scrollPaddingBottom = `calc(${clearance} + 16px)`;
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener("resize", publish);
    return () => { observer.disconnect(); window.removeEventListener("resize", publish); body.style.removeProperty("padding-bottom"); root.style.removeProperty("scroll-padding-bottom"); };
  }, [open]);

  function save(next: ConsentPreference) {
    setChoice(next);
    let persisted = false;
    try { persisted = writeConsent(window.localStorage, next); } catch { /* Keep the choice for this visit. */ }
    const on = next.acquisition || next.product;
    setNotice(persisted
      ? (on ? "Privacy preference saved. Measurement is on only for the categories you allowed." : "Privacy preference saved. No optional measurement is active.")
      : (on ? "Preference applied for this visit. Your browser could not save it, so you will be asked again next time." : "Preference applied for this visit. Your browser could not save it; no optional measurement is active."));
    try { window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: next })); } catch { /* no listener can exist without window */ }
    setOpen(false);
    settingsButton.current?.focus();
  }

  function showSettings() {
    setOpen(true);
    setNotice("");
    // Move focus only following an explicit settings action, never on first load.
    requestAnimationFrame(() => heading.current?.focus());
  }

  return (
    <div>
      <button
        type="button"
        ref={settingsButton}
        aria-expanded={open}
        aria-controls="privacy-settings"
        onClick={showSettings}
        className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-[#ece9df] underline underline-offset-4 hover:text-[#14f195]"
      >
        Privacy settings
      </button>
      <p role="status" className="mt-1 max-w-xs text-xs text-[#b9b6ab]">{notice}</p>
      {open && (
        <section
          id="privacy-settings"
          ref={banner}
          aria-labelledby="privacy-settings-title"
          className="fixed bottom-3 left-3 z-50 max-h-[calc(100svh-24px)] w-[calc(100vw-24px)] overflow-auto border border-foreground bg-surface p-5 text-left text-foreground shadow-[5px_5px_0_var(--foreground)] sm:bottom-5 sm:left-5 sm:w-[min(460px,calc(100vw-40px))] sm:p-6"
        >
          <h2 id="privacy-settings-title" ref={heading} tabIndex={-1} className="mb-2 text-2xl font-extrabold">Your privacy choices</h2>
          <p className="my-2 text-[13px]">Nothing optional is collected until you choose. Until then only your privacy preference is saved in this browser, and the hosting provider delivers the page and counts the visit without cookies or an ID. There are no advertising trackers and no session recording.</p>
          <p className="my-2 text-[13px]">If you allow a category below, we use PostHog{ANALYTICS_REGION ? ` (${ANALYTICS_REGION})` : ""} to measure the app, without your email address, your wallet address or any key, and without recording your screen. You can change this at any time from Privacy settings, which stops collection and removes PostHog&apos;s identifiers from this browser. Your choice does not change what you can use.</p>
          <fieldset className="my-4 grid gap-3 border-0 p-0">
            <legend className="mb-3 text-xs font-bold">Optional measurement preferences</legend>
            <label className="grid grid-cols-[24px_1fr] items-start text-[13px] font-bold leading-snug">
              <input type="checkbox" className="h-[18px] w-[18px]" checked={choice.acquisition} onChange={(event) => setChoice(preference(event.target.checked, choice.product))} />
              Acquisition measurement
              <span className="col-start-2 text-xs font-normal text-muted-foreground">Which approved campaign link brought you here (campaign labels and the referring site&apos;s name only), on your landing page.</span>
            </label>
            <label className="grid grid-cols-[24px_1fr] items-start text-[13px] font-bold leading-snug">
              <input type="checkbox" className="h-[18px] w-[18px]" checked={choice.product} onChange={(event) => setChoice(preference(choice.acquisition, event.target.checked))} />
              Product analytics
              <span className="col-start-2 text-xs font-normal text-muted-foreground">Which pages you open (with any address or ID in the link removed) and clicks on links to other sites, using a random anonymous ID kept in this browser.</span>
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${button} flex-1 bg-surface text-foreground hover:bg-page`} onClick={() => save(preference())}>Reject all optional</button>
            <button type="button" className={`${button} flex-1 bg-surface text-foreground hover:bg-page`} onClick={() => save(preference(true, true))}>Accept all optional</button>
            <button type="button" className={`${button} w-full bg-[#14f195] text-[#101216] hover:bg-[#14f195]/85`} onClick={() => save(choice)}>Save selected preferences</button>
          </div>
          <p className="mt-4 flex gap-5 text-xs underline"><Link href="/privacy">Privacy notice</Link><Link href="/terms">Terms</Link></p>
        </section>
      )}
    </div>
  );
}
