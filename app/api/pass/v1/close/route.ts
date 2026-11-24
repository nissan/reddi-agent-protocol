import { closePass, passKeyFromAuthorization, passView } from "@/lib/pass/pass";
import { passError, storeOrResponse } from "@/lib/pass/http";
import { rateLimited, secretOrResponse } from "@/lib/try/http";
import { sandboxGatewayDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends a pass early (#1048): each provider settles what it served and the rest of each lock goes back to the wallet that paid. */
export async function POST(request: Request) {
  const limited = rateLimited(request, "start");
  if (limited) return limited;
  const key = passKeyFromAuthorization(request.headers.get("authorization"));
  if (!key) return passError(401, "pass_key_missing", "Send the agent pass key as Authorization: Bearer rap_pass_…");
  const secret = secretOrResponse();
  if (!secret.ok) return secret.response;
  const store = storeOrResponse();
  if (!store.ok) return store.response;
  try {
    const result = await closePass({ key, origin: new URL(request.url).origin, secret: secret.secret, deps: sandboxGatewayDeps(), store: store.store });
    if (!result.ok) return passError(result.status, result.code, result.message);
    return Response.json({ pass: passView(result.pass), failures: result.failures }, { headers: { "cache-control": "no-store" } });
  } catch {
    return passError(503, "pass_error", "The pass could not be closed just now. Retry shortly; nothing more was charged.");
  }
}
