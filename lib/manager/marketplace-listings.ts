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

export type MarketplaceApprovalQueueView = {
  items: MarketplaceApprovalQueueItem[];
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
          description: "Quasar-backed claims are not enabled from static metadata; #443 must provide fixture-only intent before UI can show backed state.",
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
