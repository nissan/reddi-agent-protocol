"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type {
  DiscoveryCandidateDetail,
  DiscoveryCandidateDetailResult,
} from "@/lib/discovery/candidate-detail"

/**
 * Discovery candidate detail view (#382).
 *
 * Read-only rendering of the `reddi.discovery-candidate-detail.v1` read
 * model: full source provenance, the full six-lane #577 actionability matrix
 * (or an honest "matrix unavailable" panel), capability/media/resource
 * metadata, trust-boundary copy, gating reasons, validation findings, and
 * evidence references. Absent values render as "unavailable" — never
 * invented. The only interactive elements are internal navigation links; no
 * paid call, wallet action, endpoint invocation, publication, or
 * trust/reputation mutation is reachable from this view.
 */

const TONE_BADGE_CLASSES: Record<"positive" | "caution" | "negative" | "neutral", string> = {
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  caution: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  negative: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  neutral: "border-white/10 bg-white/5 text-gray-400",
}

const RENDER_STATE_BANNERS: Record<
  DiscoveryCandidateDetail["card"]["renderState"],
  { banner: string; bannerClass: string; ring: string }
> = {
  "ard-imported": {
    banner: "Imported snapshot — untrusted until Decide gates run",
    bannerClass: "bg-sky-500/10 text-sky-300",
    ring: "ring-sky-500/30",
  },
  untrusted: {
    banner: "Externally listed — not RAP-attested",
    bannerClass: "bg-amber-500/10 text-amber-300",
    ring: "ring-amber-500/30",
  },
  blocked: {
    banner: "Blocked — failed validation or export gating",
    bannerClass: "bg-rose-500/10 text-rose-300",
    ring: "ring-rose-500/50",
  },
}

function Unavailable() {
  return <span className="italic text-gray-600">unavailable</span>
}

function SectionCard({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden p-4" data-testid={testId}>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </Card>
  )
}

