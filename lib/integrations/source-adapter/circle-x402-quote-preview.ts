import {
  loadCircleX402Candidate,
  type CircleX402Catalog,
} from "@/lib/integrations/source-adapter/circle-x402-catalog";
import type { ReddiCircleX402Candidate } from "@/lib/integrations/source-adapter/profiles/circle-x402";

export type CircleX402QuotePreview = {
  ok: boolean;
  mode: "dry-run-quote-preview";
  candidate: ReddiCircleX402Candidate | null;
  task: string;
  routePreview: {
    requestedSource: "circle-x402";
    candidateSource: "circle-x402";
    strictSourceMatch: true;
    routeState: "external_unattested_candidate";
    plannerPolicy: {
      preferredSource: "circle-x402";
      strictSourceMatch: true;
      requireAttestationBeforeTrust: true;
      livePaymentAllowed: false;
    };
  } | null;
  quotePreview: {
    currency: "USDC";
    network: string;
    rail: "circle_gateway" | "vanilla_x402";
    maxAmountRequired?: string;
    estimatedUsd?: number;
    payTo?: string;
  } | null;
  paymentSupport: {
    supportStates: ReddiCircleX402Candidate["supportStates"];
    diagnostics: ReddiCircleX402Candidate["diagnostics"];
    livePaymentAllowed: false;
    trustUpgradeAllowed: false;
    reputationMutationAllowed: false;
    publicationReady: false;
  } | null;
  requiredGates: string[];
  trustNotes: string[];
  error?: string;
};

function lowestPricedPayment(candidate: ReddiCircleX402Candidate) {
  const priced = candidate.payment
    .filter((payment) => typeof payment.priceUsdc === "number")
    .sort((a, b) => (a.priceUsdc ?? Number.POSITIVE_INFINITY) - (b.priceUsdc ?? Number.POSITIVE_INFINITY));
  return priced[0] ?? candidate.payment[0] ?? null;
}

export function buildCircleX402QuotePreview(input: {
  candidateId: string;
  task?: string;
}): CircleX402QuotePreview {
  const candidateResult = loadCircleX402Candidate(input.candidateId);
  const task = input.task?.trim() || "Preview external x402 specialist route";

  if (!candidateResult.ok || !candidateResult.candidate) {
    return {
      ok: false,
      mode: "dry-run-quote-preview",
      candidate: null,
      task,
      routePreview: null,
      quotePreview: null,
      paymentSupport: null,
      requiredGates: [],
      trustNotes: [],
      error: candidateResult.error ?? `Circle x402 candidate not found: ${input.candidateId}`,
    };
  }

  const candidate = candidateResult.candidate;
  const payment = lowestPricedPayment(candidate);

  return {
    ok: true,
    mode: "dry-run-quote-preview",
    candidate,
    task,
    routePreview: {
      requestedSource: "circle-x402",
      candidateSource: "circle-x402",
      strictSourceMatch: true,
      routeState: "external_unattested_candidate",
      plannerPolicy: {
        preferredSource: "circle-x402",
        strictSourceMatch: true,
        requireAttestationBeforeTrust: true,
        livePaymentAllowed: false,
      },
    },
    quotePreview: payment
      ? {
          currency: "USDC",
          network: payment.network,
          rail: payment.rail,
          maxAmountRequired: payment.maxAmountRequired,
          estimatedUsd: payment.priceUsdc,
          payTo: payment.payTo,
        }
      : null,
    paymentSupport: {
      supportStates: candidate.supportStates,
      diagnostics: candidate.diagnostics,
      livePaymentAllowed: false,
      trustUpgradeAllowed: false,
      reputationMutationAllowed: false,
      publicationReady: false,
    },
    requiredGates: [
      "User explicitly approves live x402 payment experiment.",
      "Tiny spend cap is configured before payment.",
      "Circle wallet/session/payment credentials are present only at runtime.",
      "Receipt is captured and attached to a RAP evidence pack.",
      "RAP attestor verifies output, receipt, and disclosure before trust/reputation credit.",
    ],
    trustNotes: [
      ...candidate.trustNotes,
      "Preview only: no x402 payment header is created and no external endpoint is invoked.",
    ],
  };
}

export type CircleX402CandidateLookup = Pick<CircleX402Catalog, "ok" | "sourcePath" | "error"> & {
  candidate: ReddiCircleX402Candidate | null;
};
