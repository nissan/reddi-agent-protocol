"use client";

import Link from "next/link";
import FunnelBeacon from "./FunnelBeacon";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SIGNUP_COPY as C } from "../lib/newsletter/copy";

// One-button page behind a confirmation or unsubscribe link. The link's GET renders this page and
// changes nothing; only the button's POST does. The token in the query string is an opaque contact key, never
// an address. A retryable 503 from the endpoint keeps the visitor here with the button enabled.
export default function NewsletterAction({ action }: { action: "confirm" | "unsubscribe" }) {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("t") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = action === "confirm"
    ? { title: C.confirmTitle, body: C.confirmBody, button: C.confirmButton }
    : { title: "Leaving?", body: "Press the button and no more messages will be sent to this address: neither the build updates nor the note about the guarded beta.", button: "Unsubscribe" };

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/newsletter/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: token }) });
      const data = (await res.json().catch(() => ({}))) as { state?: string };
      if (res.status === 503 && data.state === "retry") { setBusy(false); setError("The newsletter service is busy right now. Please try again in a moment."); return; }
      router.replace(`/newsletter/${data.state ?? "invalid"}`);
    } catch {
      setBusy(false); setError("Could not reach the server. Please try again.");
    }
  }

  if (!token) return <main id="main" className="wrap article"><p className="eyebrow">NEWSLETTER</p><h1>That link didn't work.</h1><p className="lead">The link is missing its token. Open the link from your email again, or subscribe from the home page.</p><Link className="text-link" href="/">Back to the home page ↗</Link></main>;
  return (
    <main id="main" className="wrap article">
      <p className="eyebrow">NEWSLETTER</p>
      <h1>{copy.title}</h1>
      <p className="lead">{copy.body}</p>
      <p><button type="button" className="button primary" onClick={submit} disabled={busy}>{busy ? "Working…" : copy.button}</button></p>
      {error && <p className="signup-notice" role="status">{error}</p>}
      {/* The confirm page was opened from an emailed link. The beacon takes no data: the token stays here. */}
      {action === "confirm" && <FunnelBeacon event="signup_confirm_opened" />}
      <Link className="text-link" href="/">Back to the home page ↗</Link>
    </main>
  );
}
