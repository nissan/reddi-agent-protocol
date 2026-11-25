import Link from "next/link";

const STEPS: { title: string; body: string; code?: string }[] = [
  { title: "Install the provider kit", body: "One command-line tool puts a paid, per-token endpoint in front of any OpenAI-compatible model: a hosted API, OpenRouter, Ollama or vLLM.", code: "npm install -g @redditech/provider-kit" },
  { title: "Create your config and set your price", body: "The config holds your model, your payout wallet and your price per million input and output tokens.", code: "rap-provider init" },
  { title: "Check it before it takes money", body: "The preflight tells you exactly what is missing: wallet, token accounts, upstream key, public address.", code: "rap-provider doctor" },
  { title: "Start it and list it", body: "Start serves paid calls and signs a receipt for each. Register puts you on the Solana registry and in the Providers list.", code: "rap-provider start\nrap-provider register" },
];

/** The V1 way to run a provider: the provider kit, in four steps (#1148). */
export default function ProviderKitGuide() {
  return (
    <section aria-labelledby="provider-kit-guide" className="rounded-3xl border border-brand-green/25 bg-paper-raised p-6 md:p-8" data-testid="provider-kit-guide">
      <p className="section-label">The quick way</p>
      <h2 id="provider-kit-guide" className="mt-2 font-display text-2xl font-bold text-white md:text-3xl">Four steps with the provider kit</h2>
      <ol className="mt-5 grid gap-4 md:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-xl border border-white/10 bg-black/25 p-4">
            <p className="text-sm font-semibold text-white">{index + 1}. {step.title}</p>
            <p className="mt-2 text-sm leading-6 text-gray-300">{step.body}</p>
            {step.code ? <pre className="mt-3 overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs leading-5 text-gray-100">{step.code}</pre> : null}
          </li>
        ))}
      </ol>
      <ul className="mt-5 grid gap-3 text-sm leading-6 text-gray-300 sm:grid-cols-3">
        <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">You set the price.</span> Per million tokens in and out. Buyers approve a maximum and pay for what was used.</li>
        <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Paid from escrow.</span> The buyer&apos;s lock is checked before your model runs, and you settle after the answer.</li>
        <li className="rounded-xl border border-white/10 bg-black/25 p-3"><span className="font-semibold text-white">Founding Providers.</span> The first 100 services to take a paid job on mainnet can earn back fees above 1.5% in their first year.</li>
      </ul>
      <p className="mt-5 text-sm text-gray-400">
        Full steps: the <a className="underline hover:text-white" href="/provider.md">provider skill file</a> (give it to your agent and it sets this up for you), the{" "}
        <a className="underline hover:text-white" href="https://github.com/nissan/reddi-agent-protocol/blob/main/packages/provider-kit/README.md" target="_blank" rel="noopener noreferrer">kit README</a>,{" "}
        <a className="underline hover:text-white" href="/pricing.md">pricing and fees</a> and the <Link className="underline hover:text-white" href="/terms">terms</Link>.
      </p>
    </section>
  );
}
