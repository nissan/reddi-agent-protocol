import type { Metadata } from "next";

import SandboxConsole from "@/components/sandbox/SandboxConsole";

export const metadata: Metadata = {
  title: "Devnet sandbox",
  description: "Pay for an answer on Solana devnet and check the receipt yourself. Scripted providers, test funds only.",
};

export default async function SandboxPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const scenario = (await searchParams).scenario;

  return (
    <div className="min-h-screen bg-page text-white">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-brand-green/25 bg-paper-raised p-8 md:p-10">
          <p className="section-label">Devnet sandbox</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">Pay for an answer. Check the receipt yourself.</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
            Send an OpenAI-style request, meet a 402 payment challenge, pay it, and get the answer back with a receipt that names the
            provider, the model it declares, and hashes of what you asked and what you got. Then try to break it.
          </p>
          <ul className="mt-6 grid gap-3 text-sm leading-6 text-gray-200 sm:grid-cols-3" data-testid="sandbox-boundary">
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Solana devnet only.</span> Test SOL has no monetary value. No wallet is needed for the simulated payment.</li>
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Scripted providers.</span> Answers come from a script, not a running model, and every receipt says so.</li>
            <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Declared, not proven.</span> A receipt records the model a provider declares. It does not prove which model ran.</li>
          </ul>
        </header>

        <SandboxConsole initialScenario={typeof scenario === "string" ? scenario : undefined} />
      </div>
    </div>
  );
}
