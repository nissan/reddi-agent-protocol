import { NextResponse } from "next/server";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import { describeRpcEndpoint, serverRpcEndpoint } from "@/lib/rpc/server-rpc";
import { checkOperatorKeyStatus } from "@/lib/onboarding/operator-key";
import { runSpecialistHealthcheck } from "@/lib/onboarding/healthcheck";
import { legacyRouteGate } from "@/lib/http/route-gates";

type CheckStatus = "pass" | "fail";

type PreflightCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  blocking: boolean;
  detail: string;
  fix?: string;
};

export const runtime = "nodejs";

function parseMinSolFloor() {
  const parsed = Number.parseFloat(process.env.ONBOARDING_PREFLIGHT_MIN_SOL ?? "0.02");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.02;
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json().catch(() => ({}));
    const endpointUrl = typeof body?.endpointUrl === "string" ? body.endpointUrl.trim() : "";
    const walletAddress = typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";

    const checks: PreflightCheck[] = [];

    // 1) Operator key
    const operator = checkOperatorKeyStatus();
    checks.push({
      id: "operator_key",
      label: "Attestation operator key",
      status: operator.state === "ready" ? "pass" : "fail",
      blocking: true,
      detail:
        operator.state === "ready"
          ? `Operator key loaded (suffix ...${operator.publicKey_suffix ?? "unknown"})`
          : operator.error ?? "Operator key missing/invalid",
      fix:
        operator.state === "ready"
          ? undefined
          : "Set ONBOARDING_ATTEST_OPERATOR_SECRET_KEY to a valid 64-byte JSON keypair and restart the app.",
    });

    // 2) Endpoint/runtime health
    if (!endpointUrl) {
      checks.push({
        id: "endpoint_health",
        label: "Endpoint + runtime reachability",
        status: "fail",
        blocking: true,
        detail: "Endpoint URL missing",
        fix: "Complete endpoint setup first, then run preflight again.",
      });
    } else {
      try {
        const health = await runSpecialistHealthcheck({ endpointUrl, walletAddress: walletAddress || "11111111111111111111111111111111" });
        checks.push({
          id: "endpoint_health",
          label: "Endpoint + runtime reachability",
          status: health.status === "pass" ? "pass" : "fail",
          blocking: true,
          detail: `${health.note} (status=${health.status}, x402=${health.x402Probe})`,
          fix:
            health.status === "pass"
              ? undefined
              : "Ensure tunnel/proxy is up, /api/tags is reachable, and /v1/* is exposed for x402 paths.",
        });
      } catch (error) {
        checks.push({
          id: "endpoint_health",
          label: "Endpoint + runtime reachability",
          status: "fail",
          blocking: true,
          detail: error instanceof Error ? error.message : "Healthcheck failed",
          fix: "Re-run endpoint onboarding and verify runtime/tunnel availability.",
        });
      }
    }

    // 3) Program ID / RPC consistency
    try {
      const endpoint = serverRpcEndpoint();
      if (!endpoint.ok) throw new Error(endpoint.message);
      const conn = new Connection(endpoint.url, "confirmed");
      const rpcHost = describeRpcEndpoint(endpoint.url);
      const escrowPk = new PublicKey(ESCROW_PROGRAM_ID);
      const [latest, programInfo] = await Promise.all([
        conn.getLatestBlockhash(),
        conn.getAccountInfo(escrowPk),
      ]);

      const ok = Boolean(programInfo?.executable) && Boolean(latest?.blockhash);
      checks.push({
        id: "rpc_program_consistency",
        label: "RPC + program consistency",
        status: ok ? "pass" : "fail",
        blocking: true,
        detail: ok
          ? `Program ${ESCROW_PROGRAM_ID} is executable on configured RPC (${rpcHost}).`
          : `Program ${ESCROW_PROGRAM_ID} is missing/non-executable on configured RPC (${rpcHost}).`,
        fix: ok
          ? undefined
          : "Align NEXT_PUBLIC_RPC_ENDPOINT + NEXT_PUBLIC_ESCROW_PROGRAM_ID to the same deployed cluster/program.",
      });
    } catch (error) {
      checks.push({
        id: "rpc_program_consistency",
        label: "RPC + program consistency",
        status: "fail",
        blocking: true,
        detail: error instanceof Error ? error.message : "RPC/program consistency check failed",
        fix: "Verify RPC endpoint is reachable and program ID is valid on that cluster.",
      });
    }

    // 4) Wallet balance floor
    const minSol = parseMinSolFloor();
    if (!walletAddress) {
      checks.push({
        id: "wallet_balance",
        label: "Wallet balance floor",
        status: "fail",
        blocking: true,
        detail: "Wallet address missing",
        fix: "Connect wallet before running money-moving actions.",
      });
    } else {
      try {
        const endpoint = serverRpcEndpoint();
        if (!endpoint.ok) throw new Error(endpoint.message);
        const conn = new Connection(endpoint.url, "confirmed");
        const lamports = await conn.getBalance(new PublicKey(walletAddress));
        const sol = lamports / LAMPORTS_PER_SOL;
        const ok = sol >= minSol;
        checks.push({
          id: "wallet_balance",
          label: "Wallet balance floor",
          status: ok ? "pass" : "fail",
          blocking: true,
          detail: `Wallet balance ${sol.toFixed(4)} SOL (required ≥ ${minSol.toFixed(4)} SOL).`,
          fix: ok ? undefined : `Airdrop/fund wallet to at least ${minSol.toFixed(2)} SOL before proceeding.`,
        });
      } catch (error) {
        checks.push({
          id: "wallet_balance",
          label: "Wallet balance floor",
          status: "fail",
          blocking: true,
          detail: error instanceof Error ? error.message : "Unable to read wallet balance",
          fix: "Verify connected wallet address and RPC reachability.",
        });
      }
    }

    const blockingFailures = checks.filter((c) => c.blocking && c.status === "fail");

    return NextResponse.json({
      ok: blockingFailures.length === 0,
      result: {
        checkedAt: new Date().toISOString(),
        blockingFailures: blockingFailures.length,
        checks,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Preflight failed",
      },
      { status: 400 }
    );
  }
}
