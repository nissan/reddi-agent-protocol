import { type EvidenceArchiveRecord } from './evidence-archive.js';
import { type ReddiPolicyDecision } from './policy.js';
import { type ReddiReceipt } from './receipts.js';
export declare const PAYMENT_CHALLENGE_SCHEMA_VERSION: "reddi.payment-challenge.v1";
export type PaymentChallengeMode = 'dry-run' | 'fixture' | 'live';
export type PaymentChallenge = {
    schemaVersion: typeof PAYMENT_CHALLENGE_SCHEMA_VERSION;
    status: 402;
    mode: PaymentChallengeMode;
    quote: {
        amount: string;
        asset: string;
        network: string;
        source: string;
        specialist: string;
    };
    payTo: string;
    nonce: string;
    endpoint: string;
    policyMetadata?: Record<string, unknown>;
};
export type BuyerPreflightReasonCode = 'buyer_policy_allowed' | 'challenge_malformed' | 'live_payment_not_approved' | 'unsupported_payment_rail' | 'budget_policy_denied' | 'budget_policy_malformed';
export type BuyerPreflightDecision = {
    allowed: boolean;
    reasonCodes: BuyerPreflightReasonCode[];
    paymentProofRef?: string;
    policyDecision?: ReddiPolicyDecision;
    auditNotes: string[];
};
export type BudgetPolicyEvaluator = (quote: PaymentChallenge['quote']) => {
    allowed: boolean;
    reasonCodes: string[];
    quotedAmount: {
        amount: string;
        asset: string;
        network: string;
        source?: string;
        specialist?: string;
    } | null;
    remainingBudget?: Record<string, string | number | boolean | null>;
    auditNotes: string[];
};
export type BuyerPreflightOptions = {
    allowedRails?: Array<{
        asset: string;
        network: string;
    }>;
    approveLivePayment?: boolean;
    paymentProofRef?: string;
    evaluateBudgetPolicy?: BudgetPolicyEvaluator;
};
export type SellerSpecialistFunction = (input: unknown) => unknown | Promise<unknown>;
export type SellerRequest = {
    body?: unknown;
    paymentProofRef?: string;
};
export type SellerResponse = {
    status: 400;
    error: {
        code: 'challenge_malformed';
        message: string;
    };
} | {
    status: 402;
    challenge: PaymentChallenge;
} | {
    status: 403;
    error: {
        code: 'live_payment_not_approved' | 'policy_denied' | 'policy_mismatch' | 'policy_not_approved' | 'policy_required';
        reasonCodes?: string[];
        message: string;
    };
} | {
    status: 200;
    result: unknown;
    receipt: ReddiReceipt;
    evidence: EvidenceArchiveRecord;
} | {
    status: 500;
    error: {
        code: 'specialist_failed';
        message: string;
    };
};
export declare function createPaymentChallenge(input: Omit<PaymentChallenge, 'schemaVersion' | 'status'>): PaymentChallenge;
export declare function evaluateBuyerPaymentChallenge(challengeInput: unknown, options?: BuyerPreflightOptions): BuyerPreflightDecision;
export declare function handlePaidSpecialistRequest(input: {
    challenge: PaymentChallenge;
    request: SellerRequest;
    specialist: SellerSpecialistFunction;
    policyDecision?: ReddiPolicyDecision;
    approveLivePayment?: boolean;
    createdAt?: string;
}): Promise<SellerResponse>;
