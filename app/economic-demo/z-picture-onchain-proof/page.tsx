"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

import { useEffect, useState } from "react";

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const teeExplorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent("https://devnet-tee.magicblock.app")}`;
const explorerAddress = (addr: string) => `https://explorer.solana.com/address/${addr}?cluster=devnet`;
const short = (v?: string) => (v ? `${v.slice(0, 8)}…${v.slice(-8)}` : "—");

const umbra = {
  artifact: "artifacts/umbra-devnet-receiver-claimable-utxo/20260507T092405Z/SUMMARY.json",
  programId: "DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ",
  createUtxo: [
    "5kiNbAVHG2AhqNFqsLprTfSYJDKQSMh6FCUtz2RiroRSeXQiss2tjLsV3yu4ccKBYzmCeaNvMNzxkQHZUcW6AwBK",
    "4yyP18Mo21HGhPKnEggakgVJG6CrYBeqSQ5qz4htQXCFjmyUTBCjo4joFzZZ5ecy43b2myLZpfnVQ97gR9Vp2nmi",
  ],
  claim: [
    "5DsrahqsiTJqrbSu5tAiJdWJMCxGNBrMqjTvNa8xKAqdDoFex5UPqSjWrYcPEAiHeV8N7mrJ2F5xcNh8wvyRAvQo",
    "3Ep9W98mgMrjeczR898D8cbr9VNfRdPkPnEta6iR2XqN2CKNXxjtf8BtYPHEJXbQc2hjqyx4ARhfFjZ58ZowJ9ae",
  ],
  encryptedBefore: "497867",
  encryptedAfter: "995734",
};

