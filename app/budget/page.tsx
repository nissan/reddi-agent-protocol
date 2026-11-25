import type { Metadata } from "next";

import BudgetConsole from "@/components/budget/BudgetConsole";

export const metadata: Metadata = {
  title: "Give your agent a budget",
  description: "Set a budget in one token, give your agent a key, and watch what each provider takes. Approve, dispute or close early, and get the rest back.",
};

const STEPS = [
  { title: "Set a budget", body: "Lock it once from your own wallet, in one token. $5 for 72 hours is a good start." },
  { title: "Give your agent the key", body: "It pays the providers you picked, call by call, and never more than half to any one of them." },
  { title: "Get the rest back", body: "Close it when the job is done. Providers are paid what they used, and the rest comes straight back to you." },
];

export default function BudgetPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">Budget</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Give your agent a budget, not a wallet.</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            Your agent shouldn&apos;t hold your keys. Set a budget from your own wallet, hand your agent a key, and it pays AI providers per call from that
            budget. You see every share a provider takes, and you can approve it, dispute it or close the budget early.
          </p>
          <ol className="mt-6 grid gap-3 text-sm leading-6 text-gray-200 sm:grid-cols-3" data-testid="budget-steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-white/10 bg-black/25 p-3">
                <span className="font-semibold text-white">{i + 1}. {step.title}.</span> {step.body}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-gray-400" data-testid="budget-boundary">Runs on Solana devnet: test tokens have no value. Mainnet is coming soon.</p>
        </header>

        <BudgetConsole />
      </div>
    </div>
  );
}
