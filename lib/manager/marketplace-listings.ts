import { buildPayShProviderSpecPreview, type PayShProviderSpecPreview } from "@/lib/integrations/source-adapter/pay-sh-provider-spec-preview";
import { payShCatalogProviderToCandidate, type PayShCatalogProvider } from "@/lib/integrations/source-adapter/profiles/pay-sh";
import type { OperatorDiscoveryCandidateView } from "@/lib/manager/static-agent-stack-review";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

export type MarketplaceApprovalQueueState =
  | "draft"
  | "needs_changes"
  | "approve_ready"
  | "published_placeholder"
  | "unpublished"
  | "rejected"
  | "blocked"
  | "suspended";

export type MarketplacePublicationClaimState =
  | "unverified_external_metadata"
  | "blocked_evidence"
  | "hosted_attestation_pending"
  | "hosted_attestation_ready"
  | "quasar_pending"
  | "dry_run_activation_ready"
  | "published_dry_run"
  | "unpublished"
  | "suspended"
  | "live_unavailable";

export type MarketplacePublicationEvidenceView = {
  status: MarketplacePublicationClaimState;
  label: string;
  description: string;
  activationMode: "not_available" | "dry_run" | "blocked";
  offchainPreview: "available" | "pending" | "blocked" | "not_available";
  hostedAttestation: "ready" | "pending" | "blocked" | "not_available";
  quasar: "metadata_only" | "pending" | "not_backed" | "blocked";
  livePublication: "unavailable";
  buyerFacingClaimsAllowed: false;
  evidenceRefs: string[];
  blockedReasons: string[];
};

export type MarketplaceApprovalQueueItem = {
  id: string;
  state: MarketplaceApprovalQueueState;
  label: string;
  fixtureKey: string;
  candidate: OperatorDiscoveryCandidateView;
  listingPreview: {
    name: string;
    model: string;
    tagline: string;
    capabilities: string[];
    tools: string[];
    skills: string[];
    statusCopy: string;
    publicationCopy: string;
    paymentCopy: string;
    readinessCopy: string;
  };
  publicationEvidence: MarketplacePublicationEvidenceView;
};

export type PayShPreviewScenarioState =
  | "preview_ready"
  | "missing_pricing"
  | "invalid_endpoint"
  | "live_disabled"
  | "unsafe_metadata";

export type PayShPreviewScenarioView = {
  id: PayShPreviewScenarioState;
  label: string;
  providerFqn: string;
  status: PayShProviderSpecPreview["status"];
  summary: string;
  supportStates: {
    catalogVisible: "catalog_visible";
    providerSpecPreview: "ready" | "blocked";
    sandboxTested: "not_tested";
    dryRunReady: "ready" | "blocked";
    livePayment: "disabled";
  };
  previewBoundary: {
    submittedToPaySh: false;
    listedOnPaySh: false;
    sandboxTested: false;
    livePaymentEnabled: false;
  };
  disabledControls: {
    label: string;
    reason: string;
  }[];
  blockers: {
    code: string;
    detail: string;
  }[];
  evidenceRefs: string[];
  payMdAvailable: boolean;
  providerYamlAvailable: boolean;
};

export type MarketplaceApprovalQueueView = {
  items: MarketplaceApprovalQueueItem[];
  payShPreviewScenarios: PayShPreviewScenarioView[];
  boundaryLabels: string[];
  emptyState: {
    title: string;
    message: string;
  };
};

const boundaryLabels = [
  "imported metadata",
  "external source",
  "untrusted",
  "not RAP-attested",
  "not published",
  "static-only",
];

