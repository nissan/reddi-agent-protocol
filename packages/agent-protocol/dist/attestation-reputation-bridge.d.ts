import { type HostedAttestationClaim, type HostedAttestationOperatorApproval, type HostedAttestationProofRef, type HostedAttestationPublicationGate } from './hosted-attestation-claim.js';
import { type OffchainReputationPreview } from './offchain-reputation-preview.js';
import type { QuasarRegistryCompatibilityReport } from './quasar-registry-compatibility.js';
import { type QuasarReputationIntentKind, type QuasarReputationIntentPlan } from './quasar-reputation-intent.js';
import { type ReceiptEvidenceBinding, type ReceiptEvidenceSourceRef } from './receipt-evidence-binding.js';
/**
 * `reddi.attestation-reputation-bridge.v1` — attestation/reputation bridge
 * for Quasar and off-chain listings (#394).
 *
 * One deterministic read-model that composes the three merged reputation
 * contracts for a single listing/job record set:
 *
 * - `reddi.offchain-reputation-preview.v1` (#439) — the off-chain lane,
 * - `reddi.quasar-reputation-intent.v1` (#443 / PR #601) — the Quasar-native
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
export declare const ATTESTATION_REPUTATION_BRIDGE_SCHEMA_VERSION: "reddi.attestation-reputation-bridge.v1";
export type AttestationReputationBridgeStatus = 'hosted_attestation_backed' | 'quasar_intent_fixtures' | 'offchain_preview' | 'insufficient_evidence' | 'unverified_external' | 'blocked';
export type AttestationReputationBridgeReasonCode = 'binding_valid' | 'offchain_preview_available' | 'quasar_intent_fixtures_ready' | 'hosted_attestation_ready' | 'buyer_facing_claim_disabled' | 'instruction_not_built' | 'reputation_not_mutated' | 'missing_bridge_id' | 'malformed_bridge' | 'missing_binding' | 'external_source_marked' | 'static_fixture_source' | 'hosted_registry_source' | 'preview_blocked' | 'insufficient_evidence' | 'missing_quasar_compatibility' | 'quasar_intent_blocked' | 'hosted_claim_pending' | 'hosted_claim_blocked' | 'hosted_inputs_not_provided';
export type AttestationReputationBridgeSourceMarking = 'hosted_registry' | 'external_source' | 'static_fixture' | 'unknown';
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
        label: 'Hosted attestation-backed' | 'Quasar intent fixtures ready' | 'Off-chain preview' | 'Insufficient evidence' | 'Unverified external listing' | 'Blocked';
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
export type AttestationReputationBridgeResult = {
    ok: true;
    bridge: AttestationReputationBridge;
} | {
    ok: false;
    bridge: AttestationReputationBridge;
};
export declare function deriveAttestationReputationBridge(input: AttestationReputationBridgeInput): AttestationReputationBridgeResult;
