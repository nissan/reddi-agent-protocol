import { NextResponse } from "next/server";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { BUDGET_NETWORK, BUDGET_PROGRAM_ID, budgetConnection, budgetStore } from "@/lib/budget/runtime";
import { judgeStore } from "@/lib/budget/judge/store";
import { recordBudgetJobs } from "@/lib/jobs/budget-jobs-sweep";
import { refreshProviderStats } from "@/lib/jobs/provider-stats";
import type { ParsedBudgetTransaction } from "@/lib/jobs/budget-call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Records a job for each Budget slice paid out since the last pass (#1145), so My jobs and the
 * provider's track record show work paid from a Budget. Runs with the Budget watcher
 * (`.github/workflows/budget-watch.yml`). Only with CRON_SECRET. Answers 503 when a slice could
 * not be read, so the scheduler's run fails visibly; the slice is tried again next pass.
 *
 * Everything is this build's Budget network: its custody store, its chain and the judge's
 * receipts (`budget_mainnet` on mainnet). On mainnet the app holds no service role key, so it
 * reads the relay's receipts and writes `public.jobs` with its own role token
 * (`BUDGET_CUSTODY_ROLE_TOKEN`, role `budget_mainnet_app`), which may only record and look up
 * mainnet Budget jobs (migration 20261127110000). The provider's track record is refreshed with
 * the service role only, so on mainnet that best-effort step is skipped and the job stands.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const mainnet = BUDGET_NETWORK === "solana-mainnet-beta";
  const custody = budgetStore();
  const receipts = judgeStore(process.env, BUDGET_NETWORK);
  const jobAuth = mainnet ? { roleToken: process.env.BUDGET_CUSTODY_ROLE_TOKEN?.trim(), anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() } : {};
  if (!custody || !receipts || (mainnet && (!jobAuth.roleToken || !jobAuth.anonKey))) {
    return NextResponse.json({ ok: false, error: "budget_store_not_configured" }, { status: 503 });
  }
  let connection: ReturnType<typeof budgetConnection>;
  try {
    connection = budgetConnection();
  } catch {
    return NextResponse.json({ ok: false, error: "budget_rpc_not_configured" }, { status: 503 });
  }
  const outcomes = await recordBudgetJobs({
    ...jobAuth,
    programId: BUDGET_PROGRAM_ID,
    records: (statuses) => custody.withStatus(statuses),
    receipts: (slice, limit) => receipts.receipts(slice, limit),
    accountExists: async (address) => (await connection.getAccountInfo(address, "finalized")) !== null,
    signaturesFor: async (address, limit) => (await connection.getSignaturesForAddress(address, { limit }, "finalized")).map((s) => ({ signature: s.signature, err: s.err })),
    getParsedTransaction: async (signature) =>
      (await connection.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 })) as unknown as ParsedBudgetTransaction,
    ...(mainnet ? {} : { refreshProviderStats: (provider: string) => refreshProviderStats(provider) }),
  });
  const unreadable = outcomes.filter((o) => o.status === "unreadable").length;
  const recorded = outcomes.filter((o) => o.status === "recorded").length;
  const refused = outcomes.filter((o) => o.status === "refused");
  if (refused.length > 0) console.warn(JSON.stringify({ source: "budget-jobs", refused: refused.slice(0, 20) }));
  return NextResponse.json({ ok: unreadable === 0, slices: outcomes.length, recorded, unreadable, refused: refused.length, outcomes }, { status: unreadable === 0 ? 200 : 503 });
}
