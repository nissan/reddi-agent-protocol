import type { OperatorDiscoveryCandidateView } from "@/lib/manager/static-agent-stack-review";
import {
  evaluateMarketplaceReadiness,
  type MarketplaceReadinessProofMetadata,
  type MarketplaceReadinessResult,
} from "@/lib/manager/marketplace-readiness-gate";

export type MarketplaceApprovalRecordState =
  | "draft"
  | "needs_changes"
  | "approve_ready"
  | "approved"
  | "published"
  | "internal"
  | "blocked"
  | "rejected"
  | "suspended";

export type MarketplaceApprovalActionType =
  | "approve"
  | "request_changes"
  | "reject"
  | "suspend"
  | "publish"
  | "unpublish";

export type MarketplaceApprovalAuditEntry = {
  operatorId: string;
  action: MarketplaceApprovalActionType;
  reason: string;
  timestamp: string;
  previousState: MarketplaceApprovalRecordState;
  nextState: MarketplaceApprovalRecordState;
  evidenceRefs: string[];
};

export type MarketplaceApprovalRecord = {
  id: string;
  fixtureKey: string;
  candidate: OperatorDiscoveryCandidateView;
  state: MarketplaceApprovalRecordState;
  publicVisible: boolean;
  auditHistory: MarketplaceApprovalAuditEntry[];
};

export type MarketplaceApprovalAction = {
  type: MarketplaceApprovalActionType;
  operatorId: string;
  timestamp: string;
  reason?: string;
  evidenceRefs?: string[];
  readinessProof?: MarketplaceReadinessProofMetadata;
};

export type MarketplaceApprovalActionResult =
  | {
      ok: true;
      record: MarketplaceApprovalRecord;
      readiness?: MarketplaceReadinessResult;
    }
  | {
      ok: false;
      reason: string;
      record: MarketplaceApprovalRecord;
      readiness?: MarketplaceReadinessResult;
    };

const terminalStates: MarketplaceApprovalRecordState[] = ["rejected"];
const requestChangesStates: MarketplaceApprovalRecordState[] = ["draft", "approve_ready", "blocked"];
const suspendStates: MarketplaceApprovalRecordState[] = ["approved", "published", "internal", "suspended"];
const unsafeApprovalStates = [
  "unsafe_metadata_warning",
  "rejected_malformed_connector",
  "static_risk_blocker",
  "suspended_imported_listing",
];

export function applyMarketplaceApprovalAction(
  record: MarketplaceApprovalRecord,
  action: MarketplaceApprovalAction,
): MarketplaceApprovalActionResult {
  const validationFailure = validateActionInput(action);
  if (validationFailure) return fail(record, validationFailure);
  if (terminalStates.includes(record.state) && action.type !== "unpublish") {
    return fail(record, `Listing state ${record.state} is terminal and cannot transition without an explicit reopen lane.`);
  }

  switch (action.type) {
    case "approve":
      return approve(record, action);
    case "request_changes":
      return requestChanges(record, action);
    case "reject":
      return transition(record, action, "rejected", false);
    case "suspend":
      return suspend(record, action);
    case "publish":
      return publish(record, action);
    case "unpublish":
      return unpublish(record, action);
  }
}

export function getBlockingApprovalReviewItems(candidate: OperatorDiscoveryCandidateView) {
  return candidate.reviewItems.filter((item) => unsafeApprovalStates.includes(item.state));
}

function approve(record: MarketplaceApprovalRecord, action: MarketplaceApprovalAction): MarketplaceApprovalActionResult {
  if (["published", "suspended"].includes(record.state)) {
    return fail(record, `Listing state ${record.state} cannot be approved by this internal action.`);
  }
  const blockers = getBlockingApprovalReviewItems(record.candidate);
  if (blockers.length > 0) {
    return fail(
      record,
      `Imported metadata cannot be approved while static review blockers remain: ${blockers
        .map((item) => item.reasonCodes.join(", ") || item.state)
        .join("; ")}.`,
    );
  }
  if (!record.candidate.staticOnly || !record.candidate.imported || !record.candidate.untrusted) {
    return fail(record, "Only static imported untrusted candidates can use this internal approval action.");
  }

  return transition(record, action, "approved", false);
}

