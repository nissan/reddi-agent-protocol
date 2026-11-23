// Every request for /<provider>/... goes to that provider's paid-call handler,
// which strips the /<provider> prefix itself. Unknown names are 404; a provider
// that is not fully set up answers 503 and charges nothing.
import { isProviderName } from "../../../lib/providers.ts";
import { provider } from "../../../lib/runtime.ts";

// The model's answer plus the settle confirming on chain.
export const maxDuration = 300;

const json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

async function handle(request: Request, ctx: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider: name } = await ctx.params;
  if (!isProviderName(name)) return json(404, "not_found", "No such provider.");
  const loaded = provider(name);
  if (!loaded.ok) return json(503, "provider_unavailable", "This provider is not taking calls right now. Nothing was charged.");
  return loaded.provider.handle(request);
}

export const GET = handle;
export const POST = handle;
