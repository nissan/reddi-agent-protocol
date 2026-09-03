import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SpecialistCardProps {
  wallet: string
  name?: string
  model?: string
  taskTypes?: string[]
  reputationScore?: number
  attested?: boolean
  health?: "online" | "offline" | "unknown"
  freshnessState?: "fresh" | "warm" | "stale" | "unknown"
  ratePerCall?: number
  progress?: number
  tools?: string[]
  skills?: string[]
  marketplaceAgentCalls?: string[]
  externalMcpServers?: string[]
  nonMarketplaceAgentCalls?: string[]
  /** #381 discovery source facet badge (e.g. RAP registry / OpenRouter / Local demo). */
  sourceFacet?: { id: string; label: string }
  /** Media/resource type line for the discovery card contract (#381). */
  resourceType?: string
  mediaType?: string
}

function shortWallet(wallet: string) {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet
}

function avatarGradient(seed: string) {
  const palette = [
    "from-indigo-500/80 to-sky-500/30",
    "from-fuchsia-500/80 to-pink-500/30",
    "from-emerald-500/80 to-teal-500/30",
    "from-amber-500/80 to-orange-500/30",
  ]
  const index = [...seed].reduce((acc, char) => acc + char.charCodeAt(0), 0) % palette.length
  return palette[index]
}

function formatSol(lamports?: number) {
  if (!lamports) return "free"
  return `◎ ${(lamports / 1_000_000_000).toFixed(4)} SOL/call`
}

export function SpecialistCard({
  wallet,
  name,
  model,
  taskTypes = [],
  reputationScore = 0,
  attested = false,
  health = "unknown",
  freshnessState = "unknown",
  ratePerCall = 0,
  progress = 0,
  tools = [],
  skills = [],
  marketplaceAgentCalls = [],
  externalMcpServers = [],
  nonMarketplaceAgentCalls = [],
  sourceFacet,
  resourceType = "specialist endpoint",
  mediaType = "http + json manifest",
}: SpecialistCardProps) {
  const healthTone =
    health === "online"
      ? "bg-emerald-500 text-emerald-50"
      : health === "offline"
      ? "bg-slate-500 text-slate-100"
      : "bg-slate-600 text-slate-100"

  const freshnessTone =
    freshnessState === "fresh"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : freshnessState === "warm"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
      : freshnessState === "stale"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
      : "border-white/10 bg-white/5 text-gray-400"

  const downstreamCount = marketplaceAgentCalls.length + externalMcpServers.length + nonMarketplaceAgentCalls.length

  return (
    <Link
      href={`/agents/${wallet}`}
      className="block h-full rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
      data-testid="agent-card"
      data-claim-scope="external"
      data-source-facet={sourceFacet?.id}
      data-render-state="rap-native"
      data-trust-state={attested ? "trusted" : "unverified"}
    >
      <Card hover className="h-full overflow-hidden">
        <div className={cn("relative h-36 bg-gradient-to-br", avatarGradient(wallet))}>
          <div className="absolute inset-0 bg-page/55" />
          <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/90">
            {health === "online" ? "● Online" : health === "offline" ? "○ Offline" : "◌ Unknown"}
          </div>
          <div className={cn("absolute right-4 top-4 h-3 w-3 rounded-full ring-4 ring-black/20", healthTone)} />
          <div className="absolute bottom-4 left-4 right-4">
            <div className="flex flex-wrap gap-1.5">
              {sourceFacet ? (
                <Badge
                  variant="outline"
                  className="border-indigo-400/40 bg-indigo-500/20 text-[10px] uppercase tracking-wide text-indigo-200"
                  data-testid="candidate-source-badge"
                >
                  {sourceFacet.label}
                </Badge>
              ) : null}
              {taskTypes[0] ? (
                <Badge variant="outline" className="border-white/15 bg-black/30 text-white">
                  {taskTypes[0]}
                </Badge>
              ) : null}
              <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", freshnessTone)}>
                {freshnessState}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <h3 className="font-display text-base font-semibold text-white">
              {name ?? shortWallet(wallet)}
            </h3>
            <p className="text-sm text-gray-400">{model ?? "Specialist endpoint"}</p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {taskTypes.slice(0, 3).map((task) => (
              <Badge key={task} variant="outline" className="border-white/10 bg-white/5 text-[11px] text-gray-300">
                {task}
              </Badge>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-gray-300">
            <div className="flex items-center justify-between gap-2" data-testid="candidate-resource-type">
              <span>Resource</span>
              <span className="text-gray-400">{resourceType} · {mediaType}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span>Manifest</span>
              <span className="text-gray-400">{tools.length} tools · {skills.length} skills</span>
            </div>
            <div className="mt-1 text-gray-400">
              {downstreamCount > 0
                ? `${downstreamCount} disclosed downstream/MCP dependencies`
                : "No downstream dependencies disclosed"}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-gray-300">
            <span>⭐ {Math.round(reputationScore / 100)}</span>
            <span>{formatSol(ratePerCall)}</span>
            {attested ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300">
                Attested
              </Badge>
            ) : (
              <Badge variant="outline" className="border-white/10 bg-white/5 text-[11px] text-gray-400">
                Unverified
              </Badge>
            )}
          </div>

          {progress > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span>Activity</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </Link>
  )
}
