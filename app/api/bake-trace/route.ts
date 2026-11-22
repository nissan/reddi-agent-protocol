import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { legacyRouteGate } from "@/lib/http/route-gates";

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  const body = await req.json();
  const dataDir = join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "baked-trace.json"), JSON.stringify(body, null, 2));
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
