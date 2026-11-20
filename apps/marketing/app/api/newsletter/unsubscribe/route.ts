// Unsubscribe endpoint (WEB-25, WEB-27): GET only shows the page with one button; POST performs the change. Mail
// clients that implement RFC 8058 one-click unsubscribe POST to the List-Unsubscribe URL with the token in
// the query string, which this handler accepts. A store outage or exhausted retries on POST is a retryable 503
// with Retry-After, which one-click clients retry.
import { unsubscribe } from "../../../../lib/newsletter/flow.ts";
import { outageOrThrow, readToken } from "../../../../lib/newsletter/http.ts";
import { runtimeDeps } from "../../../../lib/newsletter/runtime.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // store reads, up to six conditional-write retries
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rt = runtimeDeps();
  const base = rt.ok ? rt.deps.siteUrl : url.origin;
  if (!rt.ok) return Response.redirect(new URL("/newsletter/closed", base), 303);
  const target = new URL("/newsletter/unsubscribe", base);
  const t = url.searchParams.get("t"); if (t) target.searchParams.set("t", t);
  return Response.redirect(target, 303);
}

export async function POST(req: Request) {
  const rt = runtimeDeps();
  if (!rt.ok) return Response.json({ state: "closed" }, { status: 503, headers: noStore });
  let outcome;
  try { outcome = await unsubscribe(rt.deps, await readToken(req)); } catch (error) { return outageOrThrow("unsubscribe", error); }
  return Response.json({ state: outcome === "invalid" ? "invalid" : "unsubscribed" }, { status: 200, headers: noStore });
}
