import { NextResponse } from "next/server";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  listSpecialistIndex,
  updateSpecialistHealthcheck,
  type SpecialistIndexEntry,
} from "@/lib/onboarding/specialist-index";

import { observeListedHealth } from "@/lib/listings/listing-health";
import { bearerMatchesSecret } from "@/lib/http/cron-auth";

export const runtime = "nodejs";

const DATA_DIR = join(process.cwd(), "data", "onboarding");
const POLL_PATH = join(DATA_DIR, "heartbeat-poll.json");

function readHistory(): Array<{ polled_at: string; specialists_checked: number; results: Array<{ wallet: string; status: string }> }> {
  try {
    const raw = JSON.parse(readFileSync(POLL_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  // The scheduler sends the operator's CRON_SECRET and nobody else can trigger a sweep. In a
  // production build the sweep fails closed when no secret is configured (audit S2-claude-06);
  // local development may run it without one.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (secret && !bearerMatchesSecret(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // With a database configured, listings and their health live there, not in files.
  const sweep = await observeListedHealth();
  if (sweep.source === "database") {
    return NextResponse.json({ ok: sweep.available, specialists_checked: sweep.checked, updated_at: new Date().toISOString() }, { status: sweep.available ? 200 : 503 });
  }

  mkdirSync(DATA_DIR, { recursive: true });

  const index = listSpecialistIndex();
  const specialists = index.results as SpecialistIndexEntry[];

  const results: Array<{ wallet: string; status: string }> = [];
  for (const specialist of specialists) {
    if (!specialist.endpointUrl) {
      results.push({ wallet: specialist.walletAddress, status: "no_endpoint" });
      continue;
    }

    try {
      const response = await fetch(`${specialist.endpointUrl.replace(/\/$/, "")}/healthz`, {
        signal: AbortSignal.timeout(5000),
      });
      const healthy = response.ok || response.status < 500;
      const status = healthy ? "online" : "unhealthy";
      results.push({ wallet: specialist.walletAddress, status });

      updateSpecialistHealthcheck(specialist.walletAddress, {
        endpointUrl: specialist.endpointUrl,
        healthcheckStatus: healthy ? "pass" : "fail",
        attested: specialist.attested,
        reputationScore: specialist.reputation_score,
      });
    } catch {
      results.push({ wallet: specialist.walletAddress, status: "offline" });
      updateSpecialistHealthcheck(specialist.walletAddress, {
        endpointUrl: specialist.endpointUrl,
        healthcheckStatus: "fail",
        attested: specialist.attested,
        reputationScore: specialist.reputation_score,
      });
    }
  }

  const record = {
    polled_at: new Date().toISOString(),
    specialists_checked: specialists.length,
    results,
  };

  const history = readHistory();
  history.unshift(record);
  if (history.length > 100) history.length = 100;
  writeFileSync(POLL_PATH, JSON.stringify(history, null, 2));

  return NextResponse.json({
    ok: true,
    specialists_checked: specialists.length,
    updated_at: record.polled_at,
  });
}
