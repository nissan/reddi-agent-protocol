// The project's root lists where each studio desk is served.
import { DESKS } from "../lib/desks.ts";

export function GET() {
  return Response.json(
    { studio: "RAP Studio (devnet)", desks: Object.keys(DESKS).map((name) => ({ name, path: `/${name}`, metadata: `/${name}/.well-known/reddi-agent.json` })) },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
