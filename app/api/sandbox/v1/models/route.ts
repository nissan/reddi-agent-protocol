import { sandboxModelsListing } from "@/lib/sandbox/gateway";
import { sandboxGatewayDeps } from "@/lib/sandbox/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await sandboxModelsListing(sandboxGatewayDeps().settler), { headers: { "cache-control": "no-store" } });
}
