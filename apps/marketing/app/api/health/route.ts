// Health check. Answers 200 with a small JSON report (lib/health.ts): which build is answering and which switches are
// on. No secret, address or subscriber count is in it, so it needs no bearer. The scheduled check in
// .github/workflows/marketing-uptime.yml reads it, and so can any uptime monitor.
import { healthReport } from "../../../lib/health.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(healthReport(process.env, Date.now()), { status: 200, headers: { "Cache-Control": "no-store" } });
}
