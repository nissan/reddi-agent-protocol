import "server-only";

import { listSpecialistIndex, type SpecialistIndexEntry } from "@/lib/onboarding/specialist-index";

export type PlannerPolicyInput = {
  requiredPrivacyMode?: "public" | "per" | "vanish";
  requiresAttested?: boolean;
  requiresHealthPass?: boolean;
  maxPerCallUsd?: number;
  preferredWallet?: string;
};

export type PlannerCandidate = {
  walletAddress: string;
  endpointUrl?: string;
  score: number;
  reasons: string[];
  perCallUsd?: number;
  attested?: boolean;
  healthcheckStatus?: "pending" | "pass" | "fail";
};

function candidateScore(entry: SpecialistIndexEntry, policy: PlannerPolicyInput) {
  const reasons: string[] = [];
  let score = 0;

  const perCallUsd = entry.capabilities.pricing.perCallUsd;

  if (policy.requiredPrivacyMode) {
    if (entry.capabilities.privacyModes.includes(policy.requiredPrivacyMode)) {
      score += 30;
      reasons.push(`supports ${policy.requiredPrivacyMode} privacy mode`);
    } else {
      return { rejected: true as const, reasons: [`missing required privacy mode: ${policy.requiredPrivacyMode}`] };
    }
  }

  if (policy.requiresAttested) {
    if (entry.attested) {
      score += 20;
      reasons.push("attested specialist");
    } else {
      return { rejected: true as const, reasons: ["attestation required"] };
    }
  }

  if (policy.requiresHealthPass) {
    if (entry.healthcheckStatus === "pass") {
      score += 20;
      reasons.push("healthcheck pass");
    } else {
      return { rejected: true as const, reasons: ["healthcheck pass required"] };
    }
  }

  if (policy.maxPerCallUsd !== undefined) {
    if (perCallUsd === undefined) {
      return { rejected: true as const, reasons: ["per-call price missing"] };
    }
    if (perCallUsd > policy.maxPerCallUsd) {
      return {
        rejected: true as const,
        reasons: [`per-call price ${perCallUsd} exceeds max ${policy.maxPerCallUsd}`],
      };
    }
    const costBonus = Math.max(0, 20 - perCallUsd);
    score += costBonus;
    reasons.push(`price within budget (${perCallUsd} USD)`);
  }

  score += entry.capabilities.taskTypes.length;
  reasons.push(`${entry.capabilities.taskTypes.length} task types`);

  return {
    rejected: false as const,
    score,
    reasons,
    perCallUsd,
  };
}

/**
 * Picks a specialist for a policy. `entries` is the listing index to choose
 * from; when omitted the file index is read, which is the local development path.
 */
export function routePlannerPolicy(policy: PlannerPolicyInput, entries?: SpecialistIndexEntry[]) {
  const results = entries ?? listSpecialistIndex().results;

  const accepted: PlannerCandidate[] = [];
  const rejected: Array<{ walletAddress: string; reasons: string[] }> = [];

  for (const entry of results) {
    const scored = candidateScore(entry, policy);
    if (scored.rejected) {
      rejected.push({ walletAddress: entry.walletAddress, reasons: scored.reasons });
      continue;
    }

    accepted.push({
      walletAddress: entry.walletAddress,
      endpointUrl: entry.endpointUrl,
      score: scored.score,
      reasons: scored.reasons,
      perCallUsd: scored.perCallUsd,
      attested: entry.attested,
      healthcheckStatus: entry.healthcheckStatus,
    });
  }

  accepted.sort((a, b) => {
    if (policy.preferredWallet) {
      if (a.walletAddress === policy.preferredWallet && b.walletAddress !== policy.preferredWallet) return -1;
      if (b.walletAddress === policy.preferredWallet && a.walletAddress !== policy.preferredWallet) return 1;
    }
    return b.score - a.score;
  });

  return {
    ok: true,
    policy,
    selected: accepted[0] || null,
    candidates: accepted,
    rejected,
    note: accepted[0]
      ? "Deterministic planner stub selected top-scoring specialist."
      : "No specialist satisfies current policy.",
  };
}
