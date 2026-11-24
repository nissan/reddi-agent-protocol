import { passMinBudgetLamports, passProvidersAvailable, passView, startPass } from "@/lib/pass/pass";
import { passPayLink, storeOrResponse } from "@/lib/pass/http";
import { rateLimited, readJsonBody, secretOrResponse, tryError, tryJson } from "@/lib/try/http";
import { SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import { sandboxGatewayDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The providers a pass can name right now, with the smallest budget each takes. */
export async function GET(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  try {
    const available = await passProvidersAvailable(sandboxGatewayDeps(), SANDBOX_PROVIDERS);
    return tryJson({
      providers: available.map((provider) => ({ id: provider.id, name: provider.name, model: provider.model, pricing: provider.pricing, minLamports: passMinBudgetLamports(provider).toString() })),
    });
  } catch {
    return tryError(503, "chain_unavailable", "Devnet could not be reached. Try again in a moment.");
  }
}

/**
 * Opens an agent pass (#1048): budgets for up to three providers. Answers with
 * the Solana Pay link for the lock and the agent's key, shown this once.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "start");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with budgets: [{ providerId, lamports }].");
  const secret = secretOrResponse();
  if (!secret.ok) return secret.response;
  const store = storeOrResponse();
  if (!store.ok) return store.response;
  const origin = new URL(request.url).origin;
  try {
    const started = await startPass({ budgets: body.budgets, perCallMaxLamports: body.perCallMaxLamports, deps: sandboxGatewayDeps(), store: store.store });
    if (!started.ok) return tryError(started.status, started.code, started.message);
    return tryJson({ key: started.key, ...passPayLink(origin, started.pass.id), reference: started.pass.reference, baseUrl: `${origin}/api/pass/v1`, pass: passView(started.pass) });
  } catch {
    return tryError(500, "pass_error", "The pass could not be started. Nothing was asked of your wallet.");
  }
}
