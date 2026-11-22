import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";

import { SANDBOX_ESCROW_PROGRAM_ID } from "@/lib/sandbox/escrow";
import { ACCEPT_RATED_ESCROWS_ENV, acceptRatedEscrowsConfigured, SELLER_RATING_SCORE_ENV, sellerRatingScore, sweepSellerRatings, type SellerRatingConnection } from "@/lib/sandbox/seller-rating";
import { parseSandboxPayeeKeys, SANDBOX_PAYEE_KEYS_ENV } from "@/lib/sandbox/settle-signer";
import { isDevnetConnection } from "@/lib/sandbox/devnet-genesis";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled: the sandbox providers commit and reveal their ratings of buyers
 * for rated escrows they settled (#842). Does nothing unless the sandbox was
 * configured to accept rated escrows (SANDBOX_ACCEPT_RATED_ESCROWS=true) and
 * CRON_SECRET is set and sent. Devnet only, with the devnet keys the server
 * already holds for the sandbox settle (SANDBOX_PAYEE_KEYS) and no other.
 */
export async function GET(req: Request) {
  // Off first: without rated escrows accepted nothing is read, no key is parsed and no RPC is opened.
  if (!acceptRatedEscrowsConfigured(process.env[ACCEPT_RATED_ESCROWS_ENV])) {
    return NextResponse.json({ ok: true, enabled: false, steps: 0 });
  }
  // This sweep signs, so unlike the heartbeat it fails closed: it runs only for the scheduler that
  // sends the operator's CRON_SECRET, and not at all when no secret is configured.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, enabled: true, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!bearerMatchesSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Only the sandbox providers' own settle keys: a rating names its specialist, and only ratings
  // naming one of these keys are found and signed for.
  const keypairs = [...parseSandboxPayeeKeys(process.env[SANDBOX_PAYEE_KEYS_ENV]).values()];
  if (keypairs.length === 0) return NextResponse.json({ ok: true, enabled: true, steps: 0 });
  const connection = new Connection(process.env.SANDBOX_DEVNET_RPC_URL?.trim() || "https://api.devnet.solana.com", "confirmed");
  if (!(await isDevnetConnection(connection))) {
    return NextResponse.json({ ok: false, enabled: true, error: "The seller-rating sweep signs on devnet only, and SANDBOX_DEVNET_RPC_URL is not devnet." }, { status: 503 });
  }
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
