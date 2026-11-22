"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"

type AdlIntent = {
  asset?: { symbol?: string; network?: string }
  price?: { per?: string; inputPerMillion?: string; outputPerMillion?: string; maxPerCall?: string; amount?: string }
  settlement?: string
}
type AdlResponse = {
  ok: true
  source: "provider" | "generated" | null
  level: number
  status: "pass" | "fail"
  adl: { metadata?: { description?: string }; extensions?: { x402?: { intents?: AdlIntent[]; protocolFee?: { bps?: number; launchRate?: { bps?: number; endsAt?: string } } }; receipts?: { refs?: { format?: string }[] } } }
}

const percent = (bps?: number) => (typeof bps === "number" ? `${bps / 100}%` : "")

/**
 * A listed provider's Agent Definition Language (ADL v0.3) document: what it
 * charges and how it settles, the fee and the receipt it returns, with the
 * full YAML. Renders nothing for a provider without a listed ADL.
 */
export function AgentAdlCard({ wallet }: { wallet: string }) {
  const [data, setData] = useState<AdlResponse | null>(null)
  const [yaml, setYaml] = useState<string>("")
  const href = `/api/listings/${encodeURIComponent(wallet)}/adl`

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [json, text] = await Promise.all([fetch(`${href}?format=json`), fetch(href)])
        if (!json.ok || !text.ok) return
        const body = (await json.json()) as AdlResponse
        const yamlText = await text.text()
        if (live && body.ok) {
          setData(body)
          setYaml(yamlText)
        }
      } catch {
        // No ADL card when it cannot be read.
      }
    })()
    return () => {
      live = false
    }
  }, [href])

  if (!data) return null
  const x402 = data.adl.extensions?.x402
  const intent = x402?.intents?.[0]
  const price = intent?.price
  const symbol = intent?.asset?.symbol ?? ""
  const fee = x402?.protocolFee
  const launchEnds = fee?.launchRate?.endsAt ? new Date(fee.launchRate.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ""

  return (
    <Card className="space-y-4 p-6" data-testid="agent-adl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="section-label">Agent definition (ADL v0.3)</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={data.status === "pass" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}>
            {data.status === "pass" ? `✓ Level ${data.level}` : "Does not pass Level 3"}
          </Badge>
          <Badge variant="outline" className="border-white/10 bg-white/5 text-gray-300">
            {data.source === "provider" ? "Published by the provider" : "Described from the listing"}
          </Badge>
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {price?.per === "token" ? (
          <>
            <div>
              <dt className="text-xs uppercase tracking-wider text-gray-500">Price per million tokens</dt>
              <dd className="mt-1 text-white">{price.inputPerMillion} in / {price.outputPerMillion} out {symbol}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-gray-500">Most one call can cost</dt>
              <dd className="mt-1 text-white">{price.maxPerCall} {symbol}</dd>
            </div>
          </>
        ) : price?.per === "call" ? (
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">Price per job</dt>
            <dd className="mt-1 text-white">{price.amount} {symbol}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs uppercase tracking-wider text-gray-500">Settlement</dt>
          <dd className="mt-1 text-white">{intent?.settlement === "metered-escrow" ? "Metered escrow: pay for the tokens used" : intent?.settlement === "escrow" ? "Escrow" : intent?.settlement ?? ""}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-gray-500">Protocol fee</dt>
          <dd className="mt-1 text-white">
            {percent(fee?.bps)}
            {fee?.launchRate ? `, ${percent(fee.launchRate.bps)} launch rate until ${launchEnds}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-gray-500">Receipt</dt>
          <dd className="mt-1 text-white">{data.adl.extensions?.receipts?.refs?.[0]?.format ?? ""}, signed by the provider</dd>
        </div>
      </dl>
      <details className="rounded-lg border border-white/10 bg-white/5">
        <summary className="cursor-pointer px-4 py-2 text-sm text-gray-300">Show the ADL document</summary>
        <pre className="max-h-96 overflow-auto px-4 pb-4 text-xs leading-relaxed text-gray-300">{yaml}</pre>
      </details>
      <a href={href} download={`${wallet}.adl.yaml`} className="inline-block text-sm text-indigo-300 hover:text-white">
        Download adl.yaml
      </a>
    </Card>
  )
}
