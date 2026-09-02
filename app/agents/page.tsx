"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { OnboardingVideoCard } from "@/components/onboarding/OnboardingVideoCard"
import { buttonVariants } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { SpecialistCard } from "@/components/SpecialistCard"
import { MarketplaceCandidateCard } from "@/components/discovery/MarketplaceCandidateCard"
import { SourceFacetFilter, type SourceFacetFilterOption } from "@/components/discovery/SourceFacetFilter"
import { TASK_TYPES } from "@/lib/capabilities/taxonomy"
import {
  DISCOVERY_SOURCE_BOUNDARY,
  DISCOVERY_SOURCE_FACETS,
  DISCOVERY_SOURCE_QUERY_PARAM,
  DISCOVERY_TASK_QUERY_PARAM,
  classifySpecialistListingSourceFacet,
  describeDiscoverySourceFacet,
  parseDiscoverySourceFacetParam,
  serializeDiscoverySourceFacetParam,
  type DiscoverySourceAvailability,
  type DiscoverySourceFacetId,
  type MarketplaceCandidateCardModel,
} from "@/lib/discovery/source-facets"
import { onboardingVideos } from "@/lib/onboarding/video-guides"
import type { SpecialistListing } from "@/lib/registry/bridge"

type ClassifiedListing = {
  listing: SpecialistListing
  sourceFacet: DiscoverySourceFacetId
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<AgentsPageSkeleton />}>
      <AgentsPageContent />
    </Suspense>
  )
}

