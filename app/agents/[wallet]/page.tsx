"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { showToast } from "@/components/ui/toast"
import type { SpecialistListing } from "@/lib/registry/bridge"

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

function ManifestList({ title, items, empty = "None declared." }: { title: string; items: string[]; empty?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-gray-500">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length > 0 ? items.map((item) => (
          <Badge key={item} variant="outline" className="border-white/10 bg-white/5 text-gray-300">
            {item}
          </Badge>
        )) : <p className="text-sm text-gray-400">{empty}</p>}
      </div>
    </div>
  )
}

export default function SpecialistDetailPage() {
  const params = useParams<{ wallet: string }>()
  const wallet = decodeURIComponent(params.wallet)
  const [listing, setListing] = useState<SpecialistListing | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch("/api/registry")
        const data = await res.json()
        if (cancelled) return
        setListing((data.listings ?? []).find((item: SpecialistListing) => item.walletAddress === wallet) ?? null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [wallet])

  const taskTypes = listing?.capabilities?.taskTypes ?? []
  const privacyModes = listing?.capabilities?.privacyModes ?? []
  const contextRequirements = listing?.capabilities?.context_requirements ?? []
  const runtimeCaps = listing?.capabilities?.runtime_capabilities ?? []
  const manifest = listing?.capabilities?.manifest
  const composition = listing?.capabilities?.agent_composition
  const manifestTools = manifest?.tools ?? composition?.tools ?? []
  const manifestSkills = manifest?.skills ?? listing?.capabilities?.tags ?? []
  const marketplaceAgentCalls = manifest?.marketplace_agent_calls ?? composition?.marketplace_agent_calls ?? []
  const externalMcpServers = manifest?.external_mcp_servers ?? composition?.external_mcp_servers ?? []
  const nonMarketplaceAgentCalls = manifest?.non_marketplace_agent_calls ?? composition?.non_marketplace_agent_calls ?? []

  const attestationHistory = useMemo(() => {
    if (!listing?.attestation.lastAttestedAt) return []
    return [
      {
        by: "Protocol attestation",
        when: listing.attestation.lastAttestedAt,
        tx: listing.capabilityHash ?? listing.walletAddress,
      },
    ]
  }, [listing])

  if (loading) {
    return <div className="mx-auto max-w-6xl px-4 py-16 text-gray-400">Loading specialist…</div>
  }

  if (!listing) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 space-y-4">
        <p className="text-red-300">Specialist not found.</p>
        <Link href="/agents">
          <Button variant="outline">← Back to directory</Button>
        </Link>
      </div>
    )
  }

  const health = listing.health.status === "pass" ? "online" : listing.health.status === "fail" ? "offline" : "unknown"

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">
        <Link href="/agents" className="text-sm text-gray-400 hover:text-white">
          ← Back to directory
        </Link>

        <PageHeader
          label="Specialist profile"
          title={manifest?.displayName || listing.onchain.model || shortWallet(wallet)}
          subtitle={wallet}
        />

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-white/10 bg-white/5 text-gray-200">
            {health === "online" ? "● Online" : health === "offline" ? "○ Offline" : "◌ Unknown"}
          </Badge>
          {listing.attestation.attested ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              ✓ Attested
            </Badge>
          ) : null}
          {taskTypes.map((task) => (
            <Badge key={task} variant="outline" className="border-white/10 bg-white/5 text-gray-300">
              {task}
            </Badge>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card hover className="overflow-hidden p-0">
            <div className={`h-40 bg-gradient-to-br ${avatarGradient(wallet)} relative`}>
              <div className="absolute inset-0 bg-page/55" />
              <div className="absolute bottom-4 left-4 text-white">
                <p className="text-sm text-white/80">Wallet</p>
                <h2 className="font-display text-2xl font-semibold">{shortWallet(wallet)}</h2>
              </div>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">Model</p>
                  <p className="mt-1 text-white">{listing.onchain.model || "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">Last seen</p>
                  <p className="mt-1 text-white">{listing.health.lastCheckedAt ? new Date(listing.health.lastCheckedAt).toLocaleString() : "Unknown"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">Jobs completed</p>
                  <p className="mt-1 text-white">{Number(listing.onchain.jobsCompleted)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">Jobs failed</p>
                  <p className="mt-1 text-white">{Number(listing.onchain.jobsFailed)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wider text-gray-500">Capabilities</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {taskTypes.map((task) => (
                    <Badge key={task} variant="outline" className="border-indigo-500/30 bg-indigo-500/10 text-indigo-200">
                      {task}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
                <p className="section-label mb-2">Public agent manifest</p>
                <p className="text-sm text-gray-300">
                  {manifest?.description || "This specialist has not published a detailed manifest description yet."}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <ManifestList title="Roles" items={manifest?.roles ?? []} />
                  <ManifestList title="Tools" items={manifestTools} />
                  <ManifestList title="Skills" items={manifestSkills} />
                  <ManifestList title="Preferred attestors" items={manifest?.preferred_attestors ?? []} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">Runtime capabilities</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {runtimeCaps.length > 0 ? runtimeCaps.map((cap) => (
                      <Badge key={cap} variant="outline" className="border-white/10 bg-white/5 text-gray-300">
                        {cap}
                      </Badge>
                    )) : <p className="text-sm text-gray-400">None declared.</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500">Context requirements</p>
                  <div className="mt-2 space-y-2">
                    {contextRequirements.length > 0 ? contextRequirements.map((req) => (
                      <div key={req.key} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-300">
                        <span className="font-medium text-white">{req.key}</span> · {req.type} {req.required ? "(required)" : "(optional)"}
                      </div>
                    )) : <p className="text-sm text-gray-400">None declared.</p>}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="section-label mb-2">Downstream execution disclosure</p>
                <p className="text-sm text-gray-300">
                  {manifest?.disclosure_policy || "No explicit downstream disclosure policy has been published for this specialist."}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <ManifestList title="Directory agents it may call" items={marketplaceAgentCalls} empty="No downstream agent calls disclosed." />
                  <ManifestList title="External MCP servers" items={externalMcpServers} empty="No external MCP servers disclosed." />
                  <ManifestList title="External agents/services" items={nonMarketplaceAgentCalls} empty="No external agents disclosed." />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs text-gray-500">Reputation</p>
                  <p className="mt-1 text-lg text-white">{listing.onchain.reputationScore}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs text-gray-500">Attestation accuracy</p>
                  <p className="mt-1 text-lg text-white">{listing.onchain.attestationAccuracy}%</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs text-gray-500">Payment/evidence boundary</p>
                  <p className="mt-1 text-lg text-white">{privacyModes.join(", ") || "public"}</p>
                </div>
              </div>
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="space-y-4 p-6">
              <div>
                <p className="section-label mb-2">Hire this Specialist</p>
                <p className="text-3xl font-display text-white">◎ {(Number(listing.onchain.rateLamports) / 1_000_000_000).toFixed(4)} SOL/call</p>
                <p className="mt-1 text-sm text-gray-400">Payment mode, evidence, and execution are routed through the planner; settlement finality is not implied.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {privacyModes.map((mode) => (
                  <Badge key={mode} variant="outline" className="border-white/10 bg-white/5 text-gray-300">
                    {mode}
                  </Badge>
                ))}
              </div>
              <Link href={`/planner?specialist=${wallet}`}>
                <Button className="w-full">Invoke via Planner →</Button>
              </Link>
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  await navigator.clipboard.writeText(listing.health.endpointUrl ?? wallet)
                  showToast("Endpoint copied", "success")
                }}
              >
                Direct x402 call
              </Button>
            </Card>

            <Card className="space-y-3 p-6">
              <p className="section-label">Health status</p>
              <div className="space-y-2 text-sm text-gray-300">
                <p>Endpoint: {listing.health.endpointUrl ?? "Not published"}</p>
                <p>Health: {health}</p>
                <p>Freshness: {listing.health.freshnessState}</p>
                <p>Last checked: {listing.health.lastCheckedAt ? new Date(listing.health.lastCheckedAt).toLocaleString() : "Unknown"}</p>
              </div>
            </Card>
          </div>
        </div>

        <Card className="space-y-4 p-6">
          <p className="section-label">Attestation history</p>
          {attestationHistory.length > 0 ? (
            <div className="space-y-3">
              {attestationHistory.map((item) => (
                <div key={item.tx} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-300">
                  <span>{item.by}</span>
                  <span>{new Date(item.when).toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No attestation history recorded yet.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
