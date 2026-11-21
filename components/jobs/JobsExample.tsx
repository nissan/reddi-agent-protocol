/**
 * What My jobs looks like once a wallet has paid calls, shown before anyone
 * signs in. Every value is made up and the block says so; nothing here is
 * read from the database or the chain.
 */

const STATS = [
  { label: "Spent this week", value: "0.42 USDC", note: "0.65 AUDD · 0.0028 SOL" },
  { label: "Calls", value: "38", note: "each with a receipt" },
  { label: "Returned to you", value: "0.31 USDC", note: "unused maximum, refunded" },
  { label: "Waiting for your rating", value: "2", note: "optional, per job" },
];

const ROWS = [
  {
    provider: "Atlas Review",
    model: "atlas-coder-large",
    tokens: "12,000 / 1,500",
    cost: "0.0975 / 0.1950 USDC",
    receipt: { text: "✓ Signature checked", tone: "ok" as const },
    rating: "Waiting for your rating",
  },
  {
    provider: "Quill Summaries",
    model: "quill-small",
    tokens: "4,200 / 600",
    cost: "0.0031 / 0.0080 AUDD",
    receipt: { text: "✓ Signature checked", tone: "ok" as const },
    rating: "Rated 4 of 5",
  },
  {
    provider: "Plain Model",
    model: "at-cost-7b",
    tokens: "900 / 300",
    cost: "0.0000021 / 0.0000050 SOL",
    receipt: { text: "Waiting for provider", tone: "wait" as const },
    rating: "After it settles",
  },
];

function ExampleTag() {
  return (
    <span className="ml-2 inline-block border-[1.5px] border-brand-violet px-2 py-0.5 align-middle font-mono text-[11px] font-bold tracking-[0.08em] text-brand-violet">
      EXAMPLE
    </span>
  );
}

export function JobsExample() {
  return (
    <section aria-labelledby="jobs-example-heading" className="space-y-6" data-testid="jobs-example">
      <div>
        <h2 id="jobs-example-heading" className="text-2xl">
          What this page shows once you have jobs
          <ExampleTag />
        </h2>
        <p className="mt-2 text-[15px] text-ink-muted">
          Made-up providers and values, so you can see the layout before your first call.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="min-w-0 rounded-md border border-line bg-paper-raised p-4 sm:p-5">
            <dt className="text-sm text-ink-muted">{stat.label}</dt>
            <dd className="m-0">
              <strong className="mt-1.5 block text-2xl tracking-tight text-ink sm:text-3xl">{stat.value}</strong>
              <span className="text-[13px] text-ink-muted">{stat.note}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto rounded-md border border-line bg-paper-raised">
        <table className="w-full min-w-[720px] border-collapse text-[15px]">
          <caption className="px-5 py-4 text-left text-lg font-extrabold tracking-tight text-ink">
            Recent jobs
            <ExampleTag />
          </caption>
          <thead>
            <tr className="border-y border-line text-left text-[13px] text-ink-muted">
              <th scope="col" className="px-5 py-2.5 font-semibold">Provider</th>
              <th scope="col" className="px-5 py-2.5 font-semibold">Tokens in / out</th>
              <th scope="col" className="px-5 py-2.5 font-semibold">Cost / max</th>
              <th scope="col" className="px-5 py-2.5 font-semibold">Receipt</th>
              <th scope="col" className="px-5 py-2.5 font-semibold">Rating</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, index) => (
              <tr key={row.provider} className={index < ROWS.length - 1 ? "border-b border-dotted border-line" : ""}>
                <td className="px-5 py-3.5">
                  <strong className="text-ink">{row.provider}</strong>
                  <span className="block text-[13px] text-ink-muted">{row.model}</span>
                </td>
                <td className="px-5 py-3.5 font-mono text-[13px]">{row.tokens}</td>
                <td className="px-5 py-3.5 font-mono text-[13px]">{row.cost}</td>
                <td
                  className={`px-5 py-3.5 font-bold ${
                    row.receipt.tone === "ok" ? "text-brand-green" : "text-amber-300"
                  }`}
                >
                  {row.receipt.text}
                </td>
                <td className="px-5 py-3.5 text-ink-muted">{row.rating}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-muted">Examples only. Today this runs on Solana devnet with test funds; mainnet is coming soon.</p>
    </section>
  );
}
