import {
  deriveHostedAttestationClaim,
  type HostedAttestationClaim,
  type HostedAttestationOperatorApproval,
  type HostedAttestationProofRef,
  type HostedAttestationPublicationGate,
} from './hosted-attestation-claim.js';
import {
  deriveOffchainReputationPreview,
  type OffchainReputationPreview,
} from './offchain-reputation-preview.js';
import type { QuasarRegistryCompatibilityReport } from './quasar-registry-compatibility.js';
import {
  deriveQuasarReputationIntentPlan,
  type QuasarReputationIntentKind,
  type QuasarReputationIntentPlan,
} from './quasar-reputation-intent.js';
import {
  RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION,
  type ReceiptEvidenceBinding,
  type ReceiptEvidenceSourceRef,
} from './receipt-evidence-binding.js';

/**
 * `reddi.attestation-reputation-bridge.v1` — attestation/reputation bridge
 * for Quasar and off-chain listings (#394).
 *
 * One deterministic read-model that composes the three merged reputation
 * contracts for a single listing/job record set:
 *
 * - `reddi.offchain-reputation-preview.v1` (#439) — the off-chain lane,
 * - `reddi.quasar-reputation-intent.v2` (#443 / PR #601) — the Quasar-native
 *   projection, gated on the #390 `reddi.quasar-registry-compatibility.v1`
 *   report,
 * - `reddi.hosted-attestation-claim.v1` (#442) — the hosted
 *   attestation-backed lane,
 *
 * and answers the #394 acceptance question a UI/API surface actually asks:
 * "is this listing's reputation an off-chain preview, Quasar intent fixtures,
 * or hosted attestation-backed — and if none of those, why?" External
 * listings without a receipt/evidence binding are marked
 * `unverified_external` rather than being given any reputation surface at
 * all.
 *
 * Honesty contract for the Quasar lane: the #443 gate produces INTENT
 * records, not instructions. This bridge therefore never reports
 * "Quasar-backed" reputation — the strongest Quasar state is
 * `quasar_intent_fixtures` with `instructionFlow: 'not_built'` and
 * `quasarBackedReputation: false`. The frozen preview v1 guardrail
 * `quasarInstructionBuilt: false` is preserved untouched, because no
 * instruction is built anywhere in this composition.
 *
 * Pure, synchronous, fixture-level composition: no signing, no RPC, no
 * program deploy, no hosted write, no live payment, and no reputation
 * mutation — failed policy, missing evidence, failed attestation, and
 * unverified payment proof all fail closed inside the composed derivations.
 */
export const ATTESTATION_REPUTATION_BRIDGE_SCHEMA_VERSION = 'reddi.attestation-reputation-bridge.v1' as const;

export type AttestationReputationBridgeStatus =
  | 'hosted_attestation_backed'
  | 'quasar_intent_fixtures'
  | 'offchain_preview'
  | 'insufficient_evidence'
  | 'unverified_external'
  | 'blocked';

export type AttestationReputationBridgeReasonCode =
  | 'binding_valid'
  | 'offchain_preview_available'
  | 'quasar_intent_fixtures_ready'
  | 'hosted_attestation_ready'
  | 'buyer_facing_claim_disabled'
  | 'instruction_not_built'
  | 'reputation_not_mutated'
  | 'missing_bridge_id'
  | 'malformed_bridge'
  | 'missing_binding'
  | 'external_source_marked'
  | 'static_fixture_source'
  | 'hosted_registry_source'
  | 'preview_blocked'
  | 'insufficient_evidence'
  | 'missing_quasar_compatibility'
  | 'quasar_intent_blocked'
  | 'hosted_claim_pending'
  | 'hosted_claim_blocked'
  | 'hosted_inputs_not_provided';

export type AttestationReputationBridgeSourceMarking =
  | 'hosted_registry'
  | 'external_source'
  | 'static_fixture'
  | 'unknown';

export type AttestationReputationBridgeOffchainLane = {
  status: 'available' | 'insufficient_evidence' | 'blocked' | 'not_available';
  previewId?: string;
  previewStatus?: OffchainReputationPreview['status'];
};

