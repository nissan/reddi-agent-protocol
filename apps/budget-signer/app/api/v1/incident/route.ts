import { handleIncident } from "@/lib/budget/signer-service";
import { signerContext } from "@/lib/budget/signer-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Budget incident step, for the operator only (`BUDGET_INCIDENT_SECRET`):
 * `{ "action": "pause" | "close-all", "reason": "..." }`. See
 * docs/BUDGET-RELAY-CUSTODY.md.
 */
export function POST(req: Request) {
  return handleIncident(req, signerContext());
}
