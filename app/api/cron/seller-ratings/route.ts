import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

import { SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";
import { ACCEPT_RATED_ESCROWS_ENV, acceptRatedEscrowsConfigured, SELLER_RATING_SCORE_ENV, sellerRatingScore, sweepSellerRatings, type SellerRatingConnection } from "@/lib/sandbox/seller-rating";
import { parseSandboxPayeeKeys, SANDBOX_PAYEE_KEYS_ENV } from "@/lib/sandbox/settle-signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled: the sandbox providers commit and reveal their ratings of buyers
 * for rated escrows they settled (#842). Does nothing unless the sandbox was
 * configured to accept rated escrows. Devnet only, with the devnet keys the
 * server already holds for the sandbox settle.
 */
export async function GET(req: Request) {
  // When the operator sets CRON_SECRET the scheduler sends it, and nobody else can trigger a sweep.
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!acceptRatedEscrowsConfigured(process.env[ACCEPT_RATED_ESCROWS_ENV])) {
    return NextResponse.json({ ok: true, enabled: false, steps: 0 });
  }
  const keypairs = [...parseSandboxPayeeKeys(process.env[SANDBOX_PAYEE_KEYS_ENV]).values()];
  const connection = new Connection(process.env.SANDBOX_DEVNET_RPC_URL?.trim() || "https://api.devnet.solana.com", "confirmed");
  const steps = await sweepSellerRatings({
    connection: connection as unknown as SellerRatingConnection,
    programId: SANDBOX_ESCROW_PROGRAM_ID,
    keypairs,
    score: sellerRatingScore(process.env[SELLER_RATING_SCORE_ENV]),
  });
  const failed = steps.filter((step) => step.action === "failed").length;
  // Addresses and counts only: no salts or scores before they are revealed.
  return NextResponse.json({ ok: failed === 0, enabled: true, steps: steps.length, committed: steps.filter((step) => step.action === "committed").length, revealed: steps.filter((step) => step.action === "revealed").length, failed }, { status: failed === 0 ? 200 : 502 });
}
