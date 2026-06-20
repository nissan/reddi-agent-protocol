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
  Rocket,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  MarketplaceApprovalQueueItem,
  MarketplaceApprovalQueueState,
  MarketplaceApprovalQueueView,
} from "@/lib/manager/marketplace-listings";
import { cn } from "@/lib/utils";

const stateOrder: MarketplaceApprovalQueueState[] = [
  "draft",
  "needs_changes",
  "approve_ready",
  "published_placeholder",
  "unpublished",
  "rejected",
  "blocked",
  "suspended",
];

export function MarketplaceApprovalQueue({ queue }: { queue: MarketplaceApprovalQueueView }) {
  const [selectedState, setSelectedState] = useState<MarketplaceApprovalQueueState>("draft");
  const selected = useMemo(
    () => queue.items.find((item) => item.state === selectedState) ?? queue.items[0] ?? null,
    [queue.items, selectedState],
  );

  if (!selected) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-surface/30 p-6" data-testid="marketplace-approval-empty">
        <h2 className="font-display text-lg font-semibold">{queue.emptyState.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{queue.emptyState.message}</p>
      </section>
    );
  }

  return (
    <div className="space-y-5" data-testid="marketplace-approval-queue">
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-amber-100">Static boundary</p>
            <p className="mt-1 max-w-3xl text-sm text-amber-50">
              Imported agent stacks remain untrusted static metadata until later RAP wrapping, readiness, attestation, payment, and publication gates ship.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Static listing boundary labels">
            {queue.boundaryLabels.map((label) => (
              <Badge key={label} variant="outline" className="border-amber-300/40 bg-black/20 text-amber-50">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-3" aria-label="Marketplace approval queue states">
          {stateOrder.map((state) => {
            const item = queue.items.find((candidate) => candidate.state === state);
            if (!item) return null;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`marketplace-queue-state-${item.state}`}
                onClick={() => setSelectedState(item.state)}
                className={cn(
                  "w-full rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected.state === item.state
                    ? "border-accent-purple bg-accent-purple/10"
                    : "border-border bg-surface/50 hover:border-muted-foreground/50",
                )}
                aria-pressed={selected.state === item.state}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{item.label}</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{item.fixtureKey}</p>
                  </div>
                  <StateBadge state={item.state} />
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{item.listingPreview.statusCopy}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <MiniStat label="items" value={item.candidate.resourceCounts.reviewItems} />
                  <MiniStat label="warnings" value={item.candidate.resourceCounts.warnings} />
                  <MiniStat label="blockers" value={item.candidate.resourceCounts.blockers} />
                </div>
              </button>
            );
          })}
        </section>

        <ListingPreview item={selected} boundaryLabels={queue.boundaryLabels} />
      </div>
    </div>
  );
}

