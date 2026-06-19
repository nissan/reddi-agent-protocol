import type { OperatorDiscoveryCandidateView } from "@/lib/manager/static-agent-stack-review";
import { getStaticAgentStackReviewWorkspace } from "@/lib/manager/static-agent-stack-review";

export type MarketplaceApprovalQueueState =
  | "draft"
  | "needs_changes"
  | "approve_ready"
  | "published_placeholder"
  | "rejected"
  | "blocked"
  | "suspended";

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
      }),
      buildQueueItem("needs_changes", "Needs changes", requestChanges, {
        statusCopy: "Needs changes before approval because payment and endpoint setup are incomplete.",
        publicationCopy: "Not published. Request-changes action is display-only.",
        paymentCopy: "Missing payment setup; activation remains disabled.",
        readinessCopy: "Readiness is blocked by fixture review items.",
      }),
      buildQueueItem("approve_ready", "Approved / approve-ready placeholder", approveReady, {
        statusCopy: "Approve-ready fixture state only. Approval is not written anywhere.",
        publicationCopy: "Not published. Approve and publish are disabled placeholders.",
        paymentCopy: "Payment readiness remains separate from this static preview.",
        readinessCopy: "Publication readiness will be evaluated by a later gate.",
      }),
      buildQueueItem("published_placeholder", "Published placeholder", approveReady, {
        statusCopy: "Published state is represented only as a UI placeholder for operator review.",
        publicationCopy: "No live marketplace publication exists from this page.",
        paymentCopy: "No live payment activation, wallet signing, or settlement setup occurs.",
        readinessCopy: "Readiness is illustrative until the deferred publication workflow ships.",
      }),
      buildQueueItem("rejected", "Rejected", rejected, {
        statusCopy: "Rejected fixture state with malformed connector evidence.",
        publicationCopy: "Not published. Rejection is already fixture metadata, not a live mutation.",
        paymentCopy: "Payment remains inactive for rejected imported metadata.",
        readinessCopy: "Publication readiness remains unavailable.",
      }),
      buildQueueItem("blocked", "Blocked", blocked, {
        statusCopy: "Blocked by static risk diagnostics and operator guardrails.",
        publicationCopy: "Not published. Blockers must be cleared outside this read-only UI.",
        paymentCopy: "Payment activation is disabled while blockers remain.",
        readinessCopy: "Readiness cannot pass while static risk blockers are present.",
      }),
      buildQueueItem("suspended", "Suspended", suspended, {
        statusCopy: "Suspended imported listing fixture with unsafe metadata warnings.",
        publicationCopy: "Not published. Suspend/unpublish controls are non-live placeholders.",
        paymentCopy: "Payment readiness is disabled for suspended metadata.",
        readinessCopy: "Publication readiness is unavailable for suspended metadata.",
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
  copy: Pick<MarketplaceApprovalQueueItem["listingPreview"], "statusCopy" | "publicationCopy" | "paymentCopy" | "readinessCopy">,
): MarketplaceApprovalQueueItem {
  const buyerPreview = candidate.draftPreview.buyerPreview;
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
      ...copy,
    },
  };
}
