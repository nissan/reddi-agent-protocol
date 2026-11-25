import type { Metadata } from "next";
import Link from "next/link";

import AgentHandoff from "@/components/try/AgentHandoff";

export const metadata: Metadata = {
  title: "Set up your agent",
  description: "Give your agent the Reddi Agent Protocol skill file and a budget, and it can pay AI providers per token on Solana and check every receipt.",
};

export default function AgentSetupPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-5xl space-y-10 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">For agents</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-5xl">Set your agent up to pay for inference</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            One skill file teaches your agent the whole loop: find a provider, get a per-token quote, lock the most a call can cost, make the call,
            and check the signed receipt. You choose the budget. Haven&apos;t paid for a call yourself yet? <Link className="underline hover:text-white" href="/try">Try one first</Link>. It takes a minute.
          </p>
          <p className="mt-6 rounded-xl border border-brand-green/40 bg-brand-green/10 p-3 text-sm leading-6 text-gray-200" data-testid="budget-callout">
            <span className="font-semibold text-white">New: Budgets.</span> Give your agent a Budget key instead of a wallet: it spends one lock across the providers you pick. <Link className="underline hover:text-white" href="/budget">Set a budget</Link>.
          </p>
        </header>
        <AgentHandoff heading="Pick your agent" afterTry={false} />
      </div>
    </div>
  );
}