function ListingPreview({
  item,
  boundaryLabels,
}: {
  item: MarketplaceApprovalQueueItem;
  boundaryLabels: string[];
}) {
  return (
    <article className="space-y-5" data-testid="marketplace-listing-preview">
      <section className="overflow-hidden rounded-lg border border-border bg-surface/60">
        <div className="relative min-h-40 bg-gradient-to-br from-indigo-500/30 via-sky-500/15 to-emerald-500/20 p-5">
          <div className="absolute inset-0 bg-page/55" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                {boundaryLabels.map((label) => (
                  <Badge key={label} variant={label === "untrusted" ? "destructive" : "outline"} className="bg-black/25">
                    {label}
                  </Badge>
                ))}
              </div>
              <h2 className="mt-4 font-display text-2xl font-semibold text-white">{item.listingPreview.name}</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-200">{item.listingPreview.tagline}</p>
              <p className="mt-3 max-w-3xl rounded-lg border border-white/10 bg-black/25 p-3 text-sm text-white">
                {item.listingPreview.statusCopy}
              </p>
            </div>
            <StateBadge state={item.state} />
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Marketplace card language</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {item.listingPreview.capabilities.length ? item.listingPreview.capabilities.map((capability) => (
                  <Badge key={capability} variant="outline" className="border-white/10 bg-white/5 text-gray-300">
                    {capability}
                  </Badge>
                )) : (
                  <Badge variant="outline" className="border-white/10 bg-white/5 text-gray-300">
                    static capability refs only
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <KeyValue label="Model/source" value={item.listingPreview.model} />
              <KeyValue label="Source snapshot" value={`${item.candidate.checkedRef} @ ${item.candidate.checkedCommit}`} />
              <KeyValue label="Publication" value={item.listingPreview.publicationCopy} />
              <KeyValue label="Payment readiness" value={item.listingPreview.paymentCopy} />
              <KeyValue label="Publication readiness" value={item.listingPreview.readinessCopy} />
              <KeyValue label="Fixture state" value={item.candidate.fixtureState} />
            </div>

            <section className="rounded-lg border border-border bg-page/50 p-4">
              <h3 className="font-display text-base font-semibold">Operator review evidence</h3>
              <ul className="mt-3 grid gap-2 md:grid-cols-2">
                {item.candidate.reviewItems.slice(0, 6).map((reviewItem, index) => (
                  <li key={`${reviewItem.id}:${index}`} className="rounded-lg border border-border bg-surface/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={reviewItem.blocksPublication ? "destructive" : "outline"}>
                        {reviewItem.severity}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{reviewItem.state}</span>
                    </div>
                    <p className="mt-2 text-sm text-white">{reviewItem.message}</p>
                  </li>
                ))}
              </ul>
            </section>

            <PublicationEvidencePanel item={item} />
          </div>

          <aside className="space-y-4">
            <section className="rounded-lg border border-border bg-page/50 p-4">
              <h3 className="font-display text-base font-semibold">Non-live actions</h3>
              <div className="mt-3 grid grid-cols-2 gap-2" data-testid="marketplace-placeholder-actions">
                <PlaceholderAction icon={<CheckCircle2 />} label="Approve" />
                <PlaceholderAction icon={<Ban />} label="Reject" />
                <PlaceholderAction icon={<Send />} label="Request changes" />
                <PlaceholderAction icon={<Rocket />} label="Publish" />
                <PlaceholderAction icon={<CircleSlash />} label="Unpublish" />
                <PlaceholderAction icon={<PauseCircle />} label="Suspend" />
                <PlaceholderAction icon={<CreditCard />} label="Payment readiness" />
                <PlaceholderAction icon={<FileSearch />} label="Publication readiness" />
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Placeholder only. This queue performs no API mutation, live marketplace publication, payment activation, wallet signing, RPC probe, MCP call, repo fetch, provider trust upgrade, reputation assignment, or imported command execution.
              </p>
            </section>

            <section className="rounded-lg border border-border bg-page/50 p-4">
              <h3 className="flex items-center gap-2 font-display text-base font-semibold">
                <ShieldAlert className="size-4 text-accent-green" aria-hidden="true" />
                Static guardrails
              </h3>
              <ul className="mt-3 space-y-2">
                {item.candidate.secretGuardrails.slice(0, 4).map((guardrail) => (
                  <li key={guardrail} className="rounded-lg border border-border bg-surface/60 p-3 text-sm text-muted-foreground">
                    {guardrail}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </section>

      <section className="rounded-lg border border-dashed border-border bg-surface/30 p-4" data-testid="marketplace-static-boundary-note">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Lock className="size-4 text-accent-green" aria-hidden="true" />
          RAP marketplace boundary
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          RAP is not a generic agent builder. These imported stacks are static, untrusted listing candidates until later gates create real wrappers, attestations, readiness checks, and publication records.
        </p>
      </section>
    </article>
  );
}

function PublicationEvidencePanel({ item }: { item: MarketplaceApprovalQueueItem }) {
  const evidence = item.publicationEvidence;

  return (
    <section className="rounded-lg border border-border bg-page/50 p-4" data-testid="marketplace-publication-evidence">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">Publication claim evidence</p>
          <h3 className="mt-1 font-display text-lg font-semibold text-white">{evidence.label}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{evidence.description}</p>
        </div>
        <Badge variant="outline" className={cn("w-fit", publicationStatusClass(evidence.status))}>
          {evidence.status.replaceAll("_", " ")}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ClaimMetric label="Off-chain preview" value={evidence.offchainPreview} />
        <ClaimMetric label="Hosted attestation" value={evidence.hostedAttestation} />
        <ClaimMetric label="Quasar" value={evidence.quasar} />
        <ClaimMetric label="Activation" value={evidence.activationMode} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface/60 p-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Evidence refs</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {evidence.evidenceRefs.map((ref) => (
              <code key={ref} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-gray-200">
                {ref}
              </code>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface/60 p-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Claim boundary</p>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li>Buyer-facing trust/reputation claims: {evidence.buyerFacingClaimsAllowed ? "enabled" : "disabled"}</li>
            <li>Live publication: {evidence.livePublication}</li>
            {evidence.blockedReasons.length ? (
              evidence.blockedReasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)
            ) : (
              <li>Dry-run activation only; no hosted registry write.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ClaimMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-white">{value.replaceAll("_", " ")}</p>
    </div>
  );
}

function publicationStatusClass(status: MarketplaceApprovalQueueItem["publicationEvidence"]["status"]) {
  if (status === "published_dry_run" || status === "dry_run_activation_ready" || status === "hosted_attestation_ready") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "hosted_attestation_pending" || status === "quasar_pending" || status === "live_unavailable") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
  if (status === "blocked_evidence" || status === "suspended") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }
  return "border-white/10 bg-white/5 text-gray-300";
}

function StateBadge({ state }: { state: MarketplaceApprovalQueueState }) {
  const label = state.replaceAll("_", " ");
  const className =
    state === "approve_ready"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      : state === "published_placeholder"
        ? "border-sky-500/30 bg-sky-500/10 text-sky-200"
        : state === "unpublished"
          ? "border-slate-400/30 bg-slate-400/10 text-slate-200"
        : state === "needs_changes"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : state === "rejected" || state === "blocked" || state === "suspended"
            ? "border-red-500/30 bg-red-500/10 text-red-200"
            : "border-white/10 bg-white/5 text-gray-300";

  return (
    <Badge variant="outline" className={cn("shrink-0", className)}>
      {label}
    </Badge>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-page/50 px-2 py-2">
      <p className="font-mono text-base text-white">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
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

function PlaceholderAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" disabled title={`${label} is a non-live placeholder`}>
      <span className="[&_svg]:size-3.5" aria-hidden="true">{icon}</span>
      {label}
    </Button>
  );
}