export type AttestationReputationBridgeQuasarLane = {
  status: 'intent_fixtures_ready' | 'compatibility_missing' | 'blocked' | 'not_available';
  compatibilityIssue: 390;
  registrationStatus?: QuasarRegistryCompatibilityReport['registrationStatus'];
  listingId?: string;
  intentPlanId?: string;
  eligibleLanes: QuasarReputationIntentKind[];
  intentCount: number;
  /** Intent records are data only; no instruction exists anywhere here. */
  instructionFlow: 'not_built';
  /** Never true in v1: intent fixtures are not Quasar-backed reputation. */
  quasarBackedReputation: false;
};

export type AttestationReputationBridgeHostedLane = {
  status: 'ready' | 'pending' | 'blocked' | 'not_available';
  claimId?: string;
  claimStatus?: HostedAttestationClaim['status'];
  publicationGateIssue: 395;
};

/**
 * Listing-surface projection in the marketplace evidence vocabulary
 * (`lib/manager/marketplace-listings.ts` `MarketplacePublicationEvidenceView`
 * uses the same per-lane state words), so off-chain listing surfaces can
 * consume the bridge without re-deriving anything.
 */
export type AttestationReputationBridgeListingProjection = {
  offchainPreview: 'available' | 'pending' | 'blocked' | 'not_available';
  hostedAttestation: 'ready' | 'pending' | 'blocked' | 'not_available';
  quasar: 'intent_fixtures_ready' | 'pending' | 'not_backed' | 'blocked';
  buyerFacingClaimsAllowed: false;
  evidenceRefs: string[];
  blockedReasons: string[];
};

export type AttestationReputationBridge = {
  schemaVersion: typeof ATTESTATION_REPUTATION_BRIDGE_SCHEMA_VERSION;
  id: string;
  status: AttestationReputationBridgeStatus;
  subject: OffchainReputationPreview['subject'];
  source: ReceiptEvidenceSourceRef;
  marking: {
    source: AttestationReputationBridgeSourceMarking;
    attestation: OffchainReputationPreview['backing']['attestationKind'];
  };
  lanes: {
    offchainPreview: AttestationReputationBridgeOffchainLane;
    quasar: AttestationReputationBridgeQuasarLane;
    hostedAttestation: AttestationReputationBridgeHostedLane;
  };
  /** Embedded composed records so UI/API needs exactly one derivation call. */
  records: {
    preview?: OffchainReputationPreview;
    quasarIntentPlan?: QuasarReputationIntentPlan;
    hostedClaim?: HostedAttestationClaim;
  };
  listingProjection: AttestationReputationBridgeListingProjection;
  evidenceSummary?: OffchainReputationPreview['evidenceSummary'] & {
    previewId: string;
    intentPlanId?: string;
    hostedClaimId?: string;
  };
  display: {
    label:
      | 'Hosted attestation-backed'
      | 'Quasar intent fixtures ready'
      | 'Off-chain preview'
      | 'Insufficient evidence'
      | 'Unverified external listing'
      | 'Blocked';
    explanation: string;
    buyerFacingClaimAllowed: false;
  };
  reasonCodes: AttestationReputationBridgeReasonCode[];
  guardrails: {
    reputationMutated: false;
    quasarInstructionBuilt: false;
    walletSigning: false;
    rpcCall: false;
    programDeploy: false;
    hostedRegistryWrite: false;
    marketplacePublished: false;
    livePaymentExecuted: false;
    providerCall: false;
  };
  createdAt: string;
};

