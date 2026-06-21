import type { ReceiptEvidenceSourceRef } from './receipt-evidence-binding.js';
export declare const PAY_SH_SANDBOX_EVIDENCE_SCHEMA_VERSION: "reddi.pay-sh-sandbox-evidence.v1";
export type PayShSandboxEvidenceCase = 'single_charge' | 'capped_session_probe' | 'split_payment_probe';
export type PayShSandboxEvidenceStatus = 'proven_single_charge' | 'probe_only';
export type PayShSandboxEvidenceGuardrails = {
    fixtureOnly: true;
    livePayShCall: false;
    walletSigning: false;
    rpcCall: false;
    providerCall: false;
    hostedRegistryWrite: false;
    marketplacePublication: false;
    trustUpgrade: false;
    reputationMutation: false;
};
export type PayShSandboxEvidenceReceipt = {
    challengeId: string;
    method: 'solana';
    reference: string;
    status: 'success';
    timestamp: string;
};
export type PayShSandboxEvidenceSummary = {
    schema: string;
    mode: 'pay-sh-sandbox' | 'pay-sh-sandbox-extension';
    case: PayShSandboxEvidenceCase;
    artifactPath: string;
    providerSpec: string;
    providerSpecSha256: string;
    url: string;
    plainCurl: {
        status: 402;
        paymentProtocol: 'mpp';
        challengeCount: number;
        priceUsd?: number;
    };
    paySandboxCurl: {
        status: 200 | 'blocked';
        bodyOk?: boolean;
        receipt?: PayShSandboxEvidenceReceipt;
        error?: string;
    };
    decodedRequest?: {
        quoteRef?: string;
        recipient?: string;
        nonce?: string;
        session?: string;
        authorizationRef?: string;
        splitRecipients?: string[];
    };
    claimBoundary: string[];
};
export type PayShSandboxEvidenceBindingRefs = {
    source: ReceiptEvidenceSourceRef;
    paymentProofRef: string;
    evidenceRef: string;
    requestHash: string;
    responseHash: string;
    quoteRef: string;
    recipientRef: string;
    nonceRef: string;
    sessionRef: string;
    authorizationRef: string;
    receiptRef?: string;
    operatorApprovalRef: string;
};
export type PayShSandboxEvidenceFixture = {
    schemaVersion: typeof PAY_SH_SANDBOX_EVIDENCE_SCHEMA_VERSION;
    case: PayShSandboxEvidenceCase;
    status: PayShSandboxEvidenceStatus;
    blocker?: 'pay_sh_0_16_returns_402_after_payment';
    artifactPath: string;
    providerSpecRef: string;
    providerSpecHash: string;
    sourceService: 'pay.sh';
    bindingRefs: PayShSandboxEvidenceBindingRefs;
    receipt?: PayShSandboxEvidenceReceipt;
    guardrails: PayShSandboxEvidenceGuardrails;
    claimBoundary: string[];
};
export type PayShSandboxEvidenceErrorCode = 'malformed_summary' | 'unsupported_mode' | 'live_path_rejected' | 'missing_provider_spec' | 'missing_payment_challenge' | 'malformed_receipt' | 'unexpected_success' | 'missing_probe_blocker';
export type PayShSandboxEvidenceError = {
    code: PayShSandboxEvidenceErrorCode;
    path: string;
    message: string;
};
export type PayShSandboxEvidenceResult = {
    ok: true;
    fixture: PayShSandboxEvidenceFixture;
} | {
    ok: false;
    errors: PayShSandboxEvidenceError[];
};
export declare const PAY_SH_SANDBOX_GUARDRAILS: PayShSandboxEvidenceGuardrails;
export declare const payShSandboxEvidenceSummaries: {
    singleCharge: {
        schema: string;
        mode: "pay-sh-sandbox";
        case: "single_charge";
        artifactPath: string;
        providerSpec: string;
        providerSpecSha256: string;
        url: string;
        plainCurl: {
            status: 402;
            paymentProtocol: "mpp";
            challengeCount: number;
            priceUsd: number;
        };
        paySandboxCurl: {
            status: 200;
            bodyOk: true;
            receipt: {
                challengeId: string;
                method: "solana";
                reference: string;
                status: "success";
                timestamp: string;
            };
        };
        decodedRequest: {
            quoteRef: string;
            recipient: string;
            nonce: string;
            session: string;
            authorizationRef: string;
        };
        claimBoundary: string[];
    };
    cappedSessionProbe: {
        schema: string;
        mode: "pay-sh-sandbox-extension";
        case: "capped_session_probe";
        artifactPath: string;
        providerSpec: string;
        providerSpecSha256: string;
        url: string;
        plainCurl: {
            status: 402;
            paymentProtocol: "mpp";
            challengeCount: number;
            priceUsd: number;
        };
        paySandboxCurl: {
            status: "blocked";
            error: string;
        };
        decodedRequest: {
            quoteRef: string;
            recipient: string;
            nonce: string;
            session: string;
            authorizationRef: string;
        };
        claimBoundary: string[];
    };
    splitPaymentProbe: {
        schema: string;
        mode: "pay-sh-sandbox-extension";
        case: "split_payment_probe";
        artifactPath: string;
        providerSpec: string;
        providerSpecSha256: string;
        url: string;
        plainCurl: {
            status: 402;
            paymentProtocol: "mpp";
            challengeCount: number;
            priceUsd: number;
        };
        paySandboxCurl: {
            status: "blocked";
            error: string;
        };
        decodedRequest: {
            quoteRef: string;
            recipient: string;
            nonce: string;
            session: string;
            authorizationRef: string;
            splitRecipients: string[];
        };
        claimBoundary: string[];
    };
};
export declare function createPayShSandboxEvidenceFixture(summary: PayShSandboxEvidenceSummary): PayShSandboxEvidenceFixture;
export declare function derivePayShSandboxEvidenceFixture(summary: PayShSandboxEvidenceSummary): PayShSandboxEvidenceResult;
export declare const payShSandboxEvidenceFixtures: {
    readonly singleCharge: PayShSandboxEvidenceFixture;
    readonly cappedSessionProbe: PayShSandboxEvidenceFixture;
    readonly splitPaymentProbe: PayShSandboxEvidenceFixture;
};
