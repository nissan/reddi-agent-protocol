import { handleFreeze } from "@/lib/budget/signer-service";
import { signerContext } from "@/lib/budget/signer-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A payer freezes their own Budget, on their wallet's signature. See lib/budget/signer-service.ts. */
export function POST(req: Request) {
  return handleFreeze(req, signerContext());
}