export type AttestationReputationBridgeInput = {
  id: string;
  /**
   * The #393 receipt/evidence binding for this listing/job. Omit it for
   * external listings without evidence — the bridge marks those
   * `unverified_external` instead of deriving any reputation surface.
   */
  binding?: ReceiptEvidenceBinding;
  /** The #390 compatibility report; without it the Quasar lane stays off. */
  compatibility?: QuasarRegistryCompatibilityReport;
  /** Hosted attestation gate metadata (#442); optional. */
  hosted?: {
    proof?: HostedAttestationProofRef;
    operatorApproval?: HostedAttestationOperatorApproval;
    publicationGate?: HostedAttestationPublicationGate;
  };
  /** Source ref for binding-less external listings. */
  source?: ReceiptEvidenceSourceRef;
  subject?: OffchainReputationPreview['subject'];
  createdAt: string;
};

export type AttestationReputationBridgeResult =
  | { ok: true; bridge: AttestationReputationBridge }
  | { ok: false; bridge: AttestationReputationBridge };

const GUARDRAILS: AttestationReputationBridge['guardrails'] = {
  reputationMutated: false,
  quasarInstructionBuilt: false,
  walletSigning: false,
  rpcCall: false,
  programDeploy: false,
  hostedRegistryWrite: false,
  marketplacePublished: false,
  livePaymentExecuted: false,
  providerCall: false,
};

const UNKNOWN_SOURCE: ReceiptEvidenceSourceRef = {
  kind: 'static-fixture',
  sourceId: 'unknown',
  fixtureRef: 'unknown',
};

export function deriveAttestationReputationBridge(
  input: AttestationReputationBridgeInput,
): AttestationReputationBridgeResult {
  const reasonCodes: AttestationReputationBridgeReasonCode[] = [];

  const malformedId = !isNonEmptyString(input.id);
  const malformedCreatedAt = !isNonEmptyString(input.createdAt) || Number.isNaN(Date.parse(input.createdAt));
  if (malformedId) reasonCodes.push('missing_bridge_id');
  if (malformedCreatedAt) reasonCodes.push('malformed_bridge');

  const binding = bindingIsUsable(input.binding) ? input.binding : undefined;
  if (input.binding && !binding) reasonCodes.push('malformed_bridge');

  // --- Off-chain preview lane (always derived when a binding exists) -------
  const preview = binding
    ? deriveOffchainReputationPreview({
        id: `${input.id}:offchain-preview`,
        binding,
        subject: input.subject,
        createdAt: input.createdAt,
      }).preview
    : undefined;

  // --- Quasar-native projection lane (#601 gate, #390 mapping) ------------
  const quasarIntentPlan = binding && input.compatibility
    ? deriveQuasarReputationIntentPlan({
        id: `${input.id}:quasar-intent`,
        binding,
        compatibility: input.compatibility,
        preview: preview?.status === 'preview_ready' ? preview : undefined,
        subject: input.subject,
        createdAt: input.createdAt,
      }).plan
    : undefined;

  // --- Hosted attestation-backed lane (#442 claim contract) ---------------
  const hostedInputsProvided = Boolean(
    input.hosted && (input.hosted.proof || input.hosted.operatorApproval || input.hosted.publicationGate),
  );
  const hostedLaneApplies = Boolean(
    binding && preview && (binding.source?.kind === 'hosted-rap-registry' || hostedInputsProvided),
  );
  const hostedClaim = binding && preview && hostedLaneApplies
    ? deriveHostedAttestationClaim({
        id: `${input.id}:hosted-claim`,
        binding,
        preview,
        hostedAttestationProof: input.hosted?.proof,
        operatorApproval: input.hosted?.operatorApproval,
        publicationGate: input.hosted?.publicationGate,
        createdAt: input.createdAt,
      }).claim
    : undefined;

  // --- Lane states ---------------------------------------------------------
  const offchainLane = offchainLaneFor(binding, preview);
  const quasarLane = quasarLaneFor(binding, input.compatibility, quasarIntentPlan);
  const hostedLane = hostedLaneFor(hostedClaim, hostedLaneApplies);

  const source = binding?.source ?? input.source ?? UNKNOWN_SOURCE;
  reasonCodes.push(...laneReasonCodes(source, binding, preview, input.compatibility, quasarLane, hostedLane));

  // --- Overall classification ---------------------------------------------
  const status = classify({
    malformed: malformedId || malformedCreatedAt || Boolean(input.binding && !binding),
    binding,
    preview,
    quasarLane,
    hostedLane,
  });

  const normalizedReasonCodes = unique([
    ...(status !== 'blocked' && status !== 'unverified_external' ? (['binding_valid'] as const) : []),
    ...(offchainLane.status === 'available' ? (['offchain_preview_available'] as const) : []),
    ...(quasarLane.status === 'intent_fixtures_ready' ? (['quasar_intent_fixtures_ready'] as const) : []),
    ...(hostedLane.status === 'ready' ? (['hosted_attestation_ready'] as const) : []),
    ...reasonCodes,
    'buyer_facing_claim_disabled' as const,
    'instruction_not_built' as const,
    'reputation_not_mutated' as const,
  ]);

  const evidenceSummary = preview
    ? {
        ...preview.evidenceSummary,
        previewId: preview.id,
        intentPlanId: quasarIntentPlan?.id,
        hostedClaimId: hostedClaim?.id,
      }
    : undefined;

  const bridge: AttestationReputationBridge = {
    schemaVersion: ATTESTATION_REPUTATION_BRIDGE_SCHEMA_VERSION,
    id: input.id,
    status,
    subject: input.subject ?? preview?.subject ?? inferSubject(source),
    source,
    marking: {
      source: sourceMarkingFor(source),
      attestation: binding?.attestation?.trustBoundary ?? 'none',
    },
    lanes: {
      offchainPreview: offchainLane,
      quasar: quasarLane,
      hostedAttestation: hostedLane,
    },
    records: {
      preview,
      quasarIntentPlan,
      hostedClaim,
    },
    listingProjection: listingProjectionFor(status, offchainLane, quasarLane, hostedLane, evidenceSummary),
    evidenceSummary,
    display: {
      label: displayLabel(status),
      explanation: displayExplanation(status),
      buyerFacingClaimAllowed: false,
    },
    reasonCodes: normalizedReasonCodes,
    guardrails: GUARDRAILS,
    createdAt: input.createdAt,
  };

  return status === 'blocked' ? { ok: false, bridge } : { ok: true, bridge };
}

