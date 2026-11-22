// Switches a confirmed subscriber between the weekly digest and daily issues. Like unsubscribe, the emailed link's GET
// only opens a one-button page; the page's POST makes the change. The choice is in the query (`f=daily|weekly`) and
// the signed token (purpose "preferences", an opaque contact key) in the body or query.
import { setFrequency } from "../../../../lib/newsletter/flow.ts";
import { outageOrThrow, readToken } from "../../../../lib/newsletter/http.ts";
import { runtimeDeps } from "../../../../lib/newsletter/runtime.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rt = runtimeDeps();
  const base = rt.ok ? rt.deps.siteUrl : url.origin;
  if (!rt.ok) return Response.redirect(new URL("/newsletter/closed", base), 303);
  const target = new URL("/newsletter/frequency", base);
  for (const k of ["t", "f"]) { const v = url.searchParams.get(k); if (v) target.searchParams.set(k, v); }
  return Response.redirect(target, 303);
}

export async function POST(req: Request) {
  const rt = runtimeDeps();
  if (!rt.ok) return Response.json({ state: "closed" }, { status: 503, headers: noStore });
  const f = new URL(req.url).searchParams.get("f");
  let outcome;
  try { outcome = await setFrequency(rt.deps, await readToken(req), f); } catch (error) { return outageOrThrow("frequency", error); }
  return Response.json({ state: outcome }, { status: 200, headers: noStore });
}
