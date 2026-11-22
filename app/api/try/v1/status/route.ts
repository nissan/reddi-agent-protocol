import { runTry } from "@/lib/try/flow";
import { devnetOrResponse, rateLimited, readJsonBody, secretOrResponse, tryError, tryJson } from "@/lib/try/http";
import { sandboxDevnetConnection, sandboxGatewayDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the try page: `waiting` until the lock lands, then the provider's answer and receipt (#925). */
export async function POST(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with the try token.");
  const secret = secretOrResponse();
  if (!secret.ok) return secret.response;
  try {
    const connection = sandboxDevnetConnection();
    const notDevnet = await devnetOrResponse(connection);
    if (notDevnet) return notDevnet;
    const startedMs = Date.now();
    const result = await runTry({ token: body.token, origin: new URL(request.url).origin, secret: secret.secret, connection, deps: sandboxGatewayDeps() });
    // How long the call and settle took once the lock was found, so a slow answer can be traced. Public data only.
    if (result.ok && result.state === "answered") console.info("[try] answered", { status: result.status, escrow: result.escrow, ms: Date.now() - startedMs });
    if (!result.ok) return tryError(result.status, result.code, result.message);
    return tryJson(result);
  } catch {
    return tryError(503, "chain_unavailable", "Devnet could not be read just now. Your lock is safe; the page will check again.");
  }
}
