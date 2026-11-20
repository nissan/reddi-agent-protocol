import { authenticateWalletRequest } from "@/lib/auth/wallet-session";
import { readOwnJobs } from "@/lib/jobs/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/jobs: the signed-in user's own jobs, newest first. */
export async function GET(req: Request) {
  const session = await authenticateWalletRequest(req.headers);
  if (!session.ok) {
    return Response.json({ ok: false, error: { code: session.code, message: session.message } }, { status: session.status });
  }
  const result = await readOwnJobs(session.accessToken);
  if (!result.ok) {
    return Response.json({ ok: false, error: { code: result.code, message: "Your jobs could not be loaded right now." } }, { status: 503 });
  }
  return Response.json({ ok: true, jobs: result.jobs });
}
