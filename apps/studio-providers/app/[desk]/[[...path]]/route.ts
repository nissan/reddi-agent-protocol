// Every request for /<desk>/... goes to that desk's paid-call handler, which strips the /<desk> prefix
// itself. Unknown names are 404; a desk that is not fully set up answers 503 and charges nothing.
import { isDesk } from "../../../lib/desks.ts";
import { desk } from "../../../lib/runtime.ts";

// Start and status answer at once; a collect reads the file and the settle confirms on chain.
export const maxDuration = 300;

const json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });

async function handle(request: Request, ctx: { params: Promise<{ desk: string }> }): Promise<Response> {
  const { desk: name } = await ctx.params;
  if (!isDesk(name)) return json(404, "not_found", "No such desk.");
  const loaded = desk(name);
  if (!loaded.ok) return json(503, "provider_unavailable", "This desk is not taking calls right now. Nothing was charged.");
  return loaded.provider.handle(request);
}

export const GET = handle;
export const POST = handle;
