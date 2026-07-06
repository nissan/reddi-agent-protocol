"use client";

import type React from "react";
import { useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  CircleSlash,
  CreditCard,
  FileSearch,
  Lock,
  PauseCircle,
  Send,
  ShieldAlert,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiscoveryActionabilityMatrixPanel } from "@/components/manager/discovery/DiscoveryActionabilityMatrix";
import { deriveDiscoveryActionabilityMatrix } from "@/lib/manager/discovery-actionability-matrix";
import type {
  OperatorDiscoveryCandidateView,
  OperatorDiscoveryFilter,
  OperatorDiscoveryWorkspaceView,
} from "@/lib/manager/static-agent-stack-review";
import { cn } from "@/lib/utils";

export function OperatorDiscoveryWorkspace({ workspace }: { workspace: OperatorDiscoveryWorkspaceView }) {
  const [filter, setFilter] = useState<OperatorDiscoveryFilter>("all");
  const [selectedId, setSelectedId] = useState(workspace.candidates[0]?.id ?? "");

  const visibleCandidates = useMemo(
    () => workspace.candidates.filter((candidate) => matchesFilter(candidate, filter)),
    [filter, workspace.candidates],
  );
  const selectedCandidate = visibleCandidates.find((candidate) => candidate.id === selectedId) ?? visibleCandidates[0] ?? null;

  function chooseFilter(nextFilter: OperatorDiscoveryFilter) {
    const nextCandidates = workspace.candidates.filter((candidate) => matchesFilter(candidate, nextFilter));
    setFilter(nextFilter);
    setSelectedId(nextCandidates[0]?.id ?? "");
  }

  return (
    <div className="space-y-5" data-testid="operator-discovery-workspace">
      <section className="rounded-lg border border-border bg-surface/60 p-3">
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Discovery review filters" data-testid="operator-discovery-filters">
          {workspace.filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => chooseFilter(item.id)}
              className={cn(
                "h-9 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors",
                filter === item.id
                  ? "border-accent-purple bg-accent-purple/15 text-white"
                  : "border-border bg-page/60 text-muted-foreground hover:text-white",
              )}
              aria-pressed={filter === item.id}
            >
              {item.label}
              <span className="ml-2 text-xs text-muted-foreground">{item.count}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <section className="space-y-3" aria-label="Imported review queue">
          {visibleCandidates.length > 0 ? visibleCandidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-testid={`operator-discovery-queue-${candidate.fixtureKey}`}
              onClick={() => setSelectedId(candidate.id)}
              className={cn(
                "w-full rounded-lg border p-4 text-left transition-colors",
                selectedCandidate?.id === candidate.id
                  ? "border-accent-purple bg-accent-purple/10"
                  : "border-border bg-surface/50 hover:border-muted-foreground/50",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{candidate.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{candidate.fixtureState}</p>
                </div>
                <StatusBadge candidate={candidate} />
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{candidate.description}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <MiniStat label="groups" value={candidate.resourceCounts.groups} />
                <MiniStat label="warnings" value={candidate.resourceCounts.warnings} />
                <MiniStat label="blockers" value={candidate.resourceCounts.blockers} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {candidate.requiredStates.map((state) => (
                  <Badge key={state} variant="outline" className="h-auto max-w-full whitespace-normal text-[11px]">
                    {state}
                  </Badge>
                ))}
              </div>
            </button>
          )) : (
            <div className="rounded-lg border border-dashed border-border bg-surface/30 p-6" data-testid="operator-discovery-empty">
              <h2 className="font-display text-lg font-semibold">{workspace.emptyState.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{workspace.emptyState.message}</p>
            </div>
          )}
        </section>

        {selectedCandidate && <DiscoveryDetail candidate={selectedCandidate} />}
      </div>

      <section className="rounded-lg border border-dashed border-border bg-surface/30 p-4" data-testid="operator-discovery-supply-empty-state">
        <h2 className="font-display text-lg font-semibold">Live marketplace supply remains empty</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Imported candidates stay in fixture-backed operator review until a later readiness, payment, attestation, and publication workflow explicitly promotes them.
        </p>
      </section>
    </div>
  );
}

function DiscoveryDetail({ candidate }: { candidate: OperatorDiscoveryCandidateView }) {
  const actionabilityMatrix = deriveDiscoveryActionabilityMatrix(candidate);

  return (
    <article className="space-y-5" data-testid="operator-discovery-detail">
      <section className="rounded-lg border border-border bg-surface/60 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">imported</Badge>
              <Badge variant="outline">external</Badge>
              <Badge variant="destructive">untrusted</Badge>
              <Badge variant="outline">not RAP-attested</Badge>
              <Badge variant="outline">static-only</Badge>
            </div>
            <h2 className="mt-3 font-display text-2xl font-semibold">{candidate.title}</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{candidate.description}</p>
          </div>
          <StatusBadge candidate={candidate} />
        </div>

        <dl className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <DetailTerm label="Source" value={candidate.sourceUrl} />
          <DetailTerm label="Source kind" value={candidate.sourceKindSummary} />
          <DetailTerm label="Snapshot" value={`${candidate.checkedRef} @ ${candidate.checkedCommit}`} />
          <DetailTerm label="Raw refs" value={candidate.rawSnapshotRefs.join(", ")} />
          <DetailTerm label="Result refs" value={candidate.resultRefs.join(", ")} />
        </dl>
      </section>

      <DiscoveryActionabilityMatrixPanel matrix={actionabilityMatrix} />

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel title="Catalog Groups" icon={<FileSearch />}>
          <div className="space-y-3">
            {candidate.groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-border bg-page/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{group.name}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{group.sourcePath}</p>
                  </div>
                  <Badge variant={group.humanReviewRequired ? "destructive" : "outline"}>
                    {group.humanReviewRequired ? "review" : "read"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{group.sourceKind} · {group.runtimeSurface}</p>
                <p className="mt-2 text-xs text-muted-foreground">Resources: {group.capabilityRefs.join(", ")}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Diagnostics" icon={<ShieldAlert />}>
          <DiagnosticList title="Validation/parser" items={candidate.validationDiagnostics} empty="No validation warnings in this fixture frame." />
          <DiagnosticList title="Connector" items={candidate.connectorDiagnostics} empty="No malformed connector diagnostics selected." />
          <DiagnosticList title="Rejected entries" items={candidate.rejectedEntries} empty="No rejected entries selected." />
        </Panel>

        <Panel title="Risk & Readiness" icon={<Lock />}>
          <DiagnosticList title="Risk diagnostics" items={candidate.riskDiagnostics} empty="No static risk diagnostics selected." />
          <KeyValue label="Risk categories" value={candidate.riskCategories.length ? candidate.riskCategories.join(", ") : "none required by fixture"} />
          <KeyValue label="Payment blocker" value={`${candidate.draftPreview.paymentStatus}; activation ${candidate.draftPreview.paymentActivation}`} />
          <KeyValue label="Publication" value={candidate.draftPreview.publicationDisabled ? "disabled until separate marketplace approval" : "enabled"} />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Marketplace Draft Preview" icon={<CheckCircle2 />}>
          <div className="grid gap-3 md:grid-cols-2">
            <KeyValue label="Listing status" value={candidate.draftPreview.listingStatus} />
            <KeyValue label="Resource count" value={`${candidate.resourceCounts.resources} static capability refs`} />
            {Object.entries(candidate.draftPreview.buyerPreview).map(([key, value]) => (
              <KeyValue key={key} label={key} value={value} />
            ))}
          </div>
        </Panel>

        <Panel title="Non-Live Controls" icon={<CircleSlash />}>
          <div className="grid grid-cols-2 gap-2" data-testid="operator-discovery-placeholder-actions">
            <PlaceholderAction icon={<CheckCircle2 />} label="Approve" />
            <PlaceholderAction icon={<Ban />} label="Ignore" />
            <PlaceholderAction icon={<Send />} label="Request changes" />
            <PlaceholderAction icon={<PauseCircle />} label="Suspend" />
            <PlaceholderAction icon={<FileSearch />} label="Publish" />
            <PlaceholderAction icon={<CreditCard />} label="Payment" />
            <PlaceholderAction icon={<ShieldAlert />} label="Readiness" />
            <PlaceholderAction icon={<WalletCards />} label="RAP attestation" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Placeholder only. This page performs no API mutation, live payment, publication, wallet, RPC, MCP contact, repo fetch, or imported command execution.
          </p>
        </Panel>
      </section>

      <Panel title="Static Guardrails" icon={<Lock />}>
        <ul className="grid gap-2 md:grid-cols-2">
          {candidate.secretGuardrails.map((guardrail) => (
            <li key={guardrail} className="rounded-lg border border-border bg-page/50 p-3 text-sm text-muted-foreground">
              {guardrail}
            </li>
          ))}
        </ul>
      </Panel>
    </article>
  );
}

function matchesFilter(candidate: OperatorDiscoveryCandidateView, filter: OperatorDiscoveryFilter) {
  if (filter === "all") return true;
  if (filter === "needs-review") return candidate.status !== "approve_ready";
  if (filter === "blocked") return candidate.resourceCounts.blockers > 0;
  if (filter === "approve-ready") return candidate.requiredStates.includes("approve_ready_draft");
  if (filter === "request-changes") return candidate.requiredStates.includes("request_changes_missing_payment");
  if (filter === "rejected") return candidate.requiredStates.includes("rejected_malformed_connector");
  if (filter === "suspended") return candidate.requiredStates.includes("suspended_imported_listing");
  return false;
}

function StatusBadge({ candidate }: { candidate: OperatorDiscoveryCandidateView }) {
  const variant = candidate.status === "approve_ready" ? "outline" : candidate.status === "request_changes" ? "secondary" : "destructive";
  return <Badge variant={variant}>{candidate.status.replaceAll("_", " ")}</Badge>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-page/50 px-2 py-2">
      <p className="font-mono text-base text-white">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface/60 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
        <span className="text-accent-green [&_svg]:size-4">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function DiagnosticList({
  title,
  items,
  empty,
}: {
  title: string;
  items: OperatorDiscoveryCandidateView["reviewItems"];
  empty: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-border bg-page/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={item.severity === "blocked" ? "destructive" : "outline"}>{item.severity}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{item.state}</span>
              </div>
              {item.path && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{item.path}</p>}
              <p className="mt-2 text-sm text-white">{item.message}</p>
              <p className="mt-2 text-xs text-muted-foreground">{item.reasonCodes.join(", ")}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-page/30 p-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-page/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm text-white">{value}</p>
    </div>
  );
}

function DetailTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-page/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono text-xs text-white">{value}</dd>
    </div>
  );
}

function PlaceholderAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" disabled title={`${label} is a non-live placeholder`}>
      <span className="[&_svg]:size-3.5">{icon}</span>
      {label}
    </Button>
  );
}
