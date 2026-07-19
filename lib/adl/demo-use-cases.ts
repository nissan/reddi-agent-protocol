export type AdlPaymentStepState =
  | "complete"
  | "pending"
  | "blocked"
  | "mocked";

export interface AdlPaymentStep {
  id: string;
  label: string;
  state: AdlPaymentStepState;
  detail: string;
  evidence: string;
}

export interface AdlUseCase {
  id: string;
  title: string;
  buyerAgent: string;
  sellerAgent: string;
  attestorAgent: string;
  adlRef: string;
  paymentRail: string;
  price: string;
  summary: string;
  mockRequest: string;
  mockResponse: string;
  steps: AdlPaymentStep[];
  adlHighlights: string[];
}

export const adlUseCases: AdlUseCase[] = [
  {
    id: "research-brief",
    title: "Research agent buys a specialist brief",
    buyerAgent: "OpenClaw research coordinator",
    sellerAgent: "Market research specialist",
    attestorAgent: "Evidence review attestor",
    adlRef: "harness.tools + payment.intent + evalGates",
    paymentRail: "x402 over USDC devnet semantics",
    price: "0.025 USDC",
    summary:
      "A coordinating agent discovers a research specialist, receives a price challenge, pays under a budget policy, and routes the answer through evidence review before reputation changes.",
    mockRequest:
      "Produce a sourced market brief for agent-to-agent payments in developer tools.",
    mockResponse:
      "Brief accepted. Three cited findings, risk notes, and receipt refs returned for attestation.",
    adlHighlights: [
      "ADL declares approved web/data sources before the buyer can ask for paid research.",
      "The payment intent caps spend and requires a receipt before completion.",
      "Eval gates require source coverage and receipt linkage before reputation updates.",
    ],
    steps: [
      {
        id: "discover",
        label: "Discover specialist",
        state: "complete",
        detail:
          "Buyer reads ADL capability metadata and selects a research specialist with a matching source policy.",
        evidence: "adl.capabilities.research.market_brief",
      },
      {
        id: "challenge",
        label: "Quote challenge",
        state: "complete",
        detail:
          "Seller returns an x402-style quote with amount, asset, network, and receipt requirements.",
        evidence: "receipt.challenge.research-brief.001",
      },
      {
        id: "approval",
        label: "Policy approval",
        state: "complete",
        detail:
          "Buyer ADL policy accepts the spend because it is below task cap and source-bound.",
        evidence: "policy.maxUsdPerTask <= 0.05",
      },
      {
        id: "receipt",
        label: "Payment receipt",
        state: "mocked",
        detail:
          "Mock mode packages a deterministic receipt. Live mode expects the supplied endpoint to return one.",
        evidence: "mock.receipt.research-brief",
      },
      {
        id: "attest",
        label: "Attest output",
        state: "complete",
        detail:
          "Attestor checks source coverage, result shape, and receipt chain before marking work reusable.",
        evidence: "evalGate.sourceCoverage.pass",
      },
    ],
  },
  {
    id: "code-review",
    title: "Builder agent hires a code review specialist",
    buyerAgent: "ADL builder assistant",
    sellerAgent: "Security/code review specialist",
    attestorAgent: "Release gate attestor",
    adlRef: "harness.policies + evalGates + receipts",
    paymentRail: "RAP receipt-bound payment plan",
    price: "0.04 USDC",
    summary:
      "A builder agent turns an ADL export into a review request, pays a specialist only after quote approval, and blocks release until review evidence is attached.",
    mockRequest:
      "Review the generated local runner package for unsafe command execution and receipt leakage.",
    mockResponse:
      "Review complete. One unsafe command pattern blocked, two tests required, release gate remains hold until patched.",
    adlHighlights: [
      "ADL policies describe forbidden command classes and credential boundaries.",
      "Receipts bind review cost to a specific source artifact hash.",
      "Release eval gates consume the review verdict rather than trusting seller self-claims.",
    ],
    steps: [
      {
        id: "scope",
        label: "Bind artifact scope",
        state: "complete",
        detail:
          "Buyer passes a pinned ADL artifact hash so the seller cannot review a different package.",
        evidence: "source.sha256.builder-runner",
      },
      {
        id: "challenge",
        label: "Review quote",
        state: "complete",
        detail:
          "Seller quotes review cost and declares no live runtime, no secrets, and no mainnet scope.",
        evidence: "x402.challenge.code-review",
      },
      {
        id: "approve",
        label: "Budget gate",
        state: "complete",
        detail:
          "The buyer policy allows one paid review under the task budget and blocks follow-up spend.",
        evidence: "payment.intent.single_call",
      },
      {
        id: "work",
        label: "Receipt-bound result",
        state: "mocked",
        detail:
          "Mock mode returns a review packet. Live mode POSTs the same structured request to the user endpoint.",
        evidence: "mock.review.packet",
      },
      {
        id: "release",
        label: "Release decision",
        state: "blocked",
        detail:
          "Release remains blocked until required tests and attestation evidence are present.",
        evidence: "evalGate.release.hold",
      },
    ],
  },
  {
    id: "commerce-dispute",
    title: "Commerce agent pays an attestor for dispute evidence",
    buyerAgent: "Marketplace settlement coordinator",
    sellerAgent: "Order evidence specialist",
    attestorAgent: "Payment dispute attestor",
    adlRef: "payment.reputation + recovery + observability",
    paymentRail: "RAP x402 receipt and reputation preview",
    price: "0.015 USDC",
    summary:
      "A settlement coordinator asks a specialist agent for order evidence, pays for the evidence bundle, then lets an attestor decide whether reputation can change.",
    mockRequest:
      "Collect delivery, invoice, and refund-policy evidence for order AGT-204 before settlement.",
    mockResponse:
      "Evidence bundle ready. Refund policy conflicts with seller claim; reputation mutation remains disabled pending human review.",
    adlHighlights: [
      "ADL observability fields require trace events for quote, payment, work, and attestation.",
      "Recovery fields define refund/rollback evidence before any reputation mutation.",
      "Reputation signals are previewed until the attestor signs the receipt chain.",
    ],
    steps: [
      {
        id: "discover",
        label: "Find evidence agent",
        state: "complete",
        detail:
          "Coordinator selects a seller that declares order evidence capability and refund policy awareness.",
        evidence: "capability.order_evidence",
      },
      {
        id: "quote",
        label: "Quote evidence bundle",
        state: "complete",
        detail:
          "Seller issues a small x402 quote tied to one order id and a maximum evidence window.",
        evidence: "quote.order.AGT-204",
      },
      {
        id: "pay",
        label: "Receipt capture",
        state: "mocked",
        detail:
          "Mock receipt proves ordering. Live mode expects the supplied endpoint to return receipt metadata.",
        evidence: "receipt.order-evidence.mock",
      },
      {
        id: "verify",
        label: "Dispute attestation",
        state: "complete",
        detail:
          "Attestor checks invoice, policy, and delivery evidence before deciding if settlement can continue.",
        evidence: "attestation.dispute.reviewed",
      },
      {
        id: "reputation",
        label: "Reputation preview",
        state: "blocked",
        detail:
          "Reputation stays preview-only because the scenario identifies a policy conflict.",
        evidence: "reputation.preview.no_mutation",
      },
    ],
  },
];

export function getAdlUseCase(id: string) {
  return adlUseCases.find((useCase) => useCase.id === id) ?? adlUseCases[0];
}

export function buildAdlLivePayload(useCase: AdlUseCase, agentApiAddress: string) {
  return {
    schemaVersion: "reddi.adl.demo-request.v1",
    mode: "live-user-endpoint",
    agentApiAddress,
    useCaseId: useCase.id,
    buyerAgent: useCase.buyerAgent,
    sellerAgent: useCase.sellerAgent,
    attestorAgent: useCase.attestorAgent,
    request: useCase.mockRequest,
    expectedPaymentFlow: useCase.steps.map((step) => ({
      id: step.id,
      label: step.label,
      evidence: step.evidence,
    })),
    guardrails: {
      noMainnet: true,
      noStoredSecrets: true,
      userSuppliedEndpointOnly: true,
      mockModeDefault: true,
    },
  };
}
