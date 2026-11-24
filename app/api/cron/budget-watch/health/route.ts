import { NextResponse } from "next/server";
import { budgetCustodyStore } from "@/lib/budget/store";
import { WATCH_STALE_MS } from "@/lib/budget/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * For an uptime monitor: 200 when the Budget watcher finished a complete,
 * error-free pass in the last 15 minutes, 503 otherwise. It says only how old
 * that pass is, nothing about any Budget.
 */
export async function GET() {
  const store = budgetCustodyStore();
  if (!store) return NextResponse.json({ ok: false, error: "budget_custody_not_configured" }, { status: 503 });
  let at: string | undefined;
  try {
    at = await store.watchedAt();
  } catch {
    return NextResponse.json({ ok: false, error: "store_unavailable" }, { status: 503 });
  }
  const ageSeconds = at ? Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000)) : null;
  const ok = ageSeconds !== null && ageSeconds * 1000 <= WATCH_STALE_MS;
  return NextResponse.json({ ok, lastCompletePassAgeSeconds: ageSeconds }, { status: ok ? 200 : 503 });
}