export function getMarketplaceApprovalQueue(): MarketplaceApprovalQueueView {
  const workspace = getStaticAgentStackReviewWorkspace();
  const byKey = Object.fromEntries(workspace.candidates.map((candidate) => [candidate.fixtureKey, candidate]));
  const approveReady = requireCandidate(byKey, "approveReadyDraft");
  const requestChanges = requireCandidate(byKey, "requestChangesMissingPayment");
  const rejected = requireCandidate(byKey, "rejectedMalformedConnector");
  const suspended = requireCandidate(byKey, "suspendedUnsafeMetadata");
  const blocked = requireCandidate(byKey, "solanaAiKitBlocked");

  return {
    boundaryLabels,
    payShPreviewScenarios: getPayShPreviewScenarios(),
    items: [
      buildQueueItem("draft", "Draft", approveReady, {
        statusCopy: "Draft listing generated from static fixture metadata.",
        publicationCopy: "Not published. Operator approval, readiness, and attestation gates are deferred.",
        paymentCopy: "Payment readiness is missing and cannot be activated here.",
        readinessCopy: "Publication readiness check is a disabled placeholder.",
        publicationEvidence: {
          status: "unverified_external_metadata",
          label: "Unverified external metadata",
          description: "Imported source metadata is visible for review but cannot claim trust, payment readiness, reputation, or publication.",
          activationMode: "not_available",
          offchainPreview: "not_available",
          hostedAttestation: "not_available",
          quasar: "pending",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: ["source:snapshot:approve-ready"],
          blockedReasons: ["Operator approval, receipt evidence, hosted attestation, and activation gates are not complete."],
        },
      }),
      buildQueueItem("needs_changes", "Needs changes", requestChanges, {
        statusCopy: "Needs changes before approval because payment and endpoint setup are incomplete.",
        publicationCopy: "Not published. Request-changes action is display-only.",
        paymentCopy: "Missing payment setup; activation remains disabled.",
        readinessCopy: "Readiness is blocked by fixture review items.",
        publicationEvidence: {
          status: "blocked_evidence",
          label: "Blocked evidence",
          description: "Payment setup and endpoint binding evidence are incomplete, so publication remains blocked.",
          activationMode: "blocked",
          offchainPreview: "blocked",
          hostedAttestation: "pending",
          quasar: "pending",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: ["review:missing-payment", "review:missing-endpoint"],
          blockedReasons: ["Payment proof missing.", "Endpoint binding missing.", "Hosted attestation not ready."],
        },
      }),
      buildQueueItem("approve_ready", "Approved / approve-ready placeholder", approveReady, {
        statusCopy: "Approve-ready fixture state only. Approval is not written anywhere.",
        publicationCopy: "Not published. Approve and publish are disabled placeholders.",
        paymentCopy: "Payment readiness remains separate from this static preview.",
        readinessCopy: "Publication readiness will be evaluated by a later gate.",
        publicationEvidence: {
          status: "hosted_attestation_pending",
          label: "Hosted attestation pending",
          description: "The listing has safe review evidence, but hosted-attestation and activation evidence must still be attached before publication can be represented.",
          activationMode: "blocked",
          offchainPreview: "pending",
          hostedAttestation: "pending",
          quasar: "metadata_only",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: ["readiness-proof:approve-ready"],
          blockedReasons: ["Hosted attestation claim missing.", "Activation approval missing."],
        },
      }),
      buildQueueItem("published_placeholder", "Published placeholder", approveReady, {
        statusCopy: "Published state is represented as dry-run activation evidence for operator review.",
        publicationCopy: "Dry-run publication activation is ready; live publication remains unavailable.",
        paymentCopy: "No live payment activation, wallet signing, or settlement setup occurs.",
        readinessCopy: "Publication eligibility, lifecycle audit, and activation evidence are fixture-backed.",
        publicationEvidence: {
          status: "published_dry_run",
          label: "Published / dry-run activation",
          description: "This state consumes the public export item and dry-run activation decision. It does not publish to a hosted registry.",
          activationMode: "dry_run",
          offchainPreview: "available",
          hostedAttestation: "ready",
          quasar: "metadata_only",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: [
            "evidence:operator-action:publish",
            "evidence:activation:approve-ready",
            "publication-gate:approve-ready",
            "quasar-compatibility:metadata-only",
          ],
          blockedReasons: [],
        },
      }),
      buildQueueItem("unpublished", "Unpublished", approveReady, {
        statusCopy: "Unpublished lifecycle state after public visibility was forced off.",
        publicationCopy: "Not public. Older publish evidence is ignored after unpublish.",
        paymentCopy: "Payment activation remains disabled.",
        readinessCopy: "Current lifecycle audit blocks public export and activation.",
        publicationEvidence: {
          status: "unpublished",
          label: "Unpublished",
          description: "The latest lifecycle audit removes public visibility, so activation and export are blocked even if older publish evidence exists.",
          activationMode: "blocked",
          offchainPreview: "available",
          hostedAttestation: "ready",
          quasar: "metadata_only",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: ["evidence:operator-action:unpublish"],
          blockedReasons: ["Latest lifecycle audit is unpublish.", "Public visibility is false."],
        },
      }),
      buildQueueItem("rejected", "Rejected", rejected, {
        statusCopy: "Rejected fixture state with malformed connector evidence.",
        publicationCopy: "Not published. Rejection is already fixture metadata, not a live mutation.",
        paymentCopy: "Payment remains inactive for rejected imported metadata.",
        readinessCopy: "Publication readiness remains unavailable.",
        publicationEvidence: {
          status: "blocked_evidence",
          label: "Blocked evidence",
          description: "Malformed connector evidence prevents publication claims.",
          activationMode: "blocked",
          offchainPreview: "blocked",
          hostedAttestation: "blocked",
          quasar: "blocked",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: ["review:malformed-connector"],
          blockedReasons: ["Malformed connector metadata.", "Operator rejected this import."],
        },
      }),
      buildQueueItem("blocked", "Blocked", blocked, {
        statusCopy: "Blocked by static risk diagnostics and operator guardrails.",
        publicationCopy: "Not published. Blockers must be cleared outside this read-only UI.",
        paymentCopy: "Payment activation is disabled while blockers remain.",
        readinessCopy: "Readiness cannot pass while static risk blockers are present.",
        publicationEvidence: {
          status: "quasar_pending",
          label: "Quasar compatibility pending",
          description: "Quasar-backed claims are not enabled from static metadata; the #394 attestation/reputation bridge can label fixture-only intent states, but this listing's static risk blockers leave no eligible intent evidence.",
          activationMode: "blocked",
          offchainPreview: "blocked",
          hostedAttestation: "blocked",
          quasar: "pending",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: ["quasar-compatibility:pending", "review:static-risk-blocker"],
          blockedReasons: ["Quasar-backed claim unavailable.", "Static risk blockers remain."],
        },
      }),
      buildQueueItem("suspended", "Suspended", suspended, {
        statusCopy: "Suspended imported listing fixture with unsafe metadata warnings.",
        publicationCopy: "Not published. Suspend/unpublish controls are non-live placeholders.",
        paymentCopy: "Payment readiness is disabled for suspended metadata.",
        readinessCopy: "Publication readiness is unavailable for suspended metadata.",
        publicationEvidence: {
          status: "suspended",
          label: "Suspended",
          description: "Suspension forces public visibility off and blocks activation until current readiness evidence restores publication.",
          activationMode: "blocked",
          offchainPreview: "blocked",
          hostedAttestation: "blocked",
          quasar: "pending",
          livePublication: "unavailable",
          buyerFacingClaimsAllowed: false,
          evidenceRefs: ["evidence:operator-action:suspend"],
          blockedReasons: ["Latest lifecycle audit is suspend.", "Public visibility is false."],
        },
      }),
    ],
    emptyState: {
      title: "No imported listing states are available",
      message:
        "The approval queue is built from package-owned static fixture states and never fetches repositories, contacts MCP servers, activates payments, or publishes listings.",
    },
  };
}

