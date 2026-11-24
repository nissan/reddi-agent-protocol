import { hashPassKey, passKeyFromAuthorization } from "@/lib/pass/pass";
import { passError, storeOrResponse } from "@/lib/pass/http";
import { rateLimited } from "@/lib/try/http";
import { findSandboxProviderById } from "@/lib/sandbox/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OpenAI-style model list: the models this pass pays for, with what is left on each (#1048). */
export async function GET(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const key = passKeyFromAuthorization(request.headers.get("authorization"));
  if (!key) return passError(401, "pass_key_missing", "Send the agent pass key as Authorization: Bearer rap_pass_…");
  const store = storeOrResponse();
  if (!store.ok) return store.response;
  try {
    const pass = await store.store.byKeyHash(hashPassKey(key));
    if (!pass) return passError(401, "pass_key_invalid", "This key is not an agent pass. Check it was copied whole.");
    return Response.json(
      {
        object: "list",
        data: pass.sessions.map((session) => {
          const provider = findSandboxProviderById(session.providerId);
          return {
            id: provider?.model ?? session.providerId,
            object: "model",
            owned_by: provider?.name ?? session.providerId,
            rap_pass: { status: pass.status, expiresAt: pass.expiresAt, maxLamports: session.maxLamports, spentLamports: session.cumulativeLamports, calls: session.sequence, closed: session.closed !== undefined },
          };
        }),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return passError(503, "pass_error", "The pass could not be read just now. Retry shortly.");
  }
}
