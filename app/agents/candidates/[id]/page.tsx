"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"

import { CandidateDetailUnavailable, CandidateDetailView } from "@/components/discovery/CandidateDetail"
import {
  DISCOVERY_SOURCE_QUERY_PARAM,
  DISCOVERY_TASK_QUERY_PARAM,
} from "@/lib/discovery/source-facets"
import type { DiscoveryCandidateDetailResult } from "@/lib/discovery/candidate-detail"

/**
 * Deep-linkable discovery candidate detail route (#382):
 * `/agents/candidates/[id]?source=…&task=…`.
 *
 * The querystring composes with the #381 /agents facet state — the back link
 * preserves whatever source/task filters the visitor arrived with. Read-only:
 * the page fetches the fixture-backed detail read model and renders it; no
 * action affordance exists beyond navigation.
 */

export default function CandidateDetailPage() {
  return (
    <Suspense fallback={<CandidateDetailSkeleton />}>
      <CandidateDetailContent />
    </Suspense>
  )
}

function CandidateDetailSkeleton() {
  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="h-64 animate-pulse rounded-xl bg-surface/70 glow-border" />
      </div>
    </div>
  )
}

function CandidateDetailContent() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const id = decodeURIComponentSafe(params.id)

  const [result, setResult] = useState<DiscoveryCandidateDetailResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Compose the back link with the #381 facet state carried in the deep link.
  const backHref = useMemo(() => {
    const preserved = new URLSearchParams()
    const source = searchParams.get(DISCOVERY_SOURCE_QUERY_PARAM)
    const task = searchParams.get(DISCOVERY_TASK_QUERY_PARAM)
    if (source) preserved.set(DISCOVERY_SOURCE_QUERY_PARAM, source)
    if (task) preserved.set(DISCOVERY_TASK_QUERY_PARAM, task)
    const qs = preserved.toString()
    return qs ? `/agents?${qs}` : "/agents"
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const res = await fetch(`/api/discovery/candidates/${encodeURIComponent(id)}`)
        const data = await res.json()
        if (cancelled) return
        if (data?.result?.schemaVersion === "reddi.discovery-candidate-detail.v1") {
          setResult(data.result as DiscoveryCandidateDetailResult)
        } else {
          setLoadError(typeof data?.error === "string" ? data.error : "Candidate detail could not be loaded.")
        }
      } catch {
        if (!cancelled) setLoadError("Candidate detail could not be loaded.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            href={backHref}
            data-testid="candidate-detail-back"
            className="text-sm text-indigo-300 transition hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            ← Back to marketplace discovery
          </Link>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">Discovery candidate detail</p>
        </div>

        {loading ? (
          <div className="h-64 animate-pulse rounded-xl bg-surface/70 glow-border" data-testid="candidate-detail-loading" />
        ) : loadError ? (
          <div className="rounded-xl border border-white/10 bg-surface p-6" data-testid="candidate-detail-error">
            <h1 className="font-display text-lg font-semibold text-white">Candidate detail unavailable</h1>
            <p className="mt-2 text-sm text-gray-400">{loadError}</p>
            <div className="mt-4">
              <Link href={backHref} className="text-sm text-indigo-300 hover:text-indigo-200">
                ← Back to marketplace discovery
              </Link>
            </div>
          </div>
        ) : result?.availability === "found" ? (
          <CandidateDetailView detail={result.detail} backHref={backHref} />
        ) : result ? (
          <CandidateDetailUnavailable result={result} backHref={backHref} />
        ) : null}
      </div>
    </div>
  )
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
