import type { PayShSandboxEvidenceFixture } from './pay-sh-sandbox-evidence.js';
import type { MppTempoReceiptShapeFixture } from './mpp-tempo-receipt-shapes.js';
import type { ReceiptEvidenceSourceRef } from './receipt-evidence-binding.js';
import { type AirwallexWebhookFixture } from './airwallex-webhook-receipt-normalization.js';
export declare const RAIL_NEUTRAL_PAYMENT_RECEIPT_SCHEMA_VERSION: "reddi.rail-neutral-payment-receipt.v1";
export type RailNeutralPaymentReceiptRail = 'pay-sh-sandbox' | 'mpp-tempo' | 'airwallex-hosted-checkout';
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
        unit: 'microusd' | 'base-units' | 'fiat-minor-units';
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
    } | {
        schemaVersion: 'reddi.receipt-evidence-binding.v1';
        /**
         * probe_only receipts are NOT receipt-v1 binding candidates. Reasons are
         * recorded per-rail (e.g. Airwallex: fiat network outside the receipt v1
         * network table; card receipts revocable with no receipt-v1
         * revoked/contested state — #338 gap; frozen union not widened here).
         */
        compatible: false;
        requiredReceiptSchemaVersion: 'reddi.receipt.v1';
        incompatibilityReasons: string[];
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
} | {
    rail: 'airwallex-hosted-checkout';
    fixture: AirwallexWebhookFixture;
};
export type RailNeutralPaymentReceiptErrorCode = 'malformed_receipt' | 'unsupported_asset_network' | 'policy_denied' | 'unsupported_fixture_state' | 'live_path_rejected' | 'revocable_event_rejected' | 'pii_rejected';
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
