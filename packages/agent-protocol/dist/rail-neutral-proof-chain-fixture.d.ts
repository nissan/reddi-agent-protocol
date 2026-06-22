import { type EvidenceArchiveRecord } from './evidence-archive.js';
import { type RailNeutralPaymentReceipt, type RailNeutralPaymentReceiptError, type RailNeutralPaymentReceiptInput, type RailNeutralPaymentReceiptOptions } from './rail-neutral-payment-receipts.js';
import { type ReceiptEvidenceBinding } from './receipt-evidence-binding.js';
import { type ReddiReceipt } from './receipts.js';
export declare const RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION: "reddi.rail-neutral-proof-chain-fixture.v1";
export type RailNeutralProofChainFixtureCase = 'pay_sh_sandbox_single_charge_binding' | 'mpp_tempo_unsupported_network' | 'unsupported_asset_network' | 'malformed_receipt' | 'policy_denied' | 'live_path_overclaim';
export type RailNeutralProofChainFixtureStatus = 'binding_ready' | 'blocked';
export type RailNeutralProofChainFixtureGuardrails = {
    fixtureOnly: true;
    rawPromptStored: false;
    rawOutputStored: false;
    credentialMaterialStored: false;
    walletSigning: false;
    rpcCall: false;
    providerCall: false;
    paidRequest: false;
    sandboxExecution: false;
    hostedRegistryWrite: false;
    marketplacePublication: false;
    trustUpgrade: false;
    reputationMutation: false;
    custodyClaim: false;
    settlementFinalityProof: false;
    livePayment: false;
};
export type RailNeutralProofChainFailure = {
    code: RailNeutralPaymentReceiptError['code'];
    path: string;
    message: string;
};
export type RailNeutralProofChainSourceRef = {
    rail: RailNeutralPaymentReceiptInput['rail'];
    case: string;
    sourceId: string;
    artifactPath: string;
};
export type RailNeutralProofChainFixture = {
    schemaVersion: typeof RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION;
    case: RailNeutralProofChainFixtureCase;
    status: RailNeutralProofChainFixtureStatus;
    sourceRef: RailNeutralProofChainSourceRef;
    railNeutralReceipt?: RailNeutralPaymentReceipt;
    redactedReceipt?: ReddiReceipt;
    evidence?: EvidenceArchiveRecord;
    binding?: ReceiptEvidenceBinding;
    blockedBy?: RailNeutralProofChainFailure[];
    bindingRefs: {
        sourceRef: string;
        quoteRef?: string;
        paymentProofRef?: string;
        requestHash?: string;
        responseHash?: string;
        evidenceRef?: string;
        nonceRef?: string;
        recipientRef?: string;
        operatorApprovalRef?: string;
    };
    claimBoundaryLabels: string[];
    guardrails: RailNeutralProofChainFixtureGuardrails;
};
export type RailNeutralProofChainFixtureInput = {
    case: RailNeutralProofChainFixtureCase;
    receiptInput: RailNeutralPaymentReceiptInput;
    options?: RailNeutralPaymentReceiptOptions;
    createdAt?: string;
};
export declare const RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_GUARDRAILS: RailNeutralProofChainFixtureGuardrails;
export declare function createRailNeutralProofChainFixture(input: RailNeutralProofChainFixtureInput): RailNeutralProofChainFixture;
export declare const railNeutralProofChainFixtures: {
    readonly payShSandboxSingleChargeBinding: RailNeutralProofChainFixture;
    readonly mppTempoUnsupportedNetwork: RailNeutralProofChainFixture;
    readonly unsupportedAssetNetwork: RailNeutralProofChainFixture;
    readonly malformedReceipt: RailNeutralProofChainFixture;
    readonly policyDenied: RailNeutralProofChainFixture;
    readonly livePathOverclaim: RailNeutralProofChainFixture;
};
