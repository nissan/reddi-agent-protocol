import type { Metadata } from "next";
import Link from "next/link";

import PassConsole from "@/components/pass/PassConsole";
import { stageCopy } from "@/lib/config/launch-stage";

export const metadata: Metadata = {
  title: "Give your agent a pass",
  description: "Lock a budget for your AI assistant with one Solana Pay signature, then give it a key that pays providers per call, up to that budget, for 24 hours.",
};

export default function PassPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">Agent pass</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Give your agent a budget, not your wallet.</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            Your assistant can&apos;t sign transactions, but it can call an API with a key. Pick the providers it may use and a budget for each, lock
            that budget with one Solana Pay signature, and paste the key into your assistant. It pays per call, every call comes with a receipt, and
            whatever it doesn&apos;t spend comes back to you.
          </p>
          <p className="mt-6 rounded-xl border border-brand-green/40 bg-brand-green/10 p-3 text-sm leading-6 text-gray-200" data-testid="budget-callout">
            <span className="font-semibold text-white">New: Budgets.</span> A Budget is one lock for every provider, open 72 hours, with shares you can approve or dispute. <Link className="underline hover:text-white" href="/budget">Set a budget</Link>.
          </p>
          <ul className="mt-6 grid gap-3 text-sm leading-6 text-gray-200 sm:grid-cols-3" data-testid="pass-boundary">
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Solana devnet.</span> {stageCopy().perCallNetwork}</li>
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Your SOL stays in escrow.</span> Each provider can be paid only for what it answers, up to its lock. The pass ends after 24 hours.</li>
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Scripted providers for now.</span> Answers come from the sandbox script, and the receipt says so.</li>
          </ul>
        </header>

        <PassConsole />
      </div>
    </div>
  );
}
