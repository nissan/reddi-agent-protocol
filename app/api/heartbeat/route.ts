/**
 * POST /api/heartbeat
 *
 * Polls all registered specialists' endpoints and updates their health state
 * in the specialist index. Designed to be called by:
 * - A cron job / scheduler (Vercel Cron, GitHub Actions, n8n)
 * - The specialist's own client (local polling)
 * - Manual trigger from the specialist dashboard
 *
 * Returns: updated health states for all specialists polled.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  updateSpecialistHealthcheck,
  type SpecialistIndexEntry,
} from "@/lib/onboarding/specialist-index";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

const INDEX_PATH = join(process.cwd(), "data", "onboarding", "specialist-index.json");

function readIndex(): SpecialistIndexEntry[] {
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf8")) as SpecialistIndexEntry[];
  } catch { return []; }
}

type HealthPollResult = {
  walletAddress: string;
  endpointUrl: string;
  previousStatus: string;
  newStatus: "pass" | "fail";
  latencyMs: number;
  error?: string;
};

async function probeEndpoint(url: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    // Probe the x402-safe public path (/healthz or /v1/models)
    const probeUrl = url.replace(/\/$/, "") + "/healthz";
    const res = await fetch(probeUrl, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - start;
    // 200 = online, 401/403 = token gated but alive, 402 = x402 challenge (alive)
    const alive = res.status < 500;
    return { ok: alive, latencyMs };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : "probe failed",
    };
  }
}

export async function POST(req: Request) {
  const gated = legacyRouteGate();
  if (gated) return gated;
  try {
    const body = await req.json().catch(() => ({}));
    const targetWallet: string | undefined = body.wallet;

    const records = readIndex();
    const toProbe = targetWallet
      ? records.filter((r) => r.walletAddress === targetWallet)
      : records.filter((r) => r.endpointUrl);

    if (toProbe.length === 0) {
      return Response.json({
        ok: true,
        message: "No endpoints to probe.",
        polled: 0,
        results: [],
      });
    }

    const results: HealthPollResult[] = [];

    for (const entry of toProbe) {
      if (!entry.endpointUrl) continue;
      const probe = await probeEndpoint(entry.endpointUrl);
      const newStatus: "pass" | "fail" = probe.ok ? "pass" : "fail";
      const previousStatus = entry.healthcheckStatus ?? "unknown";

      updateSpecialistHealthcheck(entry.walletAddress, {
        endpointUrl: entry.endpointUrl,
        healthcheckStatus: newStatus,
        attested: entry.attested,
        reputationScore: entry.reputation_score,
      });

      results.push({
        walletAddress: entry.walletAddress,
        endpointUrl: entry.endpointUrl,
        previousStatus,
        newStatus,
        latencyMs: probe.latencyMs,
        error: probe.error,
      });
    }

    const passed = results.filter((r) => r.newStatus === "pass").length;
    const failed = results.filter((r) => r.newStatus === "fail").length;

    return Response.json({
      ok: true,
      polled: results.length,
      passed,
      failed,
      results,
      polledAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Heartbeat failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  // Return current health snapshot without polling
  const records = readIndex();
  const snapshot = records.map((r) => ({
    walletAddress: r.walletAddress,
    endpointUrl: r.endpointUrl ?? null,
    healthcheckStatus: r.healthcheckStatus ?? "unknown",
    updatedAt: r.updatedAt,
  }));

  const online = snapshot.filter((s) => s.healthcheckStatus === "pass").length;
  const offline = snapshot.filter((s) => s.healthcheckStatus === "fail").length;

  return Response.json({
    ok: true,
    total: snapshot.length,
    online,
    offline,
    unknown: snapshot.length - online - offline,
    specialists: snapshot,
  });
}
