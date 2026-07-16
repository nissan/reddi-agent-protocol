import { Suspense } from "react";

import {
  deriveAllReadinessGateViews,
  READINESS_GATE_VIEW_SCHEMA_VERSION,
} from "@/lib/onboarding/readiness-gate";

import { ReadinessGateClient } from "./readiness-gate-client";

export const metadata = {
  title: "Payment & readiness gates | Reddi Agent Protocol",
  description:
    "AUDD/Solana payment and readiness gates for generated listings: fail-closed gate states, dry-run receipt readback, and disabled live controls. Fixture-backed, no-spend.",
};

/**
 * #386 — AUDD/Solana payment and readiness gate UI.
 *
 * Server component: all five scenario view models are derived once from the
 * merged contracts (see lib/onboarding/readiness-gate.ts) and passed to the
 * client as plain JSON. Nothing on this route fetches, probes, pays, signs,
 * publishes, or mutates trust/reputation.
 */
export default function ReadinessGatePage() {
  const views = deriveAllReadinessGateViews();
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">Loading readiness gates…</div>}>
      <ReadinessGateClient views={views} schemaVersion={READINESS_GATE_VIEW_SCHEMA_VERSION} />
    </Suspense>
  );
}
