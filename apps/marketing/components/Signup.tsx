"use client";

import { useState } from "react";
import { SIGNUP_COPY as C } from "../lib/newsletter/copy";

// The form is enabled only when the build sets NEXT_PUBLIC_NEWSLETTER_FORM=1. Without it the form renders disabled and
// says so, and the endpoint answers 503 (fail closed).
const FORM_ENABLED = process.env.NEXT_PUBLIC_NEWSLETTER_FORM === "1";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; message?: string }>({ kind: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setState(res.ok ? { kind: "done", message: data.message } : { kind: "error", message: data.error ?? "Something went wrong. Please try again." });
    } catch {
      setState({ kind: "error", message: "Could not reach the server. Please try again." });
    }
  }

  if (!FORM_ENABLED) {
    return (
      <section className="signup-root" id="newsletter" aria-labelledby="newsletter-title">
        <h2 id="newsletter-title">{C.formTitle}</h2>
        <p id="newsletter-unavailable" className="signup-notice">{C.closedNotice}</p>
        <div className="signup-controls">
          <label htmlFor="newsletter-email">Email address</label>
          <input id="newsletter-email" className="signup-input" type="email" disabled placeholder={C.closedPlaceholder} aria-describedby="newsletter-unavailable" />
          <button className="signup-button" type="button" disabled aria-describedby="newsletter-unavailable">{C.closedButton}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="signup-root" id="newsletter" aria-labelledby="newsletter-title">
      <h2 id="newsletter-title">{C.formTitle}</h2>
      <p>{C.formBody}</p>
      <form className="signup-controls" onSubmit={submit} noValidate>
        <label htmlFor="newsletter-email">Email address</label>
        <input id="newsletter-email" className="signup-input" type="email" name="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} disabled={state.kind === "busy" || state.kind === "done"} aria-describedby="newsletter-status" />
        <button className="signup-button" type="submit" disabled={state.kind === "busy" || state.kind === "done"}>{state.kind === "busy" ? "Sending…" : state.kind === "done" ? "Check your inbox" : C.button}</button>
        <p id="newsletter-status" className="signup-notice" role="status">{state.message ?? C.statusIdle}</p>
      </form>
    </section>
  );
}