function AgentsPageSkeleton() {
  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-xl bg-surface/70 glow-border" />
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentsPageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [agents, setAgents] = useState<ClassifiedListing[]>([])
  const [candidates, setCandidates] = useState<MarketplaceCandidateCardModel[]>([])
  const [sourceAvailability, setSourceAvailability] = useState<DiscoverySourceAvailability[]>([])
  const [loading, setLoading] = useState(true)

  const selectedSources = useMemo(
    () => parseDiscoverySourceFacetParam(searchParams.get(DISCOVERY_SOURCE_QUERY_PARAM)),
    [searchParams],
  )
  const taskFilter = searchParams.get(DISCOVERY_TASK_QUERY_PARAM) ?? "All"

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [registryRes, candidatesRes] = await Promise.all([
          fetch("/api/registry"),
          fetch("/api/discovery/candidates"),
        ])
        const registryData = await registryRes.json()
        const candidatesData = await candidatesRes.json()
        if (cancelled) return
        const listings: SpecialistListing[] = registryData.listings ?? []
        setAgents(
          listings.map((listing) => ({
            listing,
            sourceFacet: classifySpecialistListingSourceFacet(listing),
          })),
        )
        setCandidates(candidatesData?.result?.cards ?? [])
        setSourceAvailability(candidatesData?.result?.sources ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const updateQuery = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const toggleSource = useCallback(
    (id: DiscoverySourceFacetId) => {
      updateQuery((params) => {
        const next = selectedSources.includes(id)
          ? selectedSources.filter((facet) => facet !== id)
          : [...selectedSources, id]
        const serialized = serializeDiscoverySourceFacetParam(next)
        if (serialized) params.set(DISCOVERY_SOURCE_QUERY_PARAM, serialized)
        else params.delete(DISCOVERY_SOURCE_QUERY_PARAM)
      })
    },
    [selectedSources, updateQuery],
  )

  const setTaskFilter = useCallback(
    (id: string) => {
      updateQuery((params) => {
        if (id === "All") params.delete(DISCOVERY_TASK_QUERY_PARAM)
        else params.set(DISCOVERY_TASK_QUERY_PARAM, id)
      })
    },
    [updateQuery],
  )

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false })
  }, [router, pathname])

  const sourceCounts = useMemo(() => {
    const counts = new Map<DiscoverySourceFacetId, number>()
    for (const { sourceFacet } of agents) counts.set(sourceFacet, (counts.get(sourceFacet) ?? 0) + 1)
    for (const candidate of candidates) counts.set(candidate.sourceFacet, (counts.get(candidate.sourceFacet) ?? 0) + 1)
    return counts
  }, [agents, candidates])

  const sourceOptions: SourceFacetFilterOption[] = useMemo(
    () =>
      DISCOVERY_SOURCE_FACETS.map((facet) => {
        const availability = sourceAvailability.find((item) => item.facet === facet.id)
        return {
          id: facet.id,
          label: facet.label,
          count: sourceCounts.get(facet.id) ?? 0,
          available: availability ? availability.available : true,
        }
      }),
    [sourceAvailability, sourceCounts],
  )

  const sourceMatches = useCallback(
    (facet: DiscoverySourceFacetId) => selectedSources.length === 0 || selectedSources.includes(facet),
    [selectedSources],
  )

  const filteredAgents = useMemo(
    () =>
      agents.filter(({ listing, sourceFacet }) => {
        if (!sourceMatches(sourceFacet)) return false
        if (taskFilter === "All") return true
        return listing.capabilities?.taskTypes.includes(taskFilter as never) ?? false
      }),
    [agents, sourceMatches, taskFilter],
  )

  const filteredCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        if (!sourceMatches(candidate.sourceFacet)) return false
        if (taskFilter === "All") return true
        return candidate.taskTypes.includes(taskFilter)
      }),
    [candidates, sourceMatches, taskFilter],
  )

  // Carry the current facet state into the #382 detail deep links so the
  // detail route composes with (and can return to) this filter state.
  const detailQuery = useMemo(() => {
    const preserved = new URLSearchParams()
    const source = searchParams.get(DISCOVERY_SOURCE_QUERY_PARAM)
    const task = searchParams.get(DISCOVERY_TASK_QUERY_PARAM)
    if (source) preserved.set(DISCOVERY_SOURCE_QUERY_PARAM, source)
    if (task) preserved.set(DISCOVERY_TASK_QUERY_PARAM, task)
    const qs = preserved.toString()
    return qs ? `?${qs}` : ""
  }, [searchParams])

  const totalUnfiltered = agents.length + candidates.length
  const totalVisible = filteredAgents.length + filteredCandidates.length
  const filtersActive = selectedSources.length > 0 || taskFilter !== "All"

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader
          label="Directory"
          title="Specialist directory"
          subtitle="Discover AI specialist metadata and evidence boundaries before any paid workflow claim"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/circle-x402" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Circle x402 dry-run
              </Link>
              <Link href="/register" className={buttonVariants({ size: "sm" })}>
                + Register yours
              </Link>
            </div>
          }
        />

        <p
          data-testid="discovery-boundary-note"
          className="mb-8 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-gray-400"
        >
          {DISCOVERY_SOURCE_BOUNDARY.note}{" "}
          <span className="text-gray-500">({DISCOVERY_SOURCE_BOUNDARY.docRef})</span>
        </p>

        <section className="mb-8">
          <OnboardingVideoCard video={onboardingVideos.find((video) => video.id === "mcp-x402") ?? onboardingVideos[0]} layout="horizontal" />
        </section>

        <div className="mb-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Source</h2>
          <SourceFacetFilter options={sourceOptions} selected={selectedSources} onToggle={toggleSource} />
        </div>

        <div className="mb-8">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Task type</h2>
          <div role="group" aria-label="Filter by task type" className="flex flex-wrap gap-2" data-testid="task-type-filter">
            {[
              { id: "All", label: "All" },
              ...TASK_TYPES.map((task) => ({ id: task.id, label: task.label })),
            ].map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => setTaskFilter(task.id)}
                aria-pressed={taskFilter === task.id}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 ${
                  taskFilter === task.id
                    ? "bg-indigo-500 text-white"
                    : "bg-surface text-gray-400 glow-border hover:text-white"
                }`}
              >
                {task.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-72 animate-pulse rounded-xl bg-surface/70 glow-border" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {filteredAgents.map(({ listing: agent, sourceFacet }) => (
              <SpecialistCard
                key={agent.walletAddress}
                wallet={agent.walletAddress}
                name={agent.capabilities?.manifest?.displayName || (agent.onchain.model ? `${agent.onchain.model}` : agent.walletAddress.slice(0, 8))}
                model={agent.onchain.model || "Specialist endpoint"}
                taskTypes={agent.capabilities?.taskTypes ?? []}
                reputationScore={agent.onchain.reputationScore}
                attested={agent.attestation.attested}
                health={agent.health.status === "pass" ? "online" : agent.health.status === "fail" ? "offline" : "unknown"}
                freshnessState={agent.health.freshnessState}
                ratePerCall={Number(agent.onchain.rateLamports)}
                progress={Math.min(100, Number(agent.onchain.jobsCompleted) * 10)}
                tools={agent.capabilities?.manifest?.tools ?? agent.capabilities?.agent_composition?.tools ?? []}
                skills={agent.capabilities?.manifest?.skills ?? agent.capabilities?.tags ?? []}
                marketplaceAgentCalls={agent.capabilities?.manifest?.marketplace_agent_calls ?? agent.capabilities?.agent_composition?.marketplace_agent_calls ?? []}
                externalMcpServers={agent.capabilities?.manifest?.external_mcp_servers ?? agent.capabilities?.agent_composition?.external_mcp_servers ?? []}
                nonMarketplaceAgentCalls={agent.capabilities?.manifest?.non_marketplace_agent_calls ?? agent.capabilities?.agent_composition?.non_marketplace_agent_calls ?? []}
                sourceFacet={{ id: sourceFacet, label: describeDiscoverySourceFacet(sourceFacet).label }}
              />
            ))}
            {filteredCandidates.map((candidate) => (
              <MarketplaceCandidateCard key={candidate.id} candidate={candidate} detailQuery={detailQuery} />
            ))}
          </div>
        )}

        {!loading && totalVisible === 0 ? (
          <EmptyState
            totalUnfiltered={totalUnfiltered}
            filtersActive={filtersActive}
            selectedSources={selectedSources}
            taskFilter={taskFilter}
            sourceCounts={sourceCounts}
            sourceAvailability={sourceAvailability}
            onClearFilters={clearFilters}
          />
        ) : null}
      </div>
    </div>
  )
}

function EmptyState({
  totalUnfiltered,
  filtersActive,
  selectedSources,
  taskFilter,
  sourceCounts,
  sourceAvailability,
  onClearFilters,
}: {
  totalUnfiltered: number
  filtersActive: boolean
  selectedSources: DiscoverySourceFacetId[]
  taskFilter: string
  sourceCounts: Map<DiscoverySourceFacetId, number>
  sourceAvailability: DiscoverySourceAvailability[]
  onClearFilters: () => void
}) {
  const noCandidatesAnywhere = totalUnfiltered === 0

  // Selected sources that genuinely have zero candidates (source empty), vs.
  // sources whose candidates exist but are excluded by the composed filters.
  const emptySources = selectedSources.filter((facet) => (sourceCounts.get(facet) ?? 0) === 0)
  const narrowedSources = selectedSources.filter((facet) => (sourceCounts.get(facet) ?? 0) > 0)
  const filtersTooNarrow = !noCandidatesAnywhere && filtersActive && (narrowedSources.length > 0 || selectedSources.length === 0)

  return (
    <div className="py-16 text-center" data-testid="discovery-empty-state">
      <h3 className="text-base font-semibold text-white">
        {noCandidatesAnywhere
          ? "No directory candidates exist yet"
          : filtersTooNarrow
            ? "Filters are too narrow"
            : "No candidates exist from the selected sources"}
      </h3>
      <div className="mx-auto mt-3 max-w-xl space-y-2 text-sm text-gray-400">
        {noCandidatesAnywhere ? (
          <p>
            No specialists or discovery candidates were found from any source — this is not a filter
            issue. Sources may not be ingested yet, and discovery never implies trust, payment approval,
            or live publication.
          </p>
        ) : null}
        {emptySources.map((facet) => {
          const availability = sourceAvailability.find((item) => item.facet === facet)
          return (
            <p key={facet} data-testid={`empty-source-${facet}`}>
              No candidates exist from <span className="text-gray-300">{describeDiscoverySourceFacet(facet).label}</span>
              {availability && !availability.available ? <> — {availability.note}</> : "."}
            </p>
          )
        })}
        {filtersTooNarrow ? (
          <p data-testid="filters-too-narrow">
            Candidates exist, but the current combination
            {selectedSources.length > 0 ? (
              <> of sources ({narrowedSources.map((facet) => describeDiscoverySourceFacet(facet).label).join(", ") || "selected"})</>
            ) : null}
            {taskFilter !== "All" ? <> and task type &ldquo;{taskFilter}&rdquo;</> : null}{" "}
            matches none of them. External candidates only match task filters when they declare RAP
            task types.
          </p>
        ) : null}
      </div>
      {filtersActive ? (
        <button
          type="button"
          onClick={onClearFilters}
          data-testid="clear-filters"
          className="mt-5 rounded-full bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          Clear all filters
        </button>
      ) : null}
    </div>
  )
}
