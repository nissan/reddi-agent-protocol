"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ANALYTICS_REGION } from "../lib/analytics/enabled";
import { CONSENT_EVENT, preference, readConsent, writeConsent, type ConsentPreference } from "../lib/consent";

export default function Consent() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ConsentPreference>(preference());
  const [notice, setNotice] = useState("");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const banner = useRef<HTMLElement>(null);

  useEffect(() => {
    let saved: ConsentPreference | null = null;
    try { saved = readConsent(window.localStorage); } catch { /* Storage may be disabled. */ }
    setChoice(saved ?? preference());
    setOpen(saved === null);
  }, []);

  // The banner is fixed over the bottom of the page. While it is open, publish its height so the page
  // keeps focused controls clear of it (scroll padding) and can scroll its last lines above it (body padding);
  // see `--consent-clearance` in globals.css. Without this a keyboard user's focus can sit entirely behind it.
  useEffect(() => {
    const element = banner.current;
    if (!open || !element) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--consent-clearance", `${Math.ceil(window.innerHeight - element.getBoundingClientRect().top)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener("resize", publish);
    return () => { observer.disconnect(); window.removeEventListener("resize", publish); root.style.removeProperty("--consent-clearance"); };
  }, [open]);

  function save(next: ConsentPreference) {
    setChoice(next);
    let persisted = false;
    try { persisted = writeConsent(window.localStorage, next); } catch { /* Keep session choice. */ }
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
    <div className="consent-root">
      <button type="button" className="consent-settings" ref={settingsButton} aria-expanded={open} aria-controls="privacy-settings" onClick={showSettings}>Privacy settings</button>
      <p className="consent-status" role="status">{notice}</p>
      {open && (
        <section id="privacy-settings" className="consent-banner" aria-labelledby="privacy-settings-title" ref={banner}>
          <h2 id="privacy-settings-title" className="consent-title" ref={heading} tabIndex={-1}>Your privacy choices</h2>
          <p>Nothing optional is collected until you choose. Until then only your privacy preference is saved in this browser, and the hosting provider delivers the page and counts the visit without cookies or an ID. There are no advertising trackers and no session recording.</p>
          <p>If you allow a category below, we use PostHog{ANALYTICS_REGION ? ` (${ANALYTICS_REGION})` : ""} to measure the site, without your email address or wallet address and without recording your screen. You can change this at any time from Privacy settings, which stops collection and removes PostHog&apos;s identifiers from this browser. Your choice does not change what you can read or try.</p>
          <fieldset className="consent-options">
            <legend>Optional measurement preferences</legend>
            <label className="consent-option"><input type="checkbox" checked={choice.acquisition} onChange={(event) => setChoice(preference(event.target.checked, choice.product))} /> Acquisition measurement <span>Which approved campaign link brought you here (campaign labels and the referring site&apos;s name only), on your landing page.</span></label>
            <label className="consent-option"><input type="checkbox" checked={choice.product} onChange={(event) => setChoice(preference(choice.acquisition, event.target.checked))} /> Product analytics <span>Page views, clicks on links to other sites, sign-up steps and which build updates you open, using a random anonymous ID kept in this browser.</span></label>
          </fieldset>
          <div className="consent-actions">
            <button type="button" className="consent-choice" onClick={() => save(preference())}>Reject all optional</button>
            <button type="button" className="consent-choice" onClick={() => save(preference(true, true))}>Accept all optional</button>
            <button type="button" className="consent-save" onClick={() => save(choice)}>Save selected preferences</button>
          </div>
          <p className="consent-links"><Link href="/privacy">Privacy information</Link> · <Link href="/terms">Terms</Link></p>
        </section>
      )}
    </div>
  );
}
