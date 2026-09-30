import { mcpBridgeDemoFixture } from "@/lib/mcp-bridge-demo/fixture";

function statusClass(
  status: "pass" | "blocked" | "pending" | "not_applicable",
) {
  if (status === "pass")
    return "border-[#14F195]/40 bg-[#14F195]/10 text-[#14F195]";
  if (status === "blocked")
    return "border-red-400/40 bg-red-400/10 text-red-200";
  if (status === "pending")
    return "border-yellow-400/40 bg-yellow-400/10 text-yellow-100";
  return "border-white/15 bg-white/5 text-gray-300";
}

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 10)}…${wallet.slice(-8)}`;
}

export default function McpBridgeDemoPage() {
  const fixture = mcpBridgeDemoFixture;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.03] p-8 shadow-2xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.3em] text-[#14F195]">
          Reddi Agent Protocol
        </p>
        <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              {fixture.title}
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-300">
              {fixture.subtitle}
            </p>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-[#14F195]/30 bg-[#14F195]/10 p-5 text-sm leading-6 text-[#DFFFEF]">
              <p className="font-semibold text-white">
                For existing agent systems
              </p>
              <p className="mt-2">
                Use this bridge pattern when your agent already plans work but
                needs a safe way to discover specialist metadata, request
                quotes, enforce spend policy, and retain receipt/disclosure
                evidence without treating payment as proof of work.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href="/planner"
                  className="rounded-lg bg-[#14F195] px-3 py-2 text-xs font-semibold text-black hover:bg-[#14F195]/90"
                >
                  Try planner path
                </a>
                <a
                  href="/economic-demo"
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:border-[#14F195]/40"
                >
                  Watch economic demo
                </a>
              </div>
            </div>
            <div className="rounded-2xl border border-yellow-400/30 bg-yellow-400/10 p-5 text-sm leading-6 text-yellow-100">
              <p className="font-semibold text-yellow-50">
                Permission boundary
              </p>
              <p className="mt-2">{fixture.permissionBoundary}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        {fixture.modes.map((mode) => (
          <article
            key={mode.id}
            className="rounded-2xl border border-white/10 bg-card/40 p-5"
          >
            <div className="flex min-h-20 items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {mode.label}
                </h2>
                <p className="mt-2 text-sm text-gray-400">
                  {mode.claimBoundary}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                {mode.spendBoundary}
              </span>
            </div>
            <div className="mt-5 space-y-3">
              {mode.checks.map((check) => (
                <div
                  key={check.id}
                  className={`rounded-xl border p-3 ${statusClass(check.status)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{check.label}</p>
                    <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] uppercase tracking-wide">
                      {check.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 opacity-90">
                    {check.detail}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-white/10 bg-card/40 p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#14F195]">
          Proof artifacts
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-white">
          Local-first evidence trail
        </h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {fixture.proofArtifacts.map((artifact) => (
            <article
              key={artifact.artifactPath}
              className="rounded-xl border border-white/10 bg-black/30 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    {artifact.label}
                  </h3>
                  <p className="mt-2 text-xs uppercase tracking-wide text-[#14F195]">
                    {artifact.result}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                  proof
                </span>
              </div>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-gray-400">Boundary</dt>
                  <dd className="mt-1 break-words font-mono text-gray-100">
                    {artifact.boundary}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Artifact</dt>
                  <dd className="mt-1 break-words font-mono text-gray-100">
                    {artifact.artifactPath}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-400">Tx signatures</dt>
                  <dd className="mt-1 space-y-1">
                    {artifact.txSignatures.map((signature) => (
                      <span
                        key={signature}
                        className="block truncate font-mono text-gray-100"
                      >
                        {signature}
                      </span>
                    ))}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-card/40 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent-purple">
            Quote preview
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            Synthetic, non-binding quote
          </h2>
          <dl className="mt-6 grid gap-4 text-sm">
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-gray-400">Quote authority</dt>
              <dd className="font-mono text-[#14F195]">
                {fixture.quote.quoteAuthority}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-gray-400">Binding</dt>
              <dd className="font-mono text-red-200">
                {String(fixture.quote.binding)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-gray-400">Specialist</dt>
              <dd className="text-right text-white">
                {fixture.quote.specialist.displayName}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-gray-400">Wallet</dt>
              <dd className="font-mono text-white">
                {shortWallet(fixture.quote.specialist.walletAddress)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
              <dt className="text-gray-400">Price</dt>
              <dd className="font-mono text-white">
                {fixture.quote.terms.amount} {fixture.quote.terms.currency}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-gray-400">Terms hash</dt>
              <dd className="max-w-72 truncate font-mono text-white">
                {fixture.quote.termsHash}
              </dd>
            </div>
          </dl>
        </article>

        <article className="rounded-2xl border border-white/10 bg-card/40 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#14F195]">
            Disclosure ledger
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            Safe public evidence
          </h2>
          <pre className="mt-6 max-h-[420px] overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 text-xs leading-5 text-gray-200">
            {JSON.stringify(fixture.disclosureLedger, null, 2)}
          </pre>
        </article>
      </section>

      <section className="mt-8 rounded-2xl border border-white/10 bg-card/40 p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
          Recording script
        </p>
        <ol className="mt-5 grid gap-3 md:grid-cols-5">
          {fixture.recordingScript.map((line, index) => (
            <li
              key={line}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-gray-300"
            >
              <span className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#14F195]/10 text-xs font-semibold text-[#14F195]">
                {index + 1}
              </span>
              <p>{line}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
