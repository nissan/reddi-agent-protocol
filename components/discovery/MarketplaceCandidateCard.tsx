"use client"

import { useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type {
  MarketplaceCandidateCardModel,
  MarketplaceCandidateField,
} from "@/lib/discovery/source-facets"

/**
 * Marketplace candidate card (#381) for non-registry discovery sources
 * (hosted RAP registry, ARD / AI Catalog imports, Circle x402, Pay.sh).
 *
 * Discovery-only: this card intentionally exposes no paid call, wallet
 * action, endpoint invocation, or hire affordance. Its only interactions are
 * a read-only disclosure of the gating reason codes and internal read-only
 * navigation to the #382 candidate detail route.
 */

const TONE_BADGE_CLASSES: Record<MarketplaceCandidateCardModel["trust"]["tone"], string> = {
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  caution: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  negative: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  neutral: "border-white/10 bg-white/5 text-gray-400",
}

const RENDER_STATE_STYLES: Record<
  MarketplaceCandidateCardModel["renderState"],
  { card: string; banner: string | null; bannerClass: string }
> = {
  "ard-imported": {
    card: "ring-sky-500/30",
    banner: "Imported snapshot — untrusted until Decide gates run",
    bannerClass: "bg-sky-500/10 text-sky-300",
  },
  untrusted: {
    card: "ring-amber-500/30",
    banner: "Externally listed — not RAP-attested",
    bannerClass: "bg-amber-500/10 text-amber-300",
  },
  blocked: {
    card: "ring-rose-500/50",
    banner: "Blocked — failed validation or export gating",
    bannerClass: "bg-rose-500/10 text-rose-300",
  },
}

export function MarketplaceCandidateCard({
  candidate,
  detailQuery = "",
}: {
  candidate: MarketplaceCandidateCardModel
  /** Current `?source=…&task=…` state to carry into the detail deep link (#382). */
  detailQuery?: string
}) {
  const [showReasons, setShowReasons] = useState(false)
  const imported = new Set(candidate.importedFields)
  const scope = (field: MarketplaceCandidateField): Record<string, string> =>
    imported.has(field) ? { "data-claim-scope": "external" } : {}
  const styles = RENDER_STATE_STYLES[candidate.renderState]
  const reasonsId = `candidate-reasons-${candidate.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  const detailHref = `/agents/candidates/${encodeURIComponent(candidate.id)}${detailQuery}`

  return (
    <Card
      className={cn("flex h-full flex-col overflow-hidden", styles.card)}
      data-testid="marketplace-candidate-card"
      data-source-facet={candidate.sourceFacet}
      data-render-state={candidate.renderState}
    >
      {styles.banner ? (
        <div className={cn("px-4 py-1.5 text-[11px] font-medium", styles.bannerClass)}>
          {styles.banner}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className="border-indigo-500/30 bg-indigo-500/10 text-[11px] text-indigo-300"
            data-testid="candidate-source-badge"
          >
            {candidate.sourceLabel}
          </Badge>
          <Badge
            variant="outline"
            className={cn("text-[11px]", TONE_BADGE_CLASSES[candidate.trust.tone])}
            data-testid="candidate-trust-badge"
          >
            {candidate.trust.label}
          </Badge>
          <Badge
            variant="outline"
            className={cn("text-[11px]", TONE_BADGE_CLASSES[candidate.readiness.tone])}
            data-testid="candidate-readiness-badge"
          >
            {candidate.readiness.label}
          </Badge>
        </div>

        <div>
          <h3 className="font-display text-base font-semibold text-white">
            <span {...scope("name")}>{candidate.name}</span>
          </h3>
          <p className="mt-1 line-clamp-2 break-all text-sm text-gray-400">
            <span {...scope("description")}>{candidate.description}</span>
          </p>
        </div>

        <div
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-gray-300"
          data-testid="candidate-resource-type"
        >
          <div className="flex items-center justify-between gap-2">
            <span>Resource</span>
            <span className="text-right text-gray-400" {...scope("resourceType")}>
              {candidate.resourceType}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>Media type</span>
            <span className="break-all text-right text-gray-400" {...scope("mediaType")}>
              {candidate.mediaType}
            </span>
          </div>
        </div>

        {candidate.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {candidate.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="outline" className="border-white/10 bg-white/5 text-[11px] text-gray-300">
                <span {...scope("tags")}>{tag}</span>
              </Badge>
            ))}
          </div>
        ) : null}

        {candidate.reasonCodes.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setShowReasons((value) => !value)}
              aria-expanded={showReasons}
              aria-controls={reasonsId}
              data-testid="candidate-reasons-toggle"
              className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            >
              {showReasons ? "Hide gating reasons" : "Why is this gated?"}
            </button>
            {showReasons ? (
              <ul id={reasonsId} data-testid="candidate-reasons" className="mt-2 space-y-1 text-[11px] text-gray-400">
                {candidate.reasonCodes.slice(0, 8).map((code) => (
                  <li key={code} className="break-all rounded bg-white/[0.04] px-2 py-1 font-mono">
                    {code}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto space-y-2 border-t border-white/10 pt-2">
          <Link
            href={detailHref}
            data-testid="candidate-detail-link"
            className="inline-block text-[11px] font-medium text-indigo-300 transition hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            View details →
          </Link>
          <p className="text-[11px] leading-relaxed text-gray-500">{candidate.trustBoundaryNote}</p>
        </div>
      </div>
    </Card>
  )
}
