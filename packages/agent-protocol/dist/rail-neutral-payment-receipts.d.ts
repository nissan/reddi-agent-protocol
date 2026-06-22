import type { PayShSandboxEvidenceFixture } from './pay-sh-sandbox-evidence.js';
import type { MppTempoReceiptShapeFixture } from './mpp-tempo-receipt-shapes.js';
import type { ReceiptEvidenceSourceRef } from './receipt-evidence-binding.js';
export declare const RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION: "reddi.rail-neutral-payment-receipt.v1";
export type RailNeutralPaymentReceiptRail = 'pay-sh-sandbox' | 'mpp-tempo';
export type RailNeutralPaymentReceiptSupportState = 'receipt_binding_candidate' | 'probe_only' | 'unsupported_receipt_v1_network';
export type RailNeutralPaymentReceiptGuardrails = {
    fixtureOnly: true;
    livePaymentExecuted: false;
    walletSigning: false;
    rpcCall: false;
    providerCall: false;
    hostedRegistryWrite: false;
    marketplacePublication: false;
    trustUpgrade: false;
    reputationMutation: false;
    settlementProof: false;
    custodyClaim: false;
};
export type RailNeutralPaymentReceiptPolicyInput = {
    allowed: boolean;
    reasonCodes: string[];
    auditNotes?: string[];
};
export type RailNeutralPaymentReceiptOptions = {
    policy?: RailNeutralPaymentReceiptPolicyInput;
    networkOverride?: string;
    assetOverride?: string;
};
export type RailNeutralPaymentReceipt = {
    schemaVersion: typeof RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION;
    rail: RailNeutralPaymentReceiptRail;
    case: string;
    supportState: RailNeutralPaymentReceiptSupportState;
    source: ReceiptEvidenceSourceRef;
    payment: {
        network: string;
        asset: string;
        amount: string;
        unit: 'microusd' | 'base-units';
        paymentProofRef: string;
        receiptRef?: string;
    };
    bindingRefs: {
        evidenceRef: string;
        requestHash: string;
        responseHash: string;
        recipientRef: string;
        nonceRef: string;
        operatorApprovalRef: string;
    };
    policy: {
        allowed: true;
        reasonCodes: string[];
        auditNotes: string[];
    };
    bindingIntegration: {
        schemaVersion: 'reddi.receipt-evidence-binding.v1';
        compatible: true;
        requiredReceiptSchemaVersion: 'reddi.receipt.v1';
    };
    claimBoundary: string[];
    guardrails: RailNeutralPaymentReceiptGuardrails;
};
export type RailNeutralPaymentReceiptInput = {
    rail: 'pay-sh-sandbox';
    fixture: PayShSandboxEvidenceFixture;
} | {
    rail: 'mpp-tempo';
    fixture: MppTempoReceiptShapeFixture;
};
export type RailNeutralPaymentReceiptErrorCode = 'malformed_receipt' | 'unsupported_asset_network' | 'policy_denied' | 'unsupported_fixture_state' | 'live_path_rejected';
export type RailNeutralPaymentReceiptError = {
    code: RailNeutralPaymentReceiptErrorCode;
    path: string;
    message: string;
};
export type RailNeutralPaymentReceiptResult = {
    ok: true;
    receipt: RailNeutralPaymentReceipt;
} | {
    ok: false;
    errors: RailNeutralPaymentReceiptError[];
};
export declare const RAIL_NEUTRAL_PAYMENT_RECEIPT_GUARDRAILS: RailNeutralPaymentReceiptGuardrails;
export declare function createRailNeutralPaymentReceipt(input: RailNeutralPaymentReceiptInput, options?: RailNeutralPaymentReceiptOptions): RailNeutralPaymentReceipt;
export declare function deriveRailNeutralPaymentReceipt(input: RailNeutralPaymentReceiptInput, options?: RailNeutralPaymentReceiptOptions): RailNeutralPaymentReceiptResult;
