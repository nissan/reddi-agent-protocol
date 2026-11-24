import { handleHealth } from "@/lib/budget/signer-service";
import { signerContext } from "@/lib/budget/signer-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which network and spender key this signer serves. Public; no secret. */
export function GET() {
  return handleHealth(signerContext());
}