function getPayShPreviewScenarios(): PayShPreviewScenarioView[] {
  const baseProvider: PayShCatalogProvider = {
    fqn: "reddi/market-intel/stablecoin-feed",
    title: "Stablecoin Feed",
    description: "Reviewed market data feed for Pay.sh provider preview.",
    category: "finance",
    service_url: "https://stablecoin-feed.example.com",
    docs_url: "https://stablecoin-feed.example.com/docs",
    endpoint_count: 3,
    has_metering: true,
    has_free_tier: false,
    min_price_usd: 0.01,
    max_price_usd: 0.05,
    payment_rails: ["x402"],
    networks: ["solana"],
    sha: "pay-sh-source-hash-stablecoin-feed",
  };

  return [
    payShScenario("preview_ready", "Pay.sh-compatible preview", baseProvider, {
      summary: "PAY.md and provider YAML preview are available, but nothing has been submitted or paid.",
    }),
    payShScenario("missing_pricing", "Missing pricing", {
      ...baseProvider,
      fqn: "reddi/market-intel/missing-pricing",
      title: "Missing Pricing Feed",
      min_price_usd: undefined,
      max_price_usd: undefined,
      has_free_tier: undefined,
    }, {
      summary: "Pricing metadata is absent, so the provider spec preview is blocked.",
    }),
    payShScenario("invalid_endpoint", "Invalid endpoint", {
      ...baseProvider,
      fqn: "reddi/market-intel/invalid-endpoint",
      title: "Invalid Endpoint Feed",
      service_url: "http://stablecoin-feed.example.com",
      endpoint_count: 0,
    }, {
      summary: "The provider URL or endpoint count is invalid, so Pay.sh submission and paid calls remain disabled.",
    }),
    payShScenario("live_disabled", "Live payment disabled", baseProvider, {
      summary: "Preview is ready for review, but live Pay.sh payment stays disabled until a later approval/spend-policy issue.",
    }),
    payShScenario("unsafe_metadata", "Blocked unsafe metadata", {
      ...baseProvider,
      fqn: "reddi/market-intel/credential-tools",
      title: "Credential Tools Feed",
      category: "credential_tools",
    }, {
      summary: "Unsafe category metadata blocks preview use for marketplace submission.",
    }),
  ];
}

