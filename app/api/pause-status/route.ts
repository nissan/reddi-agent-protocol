import { Connection } from "@solana/web3.js";
import { readPauseStatus } from "@redditech/x402-solana/pause";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import { serverRpcEndpoint } from "@/lib/rpc/server-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long one read of the pause account is reused, here and in shared caches. */
const CACHE_SECONDS = 60;
let cached: { at: number; body: Record<string, unknown> } | null = null;

/**
 * GET /api/pause-status: whether the program's emergency pause is on now
 * (docs/EMERGENCY-PAUSE-RUNBOOK.md), for the banner every page shows. Read on
 * the server so pages make no RPC calls of their own, and reused for a minute.
 */
export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_SECONDS * 1000) {
    const endpoint = serverRpcEndpoint();
    if (!endpoint.ok) return Response.json({ ok: false, code: endpoint.code }, { status: 503 });
    try {
      const status = await readPauseStatus(new Connection(endpoint.url, "confirmed"), ESCROW_PROGRAM_ID);
      cached = {
        at: now,
        body: { ok: true, paused: status.paused, missing: status.missing, pausedUntilSlot: status.pausedUntilSlot.toString(), slot: status.slot.toString() },
      };
    } catch {
      return Response.json({ ok: false, code: "rpc_unavailable" }, { status: 503 });
    }
  }
  return Response.json(cached.body, { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}` } });
}
