"use client"

import { cn } from "@/lib/utils"
import type { DiscoverySourceFacetId } from "@/lib/discovery/source-facets"

/**
 * Discovery source facet filter (#381).
 *
 * URL-addressable multi-select pill group: each pill toggles a source facet
 * in the `source` querystring (composable with the existing task-type
 * filter). Pure UI — selecting a source never invokes, pays, or probes it.
 */

export type SourceFacetFilterOption = {
  id: DiscoverySourceFacetId
  label: string
  count: number
  available: boolean
}

export function SourceFacetFilter({
  options,
  selected,
  onToggle,
}: {
  options: SourceFacetFilterOption[]
  selected: DiscoverySourceFacetId[]
  onToggle: (id: DiscoverySourceFacetId) => void
}) {
  return (
    <div role="group" aria-label="Filter by discovery source" className="flex flex-wrap gap-2" data-testid="source-facet-filter">
      {options.map((option) => {
        const active = selected.includes(option.id)
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onToggle(option.id)}
            aria-pressed={active}
            data-testid={`source-facet-${option.id}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400",
              active ? "bg-indigo-500 text-white" : "bg-surface text-gray-400 glow-border hover:text-white",
              !option.available && !active ? "opacity-70" : null,
            )}
          >
            {option.label}
            <span className={cn("ml-1.5 text-[10px]", active ? "text-indigo-100" : "text-gray-500")}>
              {option.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
