import { passCall, passKeyFromAuthorization } from "@/lib/pass/pass";
import { passError, storeOrResponse } from "@/lib/pass/http";
import { rateLimited, readJsonBody, secretOrResponse } from "@/lib/try/http";
import { sandboxGatewayDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The agent's endpoint (#1048): an OpenAI-style chat completion, paid from the
 * pass named by `Authorization: Bearer rap_pass_…`. The answer carries a
 * `rap_pass` block with what the call cost, what is left and the provider's
 * signed receipt.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const key = passKeyFromAuthorization(request.headers.get("authorization"));
  if (!key) return passError(401, "pass_key_missing", "Send the agent pass key as Authorization: Bearer rap_pass_…");
  const body = await readJsonBody(request, 64 * 1024);
  if (!body) return passError(400, "invalid_request", "Send an OpenAI-style chat request as JSON.");
  if (body.stream === true) return passError(400, "stream_unsupported", "Streaming is not offered on a pass yet. Send the request with stream false.");
  const secret = secretOrResponse();
  if (!secret.ok) return secret.response;
  const store = storeOrResponse();
  if (!store.ok) return store.response;
  try {
    const result = await passCall({ key, body, origin: new URL(request.url).origin, secret: secret.secret, deps: sandboxGatewayDeps(), store: store.store });
    if (!result.ok) return passError(result.status, result.code, result.message);
    return Response.json(result.body, { headers: { "cache-control": "no-store" } });
  } catch {
    return passError(503, "pass_error", "The call could not be made. Nothing was charged; retry shortly.");
  }
}
