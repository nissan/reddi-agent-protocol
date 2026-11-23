// The project's root lists where each provider is served.
import { PROVIDERS } from "../lib/providers.ts";

export function GET() {
  return Response.json({ providers: Object.keys(PROVIDERS).map((name) => ({ name, path: `/${name}`, metadata: `/${name}/.well-known/reddi-agent.json` })) }, { headers: { "cache-control": "public, max-age=300" } });
}
