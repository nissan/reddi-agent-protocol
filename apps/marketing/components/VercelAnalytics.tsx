"use client";

// The cookie-free Vercel Web Analytics count (see lib/analytics/vercel.ts). A client component because the
// beforeSend hook is a function, which a server layout cannot pass down. Counts only on Vercel production builds.
import { Analytics } from "@vercel/analytics/next";
import { scrubVercelEvent } from "../lib/analytics/vercel";

export default function VercelAnalytics() {
  // Outside a production build the package loads a debug script from va.vercel-scripts.com, which counts nothing
  // and breaks the "no external requests" promise the local and CI runs check (e2e/onboarding-profile-editor.spec.ts).
  if (process.env.NODE_ENV !== "production") return null;
  return <Analytics beforeSend={scrubVercelEvent} />;
}
