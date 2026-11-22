import { startTry } from "@/lib/try/flow";
import { rateLimited, readJsonBody, secretOrResponse, solanaPayLink, tryError, tryJson } from "@/lib/try/http";
import { sandboxGatewayDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts one paid try: the provider's challenge and a Solana Pay link for it (#925). */
export async function POST(request: Request) {
  const limited = rateLimited(request, "start");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with a taskId.");
  const secret = secretOrResponse();
  if (!secret.ok) return secret.response;
  const origin = new URL(request.url).origin;
  try {
    const started = await startTry({ taskId: body.taskId, origin, secret: secret.secret, deps: sandboxGatewayDeps() });
    if (!started.ok) return tryError(started.status, started.code, started.message);
    return tryJson({
      token: started.token,
      ...solanaPayLink(origin, started.token),
      reference: started.ticket.reference,
      maxLamports: started.ticket.maxLamports,
      expiresAt: started.ticket.exp,
      task: { id: started.task.id, title: started.task.title, prompt: started.task.prompt },
      provider: { id: started.provider.id, name: started.provider.name, payTo: started.provider.payTo, pricing: started.provider.pricing },
    });
  } catch {
    return tryError(500, "try_error", "The try could not be started. Nothing was asked of your wallet.");
  }
}
