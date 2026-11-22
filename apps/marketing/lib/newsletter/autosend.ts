// The HTTP side of newsletter issues, kept apart from the route file so tests can call it with updates they supply.
// Authenticated exactly like the prune route: Vercel cron calls GET daily (vercel.json) with
// `Authorization: Bearer <CRON_SECRET>`; with no CRON_SECRET the answer is 503 and with a missing or wrong bearer 401.
// Fail-closed in two more places: nothing happens unless the newsletter is configured and enabled, and not unless the
// owner has also set NEWSLETTER_AUTOSEND=1 (default off). `?dry-run=1` reports what the next run would do and sends
// nothing, whatever the switch says. The response and the single log line carry slugs and counts only: never an
// address, a key or a token.
import { timingSafeEqual } from "node:crypto";
import { previewIssues, runNewsletter, type IssueUpdate } from "./issues.ts";
import { isOutage, retryLater } from "./http.ts";
import { runtimeDeps } from "./runtime.ts";

const noStore = { "Cache-Control": "no-store" };

export function authorised(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const autosendOn = (env: Record<string, string | undefined> = process.env) => env.NEWSLETTER_AUTOSEND === "1";

export async function autosendHandler(req: Request, updates: readonly IssueUpdate[]): Promise<Response> {
  if (!process.env.CRON_SECRET) return Response.json({ state: "not-configured" }, { status: 503, headers: noStore });
  if (!authorised(req, process.env.CRON_SECRET)) return new Response(null, { status: 401, headers: noStore });
  const rt = runtimeDeps();
  if (!rt.ok) return Response.json({ state: "closed" }, { status: 200, headers: noStore });
  try {
    if (new URL(req.url).searchParams.get("dry-run") === "1") return Response.json({ state: "dry-run", autosend: autosendOn(), ...(await previewIssues(rt.deps, updates)) }, { status: 200, headers: noStore });
    if (!autosendOn()) return Response.json({ state: "autosend-off" }, { status: 200, headers: noStore });
    const report = await runNewsletter(rt.deps, updates);
    console.log(`newsletter: issue ${JSON.stringify(report)}`);
    return Response.json({ state: report.active ? "ran" : "waiting-for-first-subscriber", ...report }, { status: 200, headers: noStore });
  } catch (error) {
    // A mailer or store failure part-way: the ledger shows who was reached and the next run resumes. The log names the
    // error type only (a provider message could contain an address).
    console.error(`newsletter: issue interrupted: ${error instanceof Error ? error.name : "unknown error"}`);
    if (isOutage(error)) return retryLater();
    return Response.json({ state: "interrupted" }, { status: 502, headers: noStore });
  }
}
