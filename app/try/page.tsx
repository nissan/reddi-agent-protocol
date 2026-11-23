import type { Metadata } from "next";

import TryConsole from "@/components/try/TryConsole";

export const metadata: Metadata = {
  title: "Try one paid call",
  description: "Pay an AI provider once from your own wallet with Solana Pay, see the answer and the receipt, then hand the same steps to your agent.",
};

export default function TryPage() {
  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">Try it yourself</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Pay for one answer. Then let your agent do it.</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            Agents paying agents is new. Paying from your own wallet isn&apos;t. Pick a question, scan the Solana Pay code or use the wallet in this
            browser, and get the answer back with a receipt you can check. It&apos;s the same payment your agent will make for you later, so you know
            exactly what it leads to. No wallet yet? Choose &ldquo;Preview without a wallet&rdquo; and walk through the same call first.
          </p>
          <ul className="mt-6 grid gap-3 text-sm leading-6 text-gray-200 sm:grid-cols-3" data-testid="try-boundary">
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Solana devnet.</span> Test SOL has no monetary value. Mainnet is coming soon.</li>
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">One signature.</span> Your wallet signs one transaction that locks the most the call can cost. The unused part comes back.</li>
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Scripted providers for now.</span> Answers come from the sandbox script, and the receipt says so.</li>
          </ul>
        </header>

        <TryConsole />
      </div>
    </div>
  );
}