// ---------------------------------------------------------------------------
// Lane derivation
// ---------------------------------------------------------------------------

function offchainLaneFor(
  binding: ReceiptEvidenceBinding | undefined,
  preview: OffchainReputationPreview | undefined,
): AttestationReputationBridgeOffchainLane {
  if (!binding || !preview) return { status: 'not_available' };
  const status = preview.status === 'preview_ready'
    ? 'available'
    : preview.status === 'insufficient_evidence'
      ? 'insufficient_evidence'
      : 'blocked';
  return { status, previewId: preview.id, previewStatus: preview.status };
}

function quasarLaneFor(
  binding: ReceiptEvidenceBinding | undefined,
  compatibility: QuasarRegistryCompatibilityReport | undefined,
  plan: QuasarReputationIntentPlan | undefined,
): AttestationReputationBridgeQuasarLane {
  const base = {
    compatibilityIssue: 390 as const,
    instructionFlow: 'not_built' as const,
    quasarBackedReputation: false as const,
    eligibleLanes: [] as QuasarReputationIntentKind[],
    intentCount: 0,
  };
  if (!binding) return { ...base, status: 'not_available' };
  if (!compatibility) return { ...base, status: 'compatibility_missing' };
  if (!plan || plan.status !== 'intent_ready') {
    return {
      ...base,
      status: 'blocked',
      registrationStatus: compatibility.registrationStatus,
      listingId: compatibility.listingId,
      intentPlanId: plan?.id,
    };
  }
  return {
    ...base,
    status: 'intent_fixtures_ready',
    registrationStatus: compatibility.registrationStatus,
    listingId: compatibility.listingId,
    intentPlanId: plan.id,
    eligibleLanes: plan.lanes.filter((lane) => lane.eligible).map((lane) => lane.kind),
    intentCount: plan.intents.length,
  };
}

