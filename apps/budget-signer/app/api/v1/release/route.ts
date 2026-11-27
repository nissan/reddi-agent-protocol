import { handleRelease } from "@/lib/budget/signer-service";
import { signerContext } from "@/lib/budget/signer-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Release on completion, for the Budget watcher only (`BUDGET_RELEASE_TOKEN`):
 * `{ "id", "payee" }` releases that provider's posted slice of a Budget opened
 * without a judge, and pays it out. See lib/budget/release.ts.
 */
export function POST(req: Request) {
  return handleRelease(req, signerContext());
}
