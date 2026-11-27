import { NextResponse } from "next/server";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";
import { BUDGET_NETWORK, BUDGET_PROGRAM_ID } from "@/lib/budget/runtime";
import { budgetCustodyStore } from "@/lib/budget/store";
import { judgeStore } from "@/lib/budget/judge/store";
import { recordBudgetJobs } from "@/lib/jobs/budget-jobs-sweep";
import { refreshProviderStats } from "@/lib/jobs/provider-stats";
import { sandboxDevnetConnection } from "@/lib/sandbox/runtime";
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
 * Devnet only for now. On mainnet the app's database role may add receipts but not read them
 * (#1210), and the jobs it would write live in devnet's tables, so a mainnet build answers 503
 * rather than mix networks; mainnet Budget jobs need their own reader (#1145).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (BUDGET_NETWORK !== "solana-devnet") {
    return NextResponse.json({ ok: false, error: "budget_jobs_devnet_only", network: BUDGET_NETWORK }, { status: 503 });
  }
  const custody = budgetCustodyStore();
  const receipts = judgeStore();
  if (!custody || !receipts) return NextResponse.json({ ok: false, error: "budget_store_not_configured" }, { status: 503 });
  const connection = sandboxDevnetConnection();
  const outcomes = await recordBudgetJobs({
    programId: BUDGET_PROGRAM_ID,
    records: (statuses) => custody.withStatus(statuses),
    receipts: (slice, limit) => receipts.receipts(slice, limit),
    accountExists: async (address) => (await connection.getAccountInfo(address, "finalized")) !== null,
    signaturesFor: async (address, limit) => (await connection.getSignaturesForAddress(address, { limit }, "finalized")).map((s) => ({ signature: s.signature, err: s.err })),
    getParsedTransaction: async (signature) =>
      (await connection.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 })) as unknown as ParsedBudgetTransaction,
    refreshProviderStats: (provider) => refreshProviderStats(provider),
  });
  const unreadable = outcomes.filter((o) => o.status === "unreadable").length;
  const recorded = outcomes.filter((o) => o.status === "recorded").length;
  const refused = outcomes.filter((o) => o.status === "refused");
  if (refused.length > 0) console.warn(JSON.stringify({ source: "budget-jobs", refused: refused.slice(0, 20) }));
  return NextResponse.json({ ok: unreadable === 0, slices: outcomes.length, recorded, unreadable, refused: refused.length, outcomes }, { status: unreadable === 0 ? 200 : 503 });
}