function hostedLaneFor(
  claim: HostedAttestationClaim | undefined,
  hostedLaneApplies: boolean,
): AttestationReputationBridgeHostedLane {
  if (!claim || !hostedLaneApplies) {
    return { status: 'not_available', publicationGateIssue: 395 };
  }
  // The #442 claim contract already distinguishes pending gate metadata
  // (publication_gate_pending / insufficient_evidence) from hard safety
  // failures (blocked); the lane mirrors that verdict directly.
  return {
    status: claim.status === 'hosted_attestation_ready'
      ? 'ready'
      : claim.status === 'blocked'
        ? 'blocked'
        : 'pending',
    claimId: claim.id,
    claimStatus: claim.status,
    publicationGateIssue: 395,
  };
}

function laneReasonCodes(
  source: ReceiptEvidenceSourceRef,
  binding: ReceiptEvidenceBinding | undefined,
  preview: OffchainReputationPreview | undefined,
  compatibility: QuasarRegistryCompatibilityReport | undefined,
  quasarLane: AttestationReputationBridgeQuasarLane,
  hostedLane: AttestationReputationBridgeHostedLane,
): AttestationReputationBridgeReasonCode[] {
  const reasonCodes: AttestationReputationBridgeReasonCode[] = [];

  if (!binding) reasonCodes.push('missing_binding');
  const marking = sourceMarkingFor(source);
  if (marking === 'hosted_registry') reasonCodes.push('hosted_registry_source');
  if (marking === 'static_fixture') reasonCodes.push('static_fixture_source');
  if (marking === 'external_source') reasonCodes.push('external_source_marked');

  if (preview?.status === 'blocked') reasonCodes.push('preview_blocked');
  if (preview?.status === 'insufficient_evidence') reasonCodes.push('insufficient_evidence');
  if (binding && !compatibility) reasonCodes.push('missing_quasar_compatibility');
  if (quasarLane.status === 'blocked') reasonCodes.push('quasar_intent_blocked');
  if (hostedLane.status === 'pending') reasonCodes.push('hosted_claim_pending');
  if (hostedLane.status === 'blocked') reasonCodes.push('hosted_claim_blocked');
  if (binding && hostedLane.status === 'not_available') reasonCodes.push('hosted_inputs_not_provided');

  return reasonCodes;
}

function classify(state: {
  malformed: boolean;
  binding: ReceiptEvidenceBinding | undefined;
  preview: OffchainReputationPreview | undefined;
  quasarLane: AttestationReputationBridgeQuasarLane;
  hostedLane: AttestationReputationBridgeHostedLane;
}): AttestationReputationBridgeStatus {
  if (state.malformed) return 'blocked';
  if (!state.binding) return 'unverified_external';
  if (!state.preview || state.preview.status === 'blocked') return 'blocked';
  if (state.preview.status === 'insufficient_evidence') return 'insufficient_evidence';
  if (state.hostedLane.status === 'ready') return 'hosted_attestation_backed';
  if (state.quasarLane.status === 'intent_fixtures_ready') return 'quasar_intent_fixtures';
  return 'offchain_preview';
}

// ---------------------------------------------------------------------------
// Projections and display
// ---------------------------------------------------------------------------

