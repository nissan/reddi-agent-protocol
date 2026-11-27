import { Connection } from "@solana/web3.js";
import { readPauseStatus } from "@redditech/x402-solana/pause";
import { getNetworkProfile } from "@/lib/config/network";
import { SOLANA_GENESIS_HASHES } from "@/lib/payments/session-auth";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import { serverRpcEndpoint } from "@/lib/rpc/server-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long one read of the pause account is reused, here and in shared caches. */
const CACHE_SECONDS = 60;
/** How long a failed read is reused, so a failing RPC is not asked on every page view. */
const FAILURE_SECONDS = 15;

type Answer = { status: number; body: Record<string, unknown> };
let cached: { at: number; ttlMs: number; answer: Answer } | null = null;
let inFlight: Promise<Answer> | null = null;
/** The server RPC's genesis hash, once checked against the profile. */
let clusterChecked = false;

/** The genesis hash the profile's cluster has, or null where there is none to check (a local validator). */
function expectedGenesis(): string | null {
  const name = getNetworkProfile().name;
  if (name === "mainnet") return SOLANA_GENESIS_HASHES["solana-mainnet-beta"];
  if (name === "devnet") return SOLANA_GENESIS_HASHES["solana-devnet"];
  return null;
}

async function read(): Promise<Answer> {
  const endpoint = serverRpcEndpoint();
  if (!endpoint.ok) return { status: 503, body: { ok: false, code: endpoint.code } };
  const connection = new Connection(endpoint.url, "confirmed");
  try {
    // The program id and the pause account are the same on every cluster: a server RPC on another
    // cluster than the profile's would show that cluster's pause.
    if (!clusterChecked) {
      const expected = expectedGenesis();
      if (expected !== null && (await connection.getGenesisHash()) !== expected) return { status: 503, body: { ok: false, code: "rpc_wrong_cluster" } };
      clusterChecked = true;
    }
    const status = await readPauseStatus(connection, ESCROW_PROGRAM_ID);
    return {
      status: 200,
      body: { ok: true, paused: status.paused, missing: status.missing, pausedUntilSlot: status.pausedUntilSlot.toString(), slot: status.slot.toString() },
    };
  } catch {
    return { status: 503, body: { ok: false, code: "rpc_unavailable" } };
  }
}

/**
 * GET /api/pause-status: whether the program's emergency pause is on now
 * (docs/EMERGENCY-PAUSE-RUNBOOK.md), for the banner every page shows. Read on
 * the server so pages make no RPC calls of their own; one read at a time,
 * reused for a minute (a failure for 15 seconds).
 */
export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > cached.ttlMs) {
    inFlight ??= read().finally(() => {
      inFlight = null;
    });
    const answer = await inFlight;
    cached = { at: Date.now(), ttlMs: (answer.status === 200 ? CACHE_SECONDS : FAILURE_SECONDS) * 1000, answer };
  }
  const { status, body } = cached.answer;
  return Response.json(body, status === 200 ? { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}` } } : { status });
}
