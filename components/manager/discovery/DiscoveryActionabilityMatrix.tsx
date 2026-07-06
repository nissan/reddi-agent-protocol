import type React from "react";
import { Grid3x3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type {
  DiscoveryActionabilityLaneCell,
  DiscoveryActionabilityMatrix,
} from "@/lib/manager/discovery-actionability-matrix";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<DiscoveryActionabilityLaneCell["tone"], string> = {
  neutral: "border-border bg-page/60 text-muted-foreground",
  caution: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  negative: "border-red-500/40 bg-red-500/10 text-red-200",
  positive: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
};

export function DiscoveryActionabilityMatrixPanel({ matrix }: { matrix: DiscoveryActionabilityMatrix }) {
  return (
    <section
      className="rounded-lg border border-border bg-surface/60 p-4"
      aria-label="Discovery actionability matrix"
      data-testid="discovery-actionability-matrix"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <span className="text-accent-green [&_svg]:size-4">
            <Grid3x3 />
          </span>
          Actionability Matrix
        </h3>
        <Badge variant="outline" className="text-[11px]">discovery ≠ trust</Badge>
      </div>

      <p className="mt-2 text-xs text-muted-foreground" data-testid="discovery-actionability-boundary">
        {matrix.discoveryTrustBoundary.note}
      </p>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {matrix.lanes.map((lane) => (
          <div
            key={lane.lane}
            className="rounded-lg border border-border bg-page/50 p-3"
            data-testid={`discovery-actionability-lane-${lane.lane}`}
          >
            <dt className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">{lane.laneLabel}</span>
              <span
                className={cn(
                  "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                  TONE_CLASSES[lane.tone],
                )}
                data-testid={`discovery-actionability-state-${lane.lane}`}
              >
                {lane.stateLabel}
              </span>
            </dt>
            <dd className="mt-2 text-xs leading-5 text-muted-foreground">
              {lane.summary}
              {lane.reasonCodes.length > 0 && (
                <span className="mt-1 block break-words font-mono text-[10px] text-muted-foreground/80">
                  {lane.reasonCodes.join(", ")}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div
        className="mt-4 grid gap-2 rounded-lg border border-dashed border-border bg-page/40 p-3 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4"
        data-testid="discovery-actionability-provenance"
      >
        <ProvenanceField label="Origin" value={matrix.provenance.origin} />
        <ProvenanceField label="Origin kind" value={matrix.provenance.originKind} />
        <ProvenanceField label="Snapshot" value={matrix.provenance.snapshot} />
        <ProvenanceField
          label="Crawl / snapshot time"
          value={matrix.provenance.crawlTimestamp ?? "unavailable"}
        />
        <p className="md:col-span-2 xl:col-span-4">
          Imported metadata is self-asserted until separately verified. This matrix is read-only: no publish,
          payment, endpoint call, wallet/RPC action, or registry/trust/reputation mutation happens from this view.
        </p>
      </div>
    </section>
  );
}

function ProvenanceField({ label, value }: { label: string; value: string }) {
  return (
    <p className="min-w-0">
      <span className="block text-[10px] font-semibold uppercase text-muted-foreground/80">{label}</span>
      <span className="mt-0.5 block break-all font-mono text-[11px] text-white">{value}</span>
    </p>
  );
}