function listingProjectionFor(
  status: AttestationReputationBridgeStatus,
  offchainLane: AttestationReputationBridgeOffchainLane,
  quasarLane: AttestationReputationBridgeQuasarLane,
  hostedLane: AttestationReputationBridgeHostedLane,
  evidenceSummary: (OffchainReputationPreview['evidenceSummary'] & { previewId: string }) | undefined,
): AttestationReputationBridgeListingProjection {
  const blockedReasons: string[] = [];
  if (status === 'blocked') blockedReasons.push('A fail-closed gate rejected this record set; no reputation surface is available.');
  if (status === 'unverified_external') blockedReasons.push('External listing has no receipt/evidence binding; reputation claims are unavailable.');
  if (status === 'insufficient_evidence') blockedReasons.push('Attestation or reputation-draft evidence is missing; no score preview is exposed.');
  if (quasarLane.status === 'blocked') blockedReasons.push('Quasar intent gate rejected this record set; no intent fixtures were produced.');
  if (hostedLane.status === 'blocked') blockedReasons.push('Hosted attestation claim failed a safety gate.');

  return {
    offchainPreview: offchainLane.status === 'available'
      ? 'available'
      : offchainLane.status === 'insufficient_evidence'
        ? 'pending'
        : offchainLane.status === 'blocked'
          ? 'blocked'
          : 'not_available',
    hostedAttestation: hostedLane.status,
    quasar: quasarLane.status === 'intent_fixtures_ready'
      ? 'intent_fixtures_ready'
      : quasarLane.status === 'compatibility_missing'
        ? 'pending'
        : quasarLane.status === 'blocked'
          ? 'blocked'
          : 'not_backed',
    buyerFacingClaimsAllowed: false,
    evidenceRefs: evidenceSummary
      ? unique([
          `binding:${evidenceSummary.bindingId}`,
          `receipt:${evidenceSummary.receiptId}`,
          `evidence:${evidenceSummary.evidenceId}`,
          `preview:${evidenceSummary.previewId}`,
          ...(quasarLane.intentPlanId ? [`quasar-intent:${quasarLane.intentPlanId}`] : []),
          ...(hostedLane.claimId ? [`hosted-claim:${hostedLane.claimId}`] : []),
        ])
      : [],
    blockedReasons,
  };
}

function sourceMarkingFor(source: ReceiptEvidenceSourceRef): AttestationReputationBridgeSourceMarking {
  if (source.sourceId === 'unknown') return 'unknown';
  if (source.kind === 'hosted-rap-registry') return 'hosted_registry';
  if (source.kind === 'static-fixture') return 'static_fixture';
  return 'external_source';
}

function inferSubject(source: ReceiptEvidenceSourceRef): OffchainReputationPreview['subject'] {
  if (isNonEmptyString(source.listingId)) return { id: source.listingId, type: 'listing' };
  if (isNonEmptyString(source.profileId)) return { id: source.profileId, type: 'specialist' };
  return { id: 'unknown', type: 'listing' };
}

function displayLabel(status: AttestationReputationBridgeStatus): AttestationReputationBridge['display']['label'] {
  if (status === 'hosted_attestation_backed') return 'Hosted attestation-backed';
  if (status === 'quasar_intent_fixtures') return 'Quasar intent fixtures ready';
  if (status === 'offchain_preview') return 'Off-chain preview';
  if (status === 'insufficient_evidence') return 'Insufficient evidence';
  if (status === 'unverified_external') return 'Unverified external listing';
  return 'Blocked';
}

function displayExplanation(status: AttestationReputationBridgeStatus): string {
  if (status === 'hosted_attestation_backed') {
    return 'Reputation is backed by a hosted attestation claim with complete gate evidence; buyer-facing claims stay disabled until #395 permits them.';
  }
  if (status === 'quasar_intent_fixtures') {
    return 'Fixture-level Quasar intent records exist for this record set. No instruction was built and reputation is NOT Quasar-backed; the off-chain preview remains the reputation surface.';
  }
  if (status === 'offchain_preview') {
    return 'Reputation is an off-chain preview derived from receipts and evidence only; it does not mutate reputation and is not Quasar- or hosted-attestation-backed.';
  }
  if (status === 'insufficient_evidence') {
    return 'Evidence exists, but attestation or reputation-draft data required for any reputation surface is missing.';
  }
  if (status === 'unverified_external') {
    return 'This external listing has no receipt/evidence binding, so it cannot claim any reputation backing.';
  }
  return 'A fail-closed gate rejected this record set; no reputation surface of any kind is available.';
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

function bindingIsUsable(binding: ReceiptEvidenceBinding | undefined): binding is ReceiptEvidenceBinding {
  return Boolean(binding && binding.schemaVersion === RECEIPT_EVIDENCE_BINDING_SCHEMA_VERSION);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
