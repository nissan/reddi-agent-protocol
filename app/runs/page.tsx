"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { RatedJobsList } from "@/components/rating/RatedJobsList"
import type { SpecialistListing } from "@/lib/registry/bridge"

type RunRecord = {
  runId: string
  createdAt: string
  selectedWallet?: string
  endpointUrl?: string
  status: "completed" | "failed"
  challengeSeen: boolean
  paymentSatisfied: boolean
  x402TxSignature?: string
  x402ReceiptNonce?: string
  responsePreview?: string
  error?: string
  trace?: string[]
}

function shortWallet(wallet: string) {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function RunHistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [listings, setListings] = useState<SpecialistListing[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [runsRes, registryRes] = await Promise.all([fetch("/api/planner/runs"), fetch("/api/registry")])
        const [runsData, registryData] = await Promise.all([runsRes.json(), registryRes.json()])
        if (cancelled) return
        setRuns((runsData.result?.results ?? []).slice().reverse())
        setListings(registryData.listings ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const byWallet = useMemo(() => Object.fromEntries(listings.map((agent) => [agent.walletAddress, agent])), [listings])

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 space-y-8">
        <PageHeader
          label="History"
          title="Run History"
          subtitle="Your past specialist invocations"
          actions={
            <Link href="/planner">
              <Button size="sm">New run →</Button>
            </Link>
          }
        />

        <section className="space-y-3 rounded-xl bg-surface p-6 glow-border" aria-labelledby="rated-jobs-heading">
          <div>
            <h2 id="rated-jobs-heading" className="font-display text-xl text-white">Rated jobs</h2>
            <p className="mt-1 text-sm text-gray-400">
              Jobs you paid with &quot;Rate this job&quot; turned on. Each step is signed by your own wallet; the state shown is read from the job&apos;s rating account on chain.
            </p>
          </div>
          <RatedJobsList />
        </section>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface glow-border" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => {
              const specialist = run.selectedWallet ? byWallet[run.selectedWallet] : undefined
              const stepReached = run.status === "completed" ? 4 : run.challengeSeen ? 3 : 2

              return (
                <Card key={run.runId} className="flex items-center gap-4 p-5">
                  <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${run.status === "completed" ? "from-indigo-500 to-sky-500" : "from-fuchsia-500 to-pink-500"}`} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-white">{specialist?.onchain.model || shortWallet(run.selectedWallet || run.runId)}</h3>
                      <Badge variant="outline" className="border-white/10 bg-white/5 text-gray-300">
                        {timeAgo(run.createdAt)}
                      </Badge>
                      <Badge variant="outline" className={run.status === "completed" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}>
                        {run.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-400">{run.selectedWallet ? shortWallet(run.selectedWallet) : "Auto-selected specialist"}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>Step {stepReached}/4</span>
                      <span>•</span>
                      <span>{run.challengeSeen ? "x402 negotiation" : "direct call"}</span>
                      {run.x402ReceiptNonce ? <><span>•</span><span className="font-mono">{run.x402ReceiptNonce}</span></> : null}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className={`h-full rounded-full ${run.status === "completed" ? "bg-emerald-400" : "bg-indigo-500"}`} style={{ width: `${stepReached * 25}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Link href={run.selectedWallet ? `/agents/${run.selectedWallet}` : "/agents"} className="text-xs text-gray-400 hover:text-white">
                      View specialist
                    </Link>
                  </div>
                </Card>
              )
            })}
            {runs.length === 0 ? (
              <div className="rounded-xl bg-surface p-10 text-center text-gray-400 glow-border">
                No runs yet.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
