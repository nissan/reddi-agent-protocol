"use client";

// The cookie-free Vercel Web Analytics count (see lib/analytics/vercel.ts). A client component because the
// beforeSend hook is a function, which a server layout cannot pass down. Counts only on Vercel production builds.
import { Analytics } from "@vercel/analytics/next";
import { scrubVercelEvent } from "@/lib/analytics/vercel";

export default function VercelAnalytics() {
  return <Analytics beforeSend={scrubVercelEvent} />;
}
