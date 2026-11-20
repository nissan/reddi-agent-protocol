/**
 * Shapes the manager read models use for a hosted attestation claim and for
 * the reputation section of a listing. These are app-owned records: the app
 * reads them, it never derives them, and none of them is a buyer-facing claim.
 */

export type ReputationListingProjection = {
  offchainPreview: "available" | "pending" | "blocked" | "not_available";
  hostedAttestation: "ready" | "pending" | "blocked" | "not_available";
  quasar: "intent_fixtures_ready" | "pending" | "not_backed" | "blocked";
  buyerFacingClaimsAllowed: false;
  evidenceRefs: string[];
  blockedReasons: string[];
};

export type HostedAttestationClaim = {
  schemaVersion: "reddi.hosted-attestation-claim.v1";
  id: string;
  status: string;
  subject: { id: string; type: "specialist" | "provider" | "listing" };
  source: {
    kind: string;
    sourceId: string;
    catalogRef?: string;
    fixtureRef?: string;
    listingId?: string;
    profileId?: string;
    rawSnapshotRef?: string;
  };
  backing: {
    claimKind: "hosted_attestation_backed";
    attestationKind: string;
    reputationKind: "offchain_preview";
    quasarBacking: { status: "not_quasar_backed"; instructionFlow: "not_built"; promotionChecklistIssue: 441 };
    hostedAttestationBacking: {
      status: "ready" | "pending" | "blocked";
      sourceProofRef?: string;
      attestationProofRef?: string;
      hostedBy?: "reddi";
      operatorApprovalEvidenceRef?: string;
      publicationGateEvidenceRef?: string;
      publicationGateIssue: 395;
    };
  };
  evidenceSummary: {
    bindingId: string;
    receiptId: string;
    evidenceId: string;
    evidenceHash: string;
    evidenceRef: string;
    paymentProofRef: string;
    attestationId?: string;
    reputationEventDraftId?: string;
    previewId: string;
    sourceProofRef?: string;
    attestationProofRef?: string;
    operatorApprovalEvidenceRef?: string;
    publicationGateEvidenceRef?: string;
  };
  previewEvent?: unknown;
  display: { label: string; explanation: string; buyerFacingClaimAllowed: false };
  reasonCodes: string[];
  guardrails: {
    reputationMutated: false;
    quasarInstructionBuilt: false;
    walletSigning: false;
    rpcCall: false;
    hostedRegistryWrite: false;
    marketplacePublished: false;
    livePaymentExecuted: false;
    providerCall: false;
  };
  createdAt: string;
};
