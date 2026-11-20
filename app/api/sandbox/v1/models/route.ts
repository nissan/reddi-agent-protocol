import { sandboxModelsListing } from "@/lib/sandbox/gateway";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await sandboxModelsListing(), { headers: { "cache-control": "no-store" } });
}