function TxLink({ label, sig, href }: { label: string; sig: string; href?: string }) {
  return (
    <a data-proof-link={label} href={href ?? explorerTx(sig)} target="_blank" className="block rounded-xl border border-[#14F195]/25 bg-black/35 p-3 hover:border-[#14F195]">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 font-mono text-sm text-[#14F195]">{short(sig)}</p>
      <p className="mt-1 text-xs text-gray-400">Open Solana Explorer · devnet · transaction details</p>
    </a>
  );
}

export default function ZPictureOnchainProofPage() {
  const [proof, setProof] = useState<any | null>(null);
  useEffect(() => { fetch("/api/economic-demo/z-picture-latest").then((r) => r.json()).then(setProof); }, []);
  const s = proof?.summary;
  const x402Txs = s?.paymentTxs ?? [];

  return (
    <main className="min-h-screen bg-page text-white">
      <section className="mx-auto max-w-7xl px-6 py-10">
        <p className="section-label">Economic demo · recorded devnet proof refs</p>
        <h1 className="mt-3 max-w-5xl font-display text-5xl font-bold">Z image run with labelled Solana Explorer reference links</h1>
        <p className="mt-4 max-w-4xl text-gray-300">Payments prove transfer; RAP Assurance proves paid work. This page separates recorded devnet transfer references from sandbox/off-chain evidence and does not claim mainnet, custody, or production settlement.</p>

        {!s && <p className="mt-8 text-[#14F195]">Loading latest Z run…</p>}
        {s && <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#14F195]/25 bg-[#14F195]/10 p-5">
            <p className="section-label">1 · Recorded Agent Protocol call</p>
            <h2 className="mt-2 text-2xl font-semibold">{s.runId}</h2>
            <p className="mt-3 text-gray-300">The recorded picture scenario binds four x402 challenge/payment-proof references to the returned image evidence. This is devnet-bounded evidence, not a live production or mainnet claim.</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-black/30 p-3"><p className="text-gray-500">Spent</p><p className="text-[#14F195]">{s.paidRun.spentUsdc} USDC</p></div><div className="rounded-xl bg-black/30 p-3"><p className="text-gray-500">Wallet</p><p className="font-mono text-xs">{short(s.paidRun.orchestratorWallet)}</p></div></div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-card/80 p-5 row-span-2">
            <p className="section-label">Returned image proof</p>
            <h2 className="mt-2 text-2xl font-semibold">The generated output shows “Z”</h2>
            {proof?.imageUrl && <img src={proof.imageUrl} alt="Generated Z proof" className="mt-5 aspect-square w-full rounded-xl border border-white/10 bg-black object-contain" />}
            <p className="mt-3 font-mono text-xs text-gray-400">{s.image.provider} · {s.image.model} · {s.image.receipt}</p>
          </section>

          <section className="rounded-2xl border border-white/10 bg-card/80 p-5">
            <p className="section-label">2 · x402 transfer references</p>
            <h2 className="mt-2 text-2xl font-semibold">Open these in Solana Explorer</h2>
            <div className="mt-4 grid gap-2">{x402Txs.map((tx: any) => <TxLink key={tx.signature} label={`x402 ${tx.profileId}`} sig={tx.signature} />)}</div>
          </section>

          <section className="rounded-2xl border border-accent-purple/25 bg-accent-purple/10 p-5 lg:col-span-2">
            <p className="section-label">3 · MagicBlock PER reference evidence</p>
            <h2 className="mt-2 text-2xl font-semibold">Delegation state is historical/devnet-bounded evidence</h2>
            <p className="mt-3 text-gray-300">PER material is from a MagicBlock TEE smoke artifact. Treat these links as bounded reference evidence only: no mainnet, production privacy, custody, or broad private-payee settlement claim is made.</p>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <TxLink label="MagicBlock lock" sig={s.perProof.lockTx} />
              <TxLink label="MagicBlock delegate" sig={s.perProof.delegateTx} />
              <TxLink label="MagicBlock release (TEE RPC)" sig={s.perProof.releaseTx} href={teeExplorerTx(s.perProof.releaseTx)} />
              <TxLink label="MagicBlock commit (TEE RPC)" sig={s.perProof.commitTx} href={teeExplorerTx(s.perProof.commitTx)} />
            </div>
            <a href={explorerAddress(s.perProof.programId)} target="_blank" className="mt-3 inline-block text-sm text-accent-purple underline">Program account: {short(s.perProof.programId)}</a>
          </section>

          <section className="rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-5 lg:col-span-2">
            <p className="section-label">4 · Umbra adapter evidence boundary</p>
            <h2 className="mt-2 text-2xl font-semibold">Receiver-claimable UTXO create + claim references</h2>
            <p className="mt-3 text-gray-300">Umbra evidence is devnet-only adapter evidence, not production private settlement. The recorded artifact tracks create/claim references and encrypted-balance metadata from {umbra.encryptedBefore} to {umbra.encryptedAfter}. Artifact: {umbra.artifact}</p>
            <div className="mt-4 grid gap-2 md:grid-cols-4">
              {umbra.createUtxo.map((sig, i) => <TxLink key={sig} label={`Umbra create UTXO #${i + 1}`} sig={sig} />)}
              {umbra.claim.map((sig, i) => <TxLink key={sig} label={`Umbra claim #${i + 1}`} sig={sig} />)}
            </div>
            <a href={explorerAddress(umbra.programId)} target="_blank" className="mt-3 inline-block text-sm text-cyan-200 underline">Umbra program: {short(umbra.programId)}</a>
          </section>

          <section className="rounded-2xl border border-yellow-400/25 bg-yellow-400/10 p-5 lg:col-span-2">
            <p className="section-label">5 · Torque reputation-input boundary</p>
            <h2 className="mt-2 text-2xl font-semibold">Demo-local reputation projection changed after x402 + event emission; no Torque on-chain reward tx is claimed</h2>
            <p className="mt-3 text-gray-300">The dashboard score is the demo-local Torque-compatible projection after emitting consumer and specialist events. The on-chain anchor for this flow is the Solana x402 payment evidence above. We are not claiming a live production Torque campaign or on-chain Torque reward settlement.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-xl bg-black/30 p-4"><p className="text-gray-400">Consumer</p><p className="font-mono text-xs">{s.torque.score.consumer.wallet}</p><p className="mt-2 text-4xl font-bold text-yellow-100">{s.torque.score.consumer.before} → {s.torque.score.consumer.after}</p></div><div className="rounded-xl bg-black/30 p-4"><p className="text-gray-400">Agent</p><p className="font-mono text-xs">{s.torque.score.agent.wallet}</p><p className="mt-2 text-4xl font-bold text-yellow-100">{s.torque.score.agent.before} → {s.torque.score.agent.after}</p></div></div>
          </section>
        </div>}
      </section>
    </main>
  );
}
