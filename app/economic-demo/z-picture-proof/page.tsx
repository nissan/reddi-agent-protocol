"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

import { useEffect, useState } from "react";

type Proof = any;
function short(v?: string) { return v ? `${v.slice(0, 8)}…${v.slice(-8)}` : "—"; }

export default function ZPictureProofPage() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/economic-demo/z-picture-latest')
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !body) throw new Error(body?.error || `proof_fetch_${r.status}`);
        return body;
      })
      .then(setProof)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  const s = proof?.summary;
  const txs = s?.paymentTxs ?? [];
  return <main className="min-h-screen bg-page text-white"><section className="mx-auto max-w-7xl px-6 py-10">
    <p className="section-label">Economic demo · recorded proof replay</p>
    <h1 className="mt-3 font-display text-5xl font-bold">A recorded Agent Protocol run generated “Z” and left devnet-bounded proof references</h1>
    <p className="mt-4 max-w-4xl text-gray-300">Payments prove transfer; RAP Assurance proves paid work. This is a replay of a completed evidence artifact: x402 payment-proof references, returned image proof, recorded devnet transaction links, MagicBlock PER reference evidence, and Torque reputation-input projections.</p>
    {!s && !error && <p className="mt-8 text-[#14F195]">Loading latest completed Z picture run…</p>}
    {error && <section className="mt-8 rounded-2xl border border-yellow-400/25 bg-yellow-400/10 p-5"><p className="section-label">Proof loading issue</p><h2 className="mt-2 text-2xl font-semibold">Static proof fallback unavailable</h2><p className="mt-3 text-sm text-gray-200">The proof API returned: <span className="font-mono text-yellow-100">{error}</span></p></section>}
    {s && <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-[#14F195]/25 bg-[#14F195]/10 p-5"><p className="section-label">Run identity</p><h2 className="mt-2 text-2xl font-semibold">{s.runId}</h2><p className="mt-3 text-gray-300">{s.prompt}</p>{proof?.source === 'static-bounded-fallback' && <p className="mt-3 rounded-lg border border-[#14F195]/20 bg-black/30 p-3 text-xs text-gray-300">Replay fallback: showing a frozen completed proof artifact because serverless deployments do not persist local run artifacts.</p>}<div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-black/30 p-3"><p className="text-gray-500">Status</p><p className="text-[#14F195]">{s.paidRun.status}</p></div><div className="rounded-xl bg-black/30 p-3"><p className="text-gray-500">Recorded spend</p><p className="text-[#14F195]">{s.paidRun.spentUsdc} USDC</p></div></div></section>
      <section className="rounded-2xl border border-white/10 bg-card/80 p-5 row-span-2"><p className="section-label">Returned image proof</p><h2 className="mt-2 text-2xl font-semibold">The generated output shows “Z”</h2>{proof?.imageUrl && <img src={proof.imageUrl} alt="Generated image showing Z" className="mt-5 aspect-square w-full rounded-xl border border-white/10 bg-black object-contain" />}<p className="mt-3 font-mono text-xs text-gray-400">{s.image.provider} · {s.image.model} · {s.image.receipt}</p></section>
      <section className="rounded-2xl border border-white/10 bg-card/80 p-5"><p className="section-label">Solscan devnet references</p><h2 className="mt-2 text-2xl font-semibold">Payment-proof transaction references</h2><div className="mt-4 space-y-2">{txs.map((tx: any) => <a key={tx.signature} href={tx.solscan} target="_blank" className="block rounded-lg border border-[#14F195]/20 bg-black/30 p-3"><span className="text-gray-400">{tx.profileId}</span><br/><span className="font-mono text-[#14F195]">{short(tx.signature)}</span></a>)}</div></section>
      <section className="rounded-2xl border border-accent-purple/25 bg-accent-purple/10 p-5"><p className="section-label">MagicBlock PER</p><h2 className="mt-2 text-2xl font-semibold">Bounded reference evidence</h2><p className="mt-3 text-sm leading-6 text-gray-200">{s.perProof.claim}</p><p className="mt-3 font-mono text-xs text-accent-purple">TEE RPC: {s.perProof.teeRpcUrl}</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(s.perProof.solscan).map(([label, url]) => <a key={label} href={url as string} target="_blank" className="rounded-lg border border-accent-purple/25 bg-black/30 p-3 text-sm text-accent-purple">{label} · {short(String(url).split('/tx/')[1]?.split('?')[0])}</a>)}</div></section>
      <section className="rounded-2xl border border-yellow-400/25 bg-yellow-400/10 p-5"><p className="section-label">Torque reputation-input dashboard</p><h2 className="mt-2 text-2xl font-semibold">Consumer and agent score projections after completion</h2><div className="mt-4 grid gap-3"><div className="rounded-xl bg-black/30 p-4"><p className="text-gray-400">Consumer</p><p className="break-all font-mono text-xs">{s.torque.score.consumer.wallet}</p><p className="mt-2 text-4xl font-bold text-yellow-100">{s.torque.score.consumer.before} → {s.torque.score.consumer.after}</p></div><div className="rounded-xl bg-black/30 p-4"><p className="text-gray-400">Agent</p><p className="break-all font-mono text-xs">{s.torque.score.agent.wallet}</p><p className="mt-2 text-4xl font-bold text-yellow-100">{s.torque.score.agent.before} → {s.torque.score.agent.after}</p></div></div></section>
    </div>}
  </section></main>;
}
