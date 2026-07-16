"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import type {
  ReadinessGateRow,
  ReadinessGateScenarioId,
  ReadinessGateStatus,
  ReadinessGateViewModel,
} from "@/lib/onboarding/readiness-gate";

const SCENARIO_ORDER: ReadinessGateScenarioId[] = [
  "ready",
  "blocked-payment",
  "blocked-evidence",
  "blocked-trust",
  "dry-run-receipt",
];

const STATUS_CHIP: Record<ReadinessGateStatus, string> = {
  ready: "border-[#14F195]/40 bg-[#14F195]/10 text-[#14F195]",
  needs_operator_review: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  blocked: "border-red-400/40 bg-red-400/10 text-red-300",
};

const STATUS_LABEL: Record<ReadinessGateStatus, string> = {
  ready: "ready",
  needs_operator_review: "needs operator review",
  blocked: "blocked",
};

function chipClass(status: ReadinessGateStatus): string {
  return `inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] ${STATUS_CHIP[status]}`;
}

function GateCard({ row }: { row: ReadinessGateRow }) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3"
      data-testid={`readiness-gate-${row.id}`}
      data-status={row.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{row.label}</h3>
        <span className={chipClass(row.status)}>{STATUS_LABEL[row.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">{row.summary}</p>
      {row.reasonCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid={`readiness-gate-${row.id}-reasons`}>
          {row.reasonCodes.map((code) => (
            <span
              key={code}
              className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {code}
            </span>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        {row.readback.map((field) => (
          <div key={field.label} className="contents">
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="break-all font-mono text-[11px] text-foreground/90">{field.value}</dd>
          </div>
        ))}
      </dl>
      {row.nextAction && (
        <div
          className="rounded-lg border border-red-400/30 bg-red-400/5 p-3 text-xs"
          data-testid={`readiness-gate-next-action-${row.id}`}
        >
          <p className="font-semibold text-red-200">Next action</p>
          <p className="mt-1 text-red-100/90">{row.nextAction}</p>
        </div>
      )}
      <p className="font-mono text-[10px] text-muted-foreground/70">{row.contractRefs.join(" · ")}</p>
    </div>
  );
}

function ReceiptField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-[11px] text-foreground/90">{value ?? "(none)"}</dd>
    </div>
  );
}

export function ReadinessGateClient({
  views,
  schemaVersion,
}: {
  views: Record<ReadinessGateScenarioId, ReadinessGateViewModel>;
  schemaVersion: string;
}) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("scenario");
  const initial: ReadinessGateScenarioId = SCENARIO_ORDER.includes(requested as ReadinessGateScenarioId)
    ? (requested as ReadinessGateScenarioId)
    : "ready";
  const [scenarioId, setScenarioId] = useState<ReadinessGateScenarioId>(initial);
  const view = views[scenarioId];

  function selectScenario(id: ReadinessGateScenarioId) {
    setScenarioId(id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("scenario", id);
      window.history.replaceState(null, "", url.toString());
    }
  }

  const paymentGates = view.gates.filter((row) => row.section === "payment");
  const trustGates = view.gates.filter((row) => row.section === "trust");
  const receipt = view.dryRunReceipt;
  const blocked = view.overall.status === "blocked";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10" data-testid="readiness-gate-page">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-[#14F195]">
          Onboarding · payment &amp; readiness gates · issue #386
        </p>
        <h1 className="text-2xl font-semibold">AUDD/Solana payment &amp; readiness gates</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Read-only gate evaluation for a generated listing: every verdict below comes verbatim from a shipped
          contract validator ({schemaVersion}). This surface decides nothing on its own and fails closed on any
          missing input.
        </p>
        <div
          className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-muted-foreground"
          data-testid="readiness-gate-boundary"
        >
          <p>
            <span className="font-semibold text-foreground">Discover / Decide / Prove boundary:</span> discovery
            metadata stays untrusted, decisions are local read-model events, and proof is dry-run receipts and
            evidence bindings — per <span className="font-mono">{view.auddBoundary.authorityDoc}</span>.
          </p>
          <p className="mt-2" data-testid="readiness-gate-audd-boundary">
            <span className="font-semibold text-foreground">AUDD boundary (#392):</span> {view.auddBoundary.copy}
          </p>
        </div>
      </header>

      <section className="space-y-3" aria-label="Fixture scenarios">
        <h2 className="text-lg font-semibold">1. Fixture scenario</h2>
        <div className="flex flex-wrap gap-2">
          {SCENARIO_ORDER.map((id) => {
            const scenario = views[id].scenario;
            const active = id === scenarioId;
            return (
              <button
                key={id}
                type="button"
                data-testid={`readiness-gate-scenario-${id}`}
                aria-pressed={active}
                onClick={() => selectScenario(id)}
                className={`min-h-9 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14F195] ${
                  active
                    ? "border-[#14F195]/60 bg-[#14F195]/10 text-[#14F195]"
                    : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/25"
                }`}
              >
                {scenario.label}
              </button>
            );
          })}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground" data-testid="readiness-gate-scenario-description">
          {view.scenario.description}
        </p>
      </section>

      <section
        className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3"
        data-testid="readiness-gate-source"
      >
        <h2 className="text-lg font-semibold">2. Listing under review</h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <ReceiptField label="Listing ref" value={view.source.listingRef} />
          <ReceiptField label="Display name" value={view.source.displayName} />
          <ReceiptField label="Source kind" value={view.source.sourceKind} />
          <ReceiptField label="Snapshot ref" value={view.source.snapshotRef} />
          <ReceiptField label="Declared endpoint" value={view.source.endpointUrl} />
          <ReceiptField label="Profile readiness (#575 lanes)" value={view.profileReadiness.overall} />
          <ReceiptField label="Evaluated at" value={view.evaluatedAt} />
        </dl>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground/80">
            Profile readiness lanes ({view.profileReadiness.lanes.length})
          </summary>
          <ul className="mt-2 space-y-1" data-testid="readiness-gate-profile-lanes">
            {view.profileReadiness.lanes.map((lane) => (
              <li key={lane.lane} className="font-mono text-[11px]">
                {lane.lane} = {lane.status}
                {lane.reasonCodes.length > 0 ? ` (${lane.reasonCodes.join(", ")})` : ""}
              </li>
            ))}
          </ul>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/onboarding/profile-editor"
            data-testid="readiness-gate-profile-editor-link"
            className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
          >
            ← Review / edit the generated profile
          </Link>
        </div>
      </section>

      <section
        className={`rounded-2xl border p-5 ${
          blocked ? "border-red-400/40 bg-red-400/5" : "border-[#14F195]/40 bg-[#14F195]/5"
        }`}
        data-testid="readiness-gate-overall"
        data-overall-status={view.overall.status}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            3. Overall: {blocked ? "blocked (fails closed)" : "ready for operator review"}
          </h2>
          <p className="font-mono text-xs text-muted-foreground" data-testid="readiness-gate-overall-counts">
            {view.overall.readyCount} ready · {view.overall.reviewCount} needs review · {view.overall.blockedCount}{" "}
            blocked
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{view.overall.headline}</p>
        {blocked && (
          <p className="mt-2 font-mono text-xs text-red-200" data-testid="readiness-gate-blocked-list">
            Failed gates: {view.overall.blockedGateIds.join(", ")}
          </p>
        )}
      </section>

      <section className="space-y-3" data-testid="readiness-gate-payment-section">
        <h2 className="text-lg font-semibold">4. Payment &amp; rail gates</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {paymentGates.map((row) => (
            <GateCard key={row.id} row={row} />
          ))}
        </div>
      </section>

      <section className="space-y-3" data-testid="readiness-gate-trust-section">
        <h2 className="text-lg font-semibold">5. Receipt, evidence &amp; trust gates</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {trustGates.map((row) => (
            <GateCard key={row.id} row={row} />
          ))}
        </div>
      </section>

      <section
        className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3"
        data-testid="readiness-gate-receipt"
        data-receipt-status={receipt.status}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">6. Dry-run receipt readback</h2>
          <span
            className={chipClass(
              receipt.status === "bound" ? "ready" : receipt.status === "denied" ? "blocked" : "blocked",
            )}
          >
            {receipt.status === "bound"
              ? "dry-run receipt bound"
              : receipt.status === "denied"
                ? "dry-run failed closed"
                : "no dry-run possible"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {receipt.status === "bound"
            ? "The complete no-spend chain for this listing: quote → buyer preflight → mocked invocation → receipt → evidence archive → #393 binding. These are the durable refs an operator or external agent can audit."
            : "No bound dry-run receipt exists for this scenario. The preflight reason codes below say exactly why the chain stopped — nothing is fabricated past the failure point."}
        </p>
        {receipt.reasonCodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {receipt.reasonCodes.map((code) => (
              <span
                key={code}
                className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {code}
              </span>
            ))}
          </div>
        )}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <ReceiptField
            label="Quote"
            value={
              receipt.quote
                ? `${receipt.quote.amountUnits} base units (${receipt.quote.amountDisplay}) · ${receipt.quote.asset} on ${receipt.quote.network} · ${receipt.quote.paymentMode}`
                : null
            }
          />
          <ReceiptField label="Quote expires" value={receipt.quote?.quoteExpiresAt ?? null} />
          <ReceiptField label="AUDD mint" value={receipt.quote?.mint ?? null} />
          <ReceiptField label="pay_to" value={receipt.payTo} />
          <ReceiptField label="Settlement account" value={receipt.settlementAccount} />
          <ReceiptField label="Policy approval" value={receipt.policyApproval} />
          <ReceiptField label="Payment proof ref" value={receipt.paymentProofRef} />
          <ReceiptField label="Receipt id" value={receipt.receiptId} />
          <ReceiptField label="Request hash" value={receipt.requestHash} />
          <ReceiptField label="Response hash" value={receipt.responseHash} />
          <ReceiptField label="EvidenceArchive record" value={receipt.evidenceId} />
          <ReceiptField label="Evidence ref" value={receipt.evidenceRef} />
          <ReceiptField label="Evidence hash" value={receipt.evidenceHash} />
          <ReceiptField label="#393 binding id" value={receipt.bindingId} />
          <ReceiptField label="Attestation id" value={receipt.attestationId} />
          <ReceiptField
            label="Reputation draft (not mutated)"
            value={
              receipt.reputationDraft
                ? `${receipt.reputationDraft.previousScore} → ${receipt.reputationDraft.nextScore} (${receipt.reputationDraft.routingImpact}) — draft only`
                : null
            }
          />
        </dl>
      </section>

      <section
        className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3"
        data-testid="readiness-gate-live-controls"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">7. Live payment controls</h2>
          <span className={chipClass("blocked")}>disabled — requirements never met in fixtures</span>
        </div>
        <p className="text-sm text-muted-foreground">{view.liveControls.copy}</p>
        <ul className="space-y-2">
          {view.liveControls.requirements.map((requirement) => (
            <li
              key={requirement.id}
              className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs"
              data-testid={`readiness-gate-live-requirement-${requirement.id}`}
            >
              <p className="font-semibold">
                {requirement.label}{" "}
                <span className="font-mono text-[11px] text-red-300">[{requirement.state}]</span>
              </p>
              <p className="mt-1 text-muted-foreground">{requirement.detail}</p>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="readiness-gate-live-control-button"
          className="min-h-9 cursor-not-allowed rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground opacity-50"
        >
          Enable live payments — unavailable (no backend readiness, no operator approval)
        </button>
      </section>

      <section
        className="rounded-2xl border border-white/10 bg-card/30 p-5 space-y-3"
        data-testid="readiness-gate-boundary-flags"
      >
        <h2 className="text-lg font-semibold">8. Hard boundary flags — all live flags false</h2>
        <p className="text-xs text-muted-foreground">{view.boundaries.note}</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(view.boundaries.flags).map(([key, value]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5"
            >
              <span className="font-mono text-[11px] text-muted-foreground">{key}</span>
              <span className="font-mono text-[11px] text-[#14F195]">{String(value)}</span>
            </div>
          ))}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground" data-testid="readiness-gate-seller-wrapper-validation">
          seller-wrapper config validation: {view.sellerWrapperValidation.valid ? "valid" : "invalid"} (
          {view.sellerWrapperValidation.reasonCodes.join(", ")})
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/onboarding/profile-editor"
          data-testid="readiness-gate-back-profile-editor"
          className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
        >
          Profile review editor
        </Link>
        <Link
          href="/onboarding/intake"
          className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
        >
          Guided intake
        </Link>
        <Link
          href="/manager/listings"
          className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
        >
          Operator review queue
        </Link>
        <Link
          href="/economic-demo/paid-workflow"
          className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-muted-foreground hover:border-white/25"
        >
          Buyer paid-workflow shell
        </Link>
      </div>
    </div>
  );
}
