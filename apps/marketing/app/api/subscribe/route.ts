// Newsletter subscribe endpoint (WEB-07, hardened in WEB-25 and WEB-27). Disabled (503) unless the owner has set
// the newsletter environment variables; under the partial-start contract only allow-listed owner mailboxes are
// stored or emailed. Every request that passes the same checks gets the same 202 body after the same minimum
// latency: the store write and the confirmation email run after the response (WEB-27-S02), so neither the reply,
// its timing nor a provider outage reveals whether an address is known. No contact data is logged.
import { SIGNUP_COPY } from "../../../lib/newsletter/copy.ts";
import { subscribe, validEmail } from "../../../lib/newsletter/flow.ts";
import { DurableLimiter, MIN_RESPONSE_MS, clientKey, holdUntil, readSmallJson, sameOrigin } from "../../../lib/newsletter/http.ts";
import { defer, runtimeDeps } from "../../../lib/newsletter/runtime.ts";

const noStore = { "Cache-Control": "no-store" };
const GENERIC = { ok: true, message: SIGNUP_COPY.replyMessage };

export const dynamic = "force-dynamic";
// The deferred work (store write, up to six conditional-write retries, provider call) shares this limit with the response (WEB-28).
export const maxDuration = 30;

export async function POST(req: Request) {
  const started = Date.now();
  const rt = runtimeDeps();
  if (!rt.ok) return Response.json({ error: "Newsletter signup is not open. This preview does not collect email addresses." }, { status: 503, headers: noStore });
  if (!sameOrigin(req, rt.deps.siteUrl)) return Response.json({ error: "Cross-origin requests are not accepted." }, { status: 403, headers: noStore });
  const limiter = new DurableLimiter(rt.deps.store, rt.deps.config.signingSecret);
  if (!(await limiter.allow(clientKey(req), rt.deps.now(), (work) => defer("limit sweep", work)))) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429, headers: { ...noStore, "Retry-After": "60" } });
  const body = await readSmallJson(req);
  if (!body.ok || typeof body.value !== "object" || body.value === null) return Response.json({ error: "Send a small JSON body with an email field." }, { status: 400, headers: noStore });
  const email = (body.value as Record<string, unknown>).email;
  if (!validEmail(email)) return Response.json({ error: "That does not look like an email address." }, { status: 400, headers: noStore });
  // accepted, already-confirmed, not-allowed, rate-limited, unsubscribed-resubscribe-sent and a provider failure all read the same to the visitor.
  defer("subscribe", () => subscribe(rt.deps, email));
  await holdUntil(started, MIN_RESPONSE_MS);
  return Response.json(GENERIC, { status: 202, headers: noStore });
}
