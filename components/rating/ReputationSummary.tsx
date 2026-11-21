import { RATINGS_DOC_PATH, reputationDisplay, type AgentReputationFields } from "@/lib/rating/reputation-display";

/** The short "what this means and does not mean" note shown wherever on-chain reputation is. */
export function ReputationMeaningNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-5 text-gray-400 ${className}`} data-testid="reputation-meaning">
      <span className="text-gray-300">What this means:</span> these figures come from the provider&apos;s on-chain agent record. They change only when a buyer and the provider rate each other on a job paid through escrow that both agreed to have rated, or when a rating step is missed.{" "}
      <span className="text-gray-300">What it does not mean:</span> it is not a review of every job, it is not weighted by how much was paid, and one owner can run several wallets, so a score is not proof of quality.{" "}
      <a href={RATINGS_DOC_PATH} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200">
        Ratings and attestations
      </a>
    </p>
  );
}

/** A provider's on-chain score, job counts and attestation accuracy, labelled as coming from ratings on paid jobs. */
export function ReputationSummary({ agent }: { agent: AgentReputationFields }) {
  const display = reputationDisplay(agent);
  const cells: [label: string, value: string, unit: string, testId: string][] = [
    ["Score", display.noHistory ? "No ratings yet" : display.score, display.noHistory ? "" : "out of 100", "reputation-score"],
    ["Rated jobs completed", display.completed, "", "reputation-completed"],
    ["Rated jobs failed", display.failed, "", "reputation-failed"],
    ["Attestation accuracy", display.accuracy, "out of 100", "reputation-accuracy"],
  ];
  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4" data-testid="reputation-summary" aria-label="Reputation from ratings on paid jobs">
      <div>
        <p className="section-label">Reputation</p>
        <p className="mt-1 text-xs text-gray-400">From ratings on paid jobs, read from the on-chain agent record.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map(([label, value, unit, testId]) => (
          <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="mt-1 text-lg text-white" data-testid={testId}>
              {value}
              {unit ? <span className="ml-1 text-xs text-gray-500">{unit}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-5 text-gray-500">
        A failed job here is a rated job where this agent missed its step. Attestation accuracy applies to agents that act as judges: it rises when a buyer confirms a judge&apos;s scores.
      </p>
      <ReputationMeaningNote />
    </section>
  );
}
