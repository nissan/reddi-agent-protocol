/**
 * How an on-chain agent record's reputation fields are shown (#842).
 *
 * The program stores the score and the attestation accuracy as 0..10000 and
 * speaks of them in points with two decimals (a missed rating step costs
 * 5.00): shown here as 0.00 to 100.00. They change only through ratings and
 * attestations of jobs paid through escrow.
 */

/** Where the plain-language explanation of ratings and attestations lives in the repository. */
export const RATINGS_DOC_PATH = "https://github.com/nissan/reddi-agent-protocol/blob/main/docs/RATINGS-AND-ATTESTATIONS.md";

export interface AgentReputationFields {
  reputationScore: number;
  jobsCompleted: bigint | number | string;
  jobsFailed: bigint | number | string;
  attestationAccuracy: number;
}

export interface ReputationDisplay {
  /** "72.50", out of 100. */
  score: string;
  completed: string;
  failed: string;
  /** "10.00", out of 100. Meaningful for agents that act as judges. */
  accuracy: string;
  /** No rated job has been recorded for this agent. The score of such a record says nothing yet. */
  noHistory: boolean;
}

function points(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.trunc(value))) : 0;
  return (safe / 100).toFixed(2);
}

function count(value: bigint | number | string): bigint {
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

export function reputationDisplay(agent: AgentReputationFields): ReputationDisplay {
  const completed = count(agent.jobsCompleted);
  const failed = count(agent.jobsFailed);
  return {
    score: points(agent.reputationScore),
    completed: completed.toString(),
    failed: failed.toString(),
    accuracy: points(agent.attestationAccuracy),
    noHistory: completed === 0n && failed === 0n,
  };
}