function payShScenario(
  id: PayShPreviewScenarioState,
  label: string,
  provider: PayShCatalogProvider,
  copy: { summary: string },
): PayShPreviewScenarioView {
  const candidate = payShCatalogProviderToCandidate(provider);
  const preview = buildPayShProviderSpecPreview({
    candidate,
    listing: {
      name: "stablecoin-feed",
      subdomain: "stablecoin-feed",
      title: provider.title,
      description: provider.description,
      version: "1.0.0",
      operatorNotes: ["Operator reviewed Pay.sh provider metadata."],
    },
    operatorApproval: {
      approved: true,
      evidenceRef: "evidence:operator-approval:pay-sh-preview",
    },
    publication: {
      status: "eligible",
      evidenceRef: "evidence:publication:eligible",
    },
  });
  const ready = preview.status === "preview_ready";

  return {
    id,
    label,
    providerFqn: candidate.providerFqn,
    status: preview.status,
    summary: copy.summary,
    supportStates: {
      catalogVisible: "catalog_visible",
      providerSpecPreview: ready ? "ready" : "blocked",
      sandboxTested: "not_tested",
      dryRunReady: ready ? "ready" : "blocked",
      livePayment: "disabled",
    },
    previewBoundary: preview.boundaries,
    disabledControls: [
      {
        label: "Submit to Pay.sh",
        reason: ready ? "Provider preview is review-only and has not been submitted to Pay.sh." : "Provider preview blockers must clear first.",
      },
      {
        label: "Paid call",
        reason: "Paid calls are unavailable; this UI never invokes Pay.sh providers.",
      },
      {
        label: "Wallet/RPC",
        reason: "Wallet signing, top-up, and Solana RPC probes are out of scope for this read-only UI.",
      },
      {
        label: "Live activation",
        reason: "Live Pay.sh activation is disabled until a later spend-policy and operator-approval issue.",
      },
    ],
    blockers: preview.blockers.map((blocker) => ({
      code: blocker.diagnosticCode ?? blocker.code,
      detail: blocker.detail,
    })),
    evidenceRefs: [
      candidate.sourceMetadata.sourceHash ? `source:${candidate.sourceMetadata.sourceHash}` : "source:hash-missing",
      "evidence:operator-approval:pay-sh-preview",
      "evidence:publication:eligible",
    ],
    payMdAvailable: Boolean(preview.payMd),
    providerYamlAvailable: Boolean(preview.providerYaml),
  };
}

function requireCandidate(
  byKey: Record<string, OperatorDiscoveryCandidateView>,
  fixtureKey: string,
): OperatorDiscoveryCandidateView {
  const candidate = byKey[fixtureKey];
  if (!candidate) throw new Error(`missing marketplace approval fixture candidate: ${fixtureKey}`);
  return candidate;
}

function buildQueueItem(
  state: MarketplaceApprovalQueueState,
  label: string,
  candidate: OperatorDiscoveryCandidateView,
  copy: Pick<MarketplaceApprovalQueueItem["listingPreview"], "statusCopy" | "publicationCopy" | "paymentCopy" | "readinessCopy"> & {
    publicationEvidence: MarketplacePublicationEvidenceView;
  },
): MarketplaceApprovalQueueItem {
  const buyerPreview = candidate.draftPreview.buyerPreview;
  const { publicationEvidence, ...listingCopy } = copy;
  const capabilityValues = Object.values(buyerPreview)
    .flatMap((value) => value.split(/[,;]/))
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    id: `${state}:${candidate.fixtureKey}`,
    state,
    label,
    fixtureKey: candidate.fixtureKey,
    candidate,
    listingPreview: {
      name: buyerPreview.displayName ?? candidate.title,
      model: buyerPreview.model ?? candidate.sourceKindSummary,
      tagline: buyerPreview.summary ?? candidate.description,
      capabilities: capabilityValues.slice(0, 5),
      tools: candidate.groups.flatMap((group) => group.capabilityRefs).slice(0, 4),
      skills: candidate.requiredGroupKinds.slice(0, 4),
      ...listingCopy,
    },
    publicationEvidence,
  };
}
