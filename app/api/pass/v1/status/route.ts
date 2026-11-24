import { activatePass, passView } from "@/lib/pass/pass";
import { storeOrResponse } from "@/lib/pass/http";
import { devnetOrResponse, rateLimited, readJsonBody, secretOrResponse, tryError, tryJson } from "@/lib/try/http";
import { sandboxDevnetConnection } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the pass page: `waiting` until the lock lands, then `active` with what each provider has spent (#1048). */
export async function POST(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with the pass id.");
  const secret = secretOrResponse();
  if (!secret.ok) return secret.response;
  const store = storeOrResponse();
  if (!store.ok) return store.response;
  try {
    const connection = sandboxDevnetConnection();
    const notDevnet = await devnetOrResponse(connection);
    if (notDevnet) return notDevnet;
    const result = await activatePass({ passId: body.id, secret: secret.secret, connection, store: store.store });
    if (!result.ok) return tryError(result.status, result.code, result.message);
    return tryJson({ pass: passView(result.pass) });
  } catch {
    return tryError(503, "chain_unavailable", "Devnet could not be read just now. Your lock is safe; the page will check again.");
  }
}
