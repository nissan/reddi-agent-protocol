import { judgeContext } from "@/lib/budget/judge/runtime";
import { handleHealth } from "@/lib/budget/judge/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The judge's address, network, program, rule and SOL balance. Public; no secret. */
export function GET() {
  return handleHealth(judgeContext());
}
