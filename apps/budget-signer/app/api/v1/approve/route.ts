import { handleApprove } from "@/lib/budget/signer-service";
import { signerContext } from "@/lib/budget/signer-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One spender approval, for the main app only (`BUDGET_SIGNER_TOKEN`). See lib/budget/signer-service.ts. */
export function POST(req: Request) {
  return handleApprove(req, signerContext());
}
