// Confirmation endpoint (WEB-25, WEB-27): GET only shows the page with one button, so a link scanner or mail-client
// prefetch can never confirm on the visitor's behalf; POST performs the change. A store outage or exhausted retries
// on POST is a retryable 503, never "invalid".
import { confirm } from "../../../../lib/newsletter/flow.ts";
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
  const target = new URL("/newsletter/confirm", base);
  const t = url.searchParams.get("t"); if (t) target.searchParams.set("t", t);
  return Response.redirect(target, 303);
}

export async function POST(req: Request) {
  const rt = runtimeDeps();
  if (!rt.ok) return Response.json({ state: "closed" }, { status: 503, headers: noStore });
  let outcome;
  try { outcome = await confirm(rt.deps, await readToken(req)); } catch (error) { return outageOrThrow("confirm", error); }
  const state = outcome === "confirmed" || outcome === "already-confirmed" ? "confirmed" : outcome === "expired" ? "expired" : "invalid";
  return Response.json({ state }, { status: 200, headers: noStore });
}
