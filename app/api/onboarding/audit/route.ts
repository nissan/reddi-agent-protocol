import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { toExplorerTxUrl } from "@/lib/config/explorer";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

const DATA_DIR = join(process.cwd(), "data", "onboarding");

function readJson(pathname: string): unknown[] {
  try {
    const raw = JSON.parse(readFileSync(pathname, "utf-8"));
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object" && Array.isArray((raw as { specialists?: unknown[] }).specialists)) {
      return (raw as { specialists: unknown[] }).specialists;
    }
    return [];
  } catch {
    return [];
  }
}

function summariseHeartbeatResults(results: unknown): string {
  if (!Array.isArray(results) || results.length === 0) return "No specialists checked.";
  return results
    .map((item) => {
      if (!item || typeof item !== "object") return "unknown";
      const record = item as { wallet?: string; status?: string };
      return `${record.wallet ?? "unknown"}: ${record.status ?? "unknown"}`;
    })
    .join(" • ");
}

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  const attestationsRaw = readJson(join(DATA_DIR, "attestations.json"));
  const heartbeatPollsRaw = readJson(join(DATA_DIR, "heartbeat-poll.json"));

  const attestations = attestationsRaw.slice(0, 50).map((record) => {
    const att = record as {
      id?: string;
      recordedAt?: string;
      createdAt?: string;
      jobIdHex?: string;
      operator?: string;
      operatorPubkeySuffix?: string;
      txSignature?: string;
      localOnly?: boolean;
      walletAddress?: string;
      endpointUrl?: string;
    };

    const txSignature = att.txSignature ?? null;
    return {
      timestamp: att.recordedAt ?? att.createdAt ?? "",
      job_id: att.jobIdHex ?? att.id ?? "",
      operator_pubkey_suffix: att.operatorPubkeySuffix ?? att.operator?.slice(-8) ?? "",
      tx_signature: txSignature,
      explorer_url: txSignature ? toExplorerTxUrl(txSignature) : null,
      local_only: att.localOnly ?? !txSignature,
      wallet_address: att.walletAddress ?? "",
      endpoint_url: att.endpointUrl ?? "",
    };
  });

  const heartbeat_polls = heartbeatPollsRaw.slice(0, 50).map((record) => {
    const poll = record as {
      polled_at?: string;
      specialists_checked?: number;
      results?: unknown;
    };

    return {
      polled_at: poll.polled_at ?? "",
      specialists_checked: poll.specialists_checked ?? 0,
      results_summary: summariseHeartbeatResults(poll.results),
    };
  });

  return NextResponse.json({
    ok: true,
    attestations,
    heartbeat_polls,
  });
}
