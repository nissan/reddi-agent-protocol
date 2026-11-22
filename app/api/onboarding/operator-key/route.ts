import { NextResponse } from "next/server";
import { checkOperatorKeyStatus } from "@/lib/onboarding/operator-key";
import { legacyRouteGate } from "@/lib/http/route-gates";

export const runtime = "nodejs";

export async function GET() {
  const gated = legacyRouteGate();
  if (gated) return gated;
  const status = checkOperatorKeyStatus();
  return NextResponse.json({ ok: true, result: status });
}