function requestChanges(
  record: MarketplaceApprovalRecord,
  action: MarketplaceApprovalAction,
): MarketplaceApprovalActionResult {
  if (!requestChangesStates.includes(record.state)) {
    return fail(record, `Request changes is only allowed from draft, approve_ready, or blocked; got ${record.state}.`);
  }
  return transition(record, action, "needs_changes", false);
}

function suspend(record: MarketplaceApprovalRecord, action: MarketplaceApprovalAction): MarketplaceApprovalActionResult {
  if (!suspendStates.includes(record.state)) {
    return fail(record, `Suspend is only allowed from approved, published, or internal; got ${record.state}.`);
  }
  if (record.state === "suspended" && record.publicVisible === false) {
    return transition(record, action, "suspended", false);
  }
  return transition(record, action, "suspended", false);
}

function publish(record: MarketplaceApprovalRecord, action: MarketplaceApprovalAction): MarketplaceApprovalActionResult {
  if (record.state !== "approved") {
    return fail(record, `Publish requires approved state; got ${record.state}.`);
  }
  const readiness = evaluateMarketplaceReadiness(
    record.id,
    record.fixtureKey,
    record.candidate,
    action.readinessProof ?? {},
  );
  if (readiness.status !== "publish_ready" || readiness.boundaries.publicationAllowed !== true) {
    return fail(
      record,
      `Publish blocked by marketplace readiness: ${readiness.blockReasons.join(" ") || readiness.status}.`,
      readiness,
    );
  }
  if (!action.readinessProof?.operatorApproval?.approved || !isNonEmptyString(action.readinessProof.operatorApproval.evidenceRef)) {
    return fail(record, "Publish requires explicit operator approval evidence.", readiness);
  }

  const evidenceRefs = uniqueRefs([
    ...(action.evidenceRefs ?? []),
    ...readiness.gates.flatMap((gate) => gate.evidenceRefs),
  ]);
  return transition(record, { ...action, evidenceRefs }, "published", true, readiness);
}

function unpublish(record: MarketplaceApprovalRecord, action: MarketplaceApprovalAction): MarketplaceApprovalActionResult {
  const nextState = record.state === "published" ? "approved" : record.state;
  return transition(record, action, nextState, false);
}

function transition(
  record: MarketplaceApprovalRecord,
  action: MarketplaceApprovalAction,
  nextState: MarketplaceApprovalRecordState,
  publicVisible: boolean,
  readiness?: MarketplaceReadinessResult,
): MarketplaceApprovalActionResult {
  const auditEntry: MarketplaceApprovalAuditEntry = {
    operatorId: action.operatorId,
    action: action.type,
    reason: action.reason?.trim() || defaultReasonFor(action.type),
    timestamp: action.timestamp,
    previousState: record.state,
    nextState,
    evidenceRefs: uniqueRefs(action.evidenceRefs ?? []),
  };

  return {
    ok: true,
    record: {
      ...record,
      state: nextState,
      publicVisible,
      auditHistory: [...record.auditHistory, auditEntry],
    },
    readiness,
  };
}

function fail(
  record: MarketplaceApprovalRecord,
  reason: string,
  readiness?: MarketplaceReadinessResult,
): MarketplaceApprovalActionResult {
  return { ok: false, reason, record, readiness };
}

function validateActionInput(action: MarketplaceApprovalAction) {
  if (!isNonEmptyString(action.operatorId)) return "Operator id is required.";
  if (!isNonEmptyString(action.timestamp)) return "Action timestamp is required.";
  if (Number.isNaN(Date.parse(action.timestamp))) return "Action timestamp must be an ISO-compatible date.";
  return null;
}

function defaultReasonFor(action: MarketplaceApprovalActionType) {
  switch (action) {
    case "approve":
      return "Operator approved static imported metadata for internal marketplace review.";
    case "request_changes":
      return "Operator requested changes before approval.";
    case "reject":
      return "Operator rejected imported metadata.";
    case "suspend":
      return "Operator suspended the listing and forced public visibility off.";
    case "publish":
      return "Operator published after local readiness evidence passed.";
    case "unpublish":
      return "Operator forced public visibility off.";
  }
}

function uniqueRefs(refs: string[]) {
  return Array.from(new Set(refs.filter(isNonEmptyString)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