export function CandidateDetailView({ detail, backHref }: { detail: DiscoveryCandidateDetail; backHref: string }) {
  const { card } = detail
  const styles = RENDER_STATE_BANNERS[card.renderState]

  return (
    <div
      data-testid="candidate-detail"
      data-availability="found"
      data-source-facet={card.sourceFacet}
      data-render-state={card.renderState}
      className="space-y-5"
    >
      <div className={cn("overflow-hidden rounded-xl bg-surface glow-border ring-1", styles.ring)}>
        <div className={cn("px-5 py-2 text-xs font-medium", styles.bannerClass)} data-testid="candidate-detail-banner">
          {styles.banner}
        </div>
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-indigo-500/30 bg-indigo-500/10 text-[11px] text-indigo-300"
              data-testid="candidate-detail-source-badge"
            >
              {card.sourceLabel}
            </Badge>
            <Badge
              variant="outline"
              className={cn("text-[11px]", TONE_BADGE_CLASSES[card.trust.tone])}
              data-testid="candidate-detail-trust-badge"
            >
              {card.trust.label}
            </Badge>
            <Badge
              variant="outline"
              className={cn("text-[11px]", TONE_BADGE_CLASSES[card.readiness.tone])}
              data-testid="candidate-detail-readiness-badge"
            >
              {card.readiness.label}
            </Badge>
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold text-white">{card.name}</h1>
            <p className="mt-1 break-all text-sm text-gray-400">{card.description}</p>
            <p className="mt-2 break-all font-mono text-[11px] text-gray-500" data-testid="candidate-detail-id">
              {detail.id}
            </p>
          </div>
        </div>
      </div>

      {/* Lifecycle strip — discovered / RAP-wrapped / attested / payment-ready / hireable */}
      <SectionCard title="Lifecycle — each state is separate, never blended" testId="candidate-detail-lifecycle">
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {detail.lifecycle.map((stage) => (
            <li
              key={stage.id}
              data-testid={`lifecycle-stage-${stage.id}`}
              data-reached={stage.reached}
              className={cn(
                "rounded-lg border px-3 py-2",
                stage.reached ? "border-indigo-500/40 bg-indigo-500/10" : "border-white/10 bg-white/[0.03]",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-xs font-semibold", stage.reached ? "text-indigo-200" : "text-gray-300")}>
                  {stage.label}
                </span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    stage.reached ? "bg-indigo-500/30 text-indigo-100" : "bg-white/5 text-gray-500",
                  )}
                >
                  {stage.reached ? "reached" : "not reached"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{stage.note}</p>
            </li>
          ))}
        </ol>
      </SectionCard>

      {/* Full six-lane actionability matrix (#577) */}
      {detail.matrix ? (
        <SectionCard title="Actionability matrix (#577 — per-lane, never a blended score)" testId="candidate-detail-matrix">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate border-spacing-y-1 text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                  <th scope="col" className="px-2 py-1 font-medium">Lane</th>
                  <th scope="col" className="px-2 py-1 font-medium">State</th>
                  <th scope="col" className="px-2 py-1 font-medium">Summary</th>
                  <th scope="col" className="px-2 py-1 font-medium">Reason codes</th>
                </tr>
              </thead>
              <tbody>
                {detail.matrix.lanes.map((lane) => (
                  <tr
                    key={lane.lane}
                    data-testid={`matrix-lane-${lane.lane}`}
                    data-state={lane.state}
                    className="rounded-lg bg-white/[0.03] align-top"
                  >
                    <th scope="row" className="whitespace-nowrap px-2 py-2 text-xs font-medium text-gray-200">
                      {lane.laneLabel}
                    </th>
                    <td className="whitespace-nowrap px-2 py-2">
                      <Badge variant="outline" className={cn("text-[11px]", TONE_BADGE_CLASSES[lane.tone])}>
                        {lane.stateLabel}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-gray-400">{lane.summary}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {lane.reasonCodes.map((code) => (
                          <span key={code} className="break-all rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                            {code}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-gray-500">{detail.matrix.discoveryTrustBoundary.note}</p>
        </SectionCard>
      ) : (
        <SectionCard title="Actionability matrix" testId="candidate-detail-matrix-unavailable">
          <p className="text-sm text-gray-400">{detail.matrixUnavailableReason ?? "Matrix unavailable."}</p>
        </SectionCard>
      )}

      {/* Metadata sections — absent values render "unavailable" honestly */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {detail.sections.map((section) => (
          <SectionCard key={section.id} title={section.title} testId={`candidate-detail-section-${section.id}`}>
            <dl className="space-y-2 text-xs">
              {section.fields.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3" data-testid={`detail-field-${entry.id}`}>
                  <dt className="shrink-0 text-gray-500">{entry.label}</dt>
                  <dd className="break-all text-right text-gray-300">
                    {entry.value ?? <Unavailable />}
                  </dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        ))}
      </div>

      {/* Capabilities */}
      <SectionCard title="Capabilities & tags" testId="candidate-detail-capabilities">
        {detail.capabilityTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {detail.capabilityTags.map((tag) => (
              <Badge key={tag} variant="outline" className="border-white/10 bg-white/5 text-[11px] text-gray-300">
                {tag}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No capability tags are declared by this source. <Unavailable />
          </p>
        )}
        {detail.capabilityGroups.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {detail.capabilityGroups.map((group) => (
              <li
                key={group.id}
                data-testid="candidate-detail-capability-group"
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-gray-200">{group.name}</span>
                  <span className="text-[11px] text-gray-500">
                    {group.sourceKind} · {group.runtimeSurface}
                  </span>
                </div>
                <p className="mt-1 break-all text-[11px] text-gray-500">{group.sourcePath}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {group.capabilityRefs.map((ref) => (
                    <span key={ref} className="break-all rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                      {ref}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500">
                  write-capable: {group.writeCapable ? "yes" : "no"} · human review required:{" "}
                  {group.humanReviewRequired ? "yes" : "no"}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>

      {/* Readiness / gating reasons — full, untruncated */}
      <SectionCard title="Readiness & gating reasons" testId="candidate-detail-reasons">
        {detail.gatingReasons.length > 0 ? (
          <ul className="space-y-1">
            {detail.gatingReasons.map((code) => (
              <li key={code} className="break-all rounded bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-gray-400">
                {code}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">
            No gating reason codes were recorded. <Unavailable />
          </p>
        )}
      </SectionCard>

      {/* Validation findings */}
      {detail.validationFindings.length > 0 ? (
        <SectionCard title="Validation findings" testId="candidate-detail-findings">
          <ul className="space-y-2">
            {detail.validationFindings.map((finding) => (
              <li
                key={finding.id}
                data-testid="candidate-detail-finding"
                data-severity={finding.severity}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  finding.blocksPublication || finding.severity === "blocked" || finding.severity === "blocker"
                    ? "border-rose-500/30 bg-rose-500/5"
                    : "border-amber-500/20 bg-amber-500/5",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">{finding.source}</span>
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">{finding.state}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      finding.blocksPublication || finding.severity === "blocked" || finding.severity === "blocker"
                        ? "bg-rose-500/15 text-rose-300"
                        : "bg-amber-500/15 text-amber-300",
                    )}
                  >
                    {finding.severity}
                    {finding.blocksPublication ? " · blocks publication" : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-gray-300">{finding.message}</p>
                {finding.reasonCodes.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {finding.reasonCodes.map((code) => (
                      <span key={code} className="break-all rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                        {code}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {/* Recovery actions for blocked/unsafe candidates */}
      {detail.recoveryActions.length > 0 ? (
        <SectionCard title="Recovery actions" testId="candidate-detail-recovery">
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
            {detail.recoveryActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {/* Evidence & raw snapshot references */}
      <SectionCard title="Evidence & raw snapshot references" testId="candidate-detail-evidence">
        <div className="space-y-3 text-xs">
          <div>
            <p className="text-gray-500">Evidence references</p>
            {detail.evidenceRefs.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {detail.evidenceRefs.map((ref) => (
                  <li key={ref} className="break-all rounded bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-gray-400">
                    {ref}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-gray-500">
                No receipt- or fixture-backed evidence exists for this candidate. <Unavailable />
              </p>
            )}
          </div>
          <div>
            <p className="text-gray-500">Raw snapshot references</p>
            {detail.rawSnapshotRefs.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {detail.rawSnapshotRefs.map((ref) => (
                  <li key={ref} className="break-all rounded bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-gray-400">
                    {ref}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-gray-500">
                No raw snapshot reference was recorded. <Unavailable />
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Import guardrail / trust notes */}
      {detail.guardrailNotes.length > 0 ? (
        <SectionCard title="Source guardrail notes" testId="candidate-detail-guardrail-notes">
          <ul className="list-disc space-y-1 pl-5 text-xs text-gray-400">
            {detail.guardrailNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <p
        data-testid="candidate-detail-boundary-note"
        className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-gray-400"
      >
        {detail.trustBoundary.note} <span className="text-gray-500">({detail.trustBoundary.docRef})</span>
      </p>

      <div>
        <Link
          href={backHref}
          data-testid="candidate-detail-back-bottom"
          className="text-sm text-indigo-300 transition hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          ← Back to marketplace discovery
        </Link>
      </div>
    </div>
  )
}

export function CandidateDetailUnavailable({
  result,
  backHref,
}: {
  result: Extract<DiscoveryCandidateDetailResult, { availability: "not_found" | "source_unavailable" | "unsupported_id" }>
  backHref: string
}) {
  const heading =
    result.availability === "not_found"
      ? "Candidate not found"
      : result.availability === "source_unavailable"
        ? "Source snapshot unavailable"
        : "Not a candidate detail id"

  return (
    <div
      data-testid="candidate-detail-unavailable"
      data-availability={result.availability}
      className="rounded-xl border border-white/10 bg-surface p-6"
    >
      <h1 className="font-display text-lg font-semibold text-white">{heading}</h1>
      <p className="mt-2 break-all text-sm text-gray-400">{result.reason}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-gray-500">{result.id}</p>
      {result.recoveryActions.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-300" data-testid="candidate-detail-recovery">
          {result.recoveryActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      ) : null}
      <p
        data-testid="candidate-detail-boundary-note"
        className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-gray-400"
      >
        {result.trustBoundary.note} <span className="text-gray-500">({result.trustBoundary.docRef})</span>
      </p>
      <div className="mt-4">
        <Link
          href={backHref}
          data-testid="candidate-detail-back-bottom"
          className="text-sm text-indigo-300 transition hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        >
          ← Back to marketplace discovery
        </Link>
      </div>
    </div>
  )
}
