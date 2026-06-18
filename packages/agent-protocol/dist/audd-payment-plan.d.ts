import { type BudgetPolicyEvaluator, type PaymentChallenge } from './buyer-seller.js';
import type { ReddiPolicyApprovalState, ReddiPolicyDecision } from './policy.js';
export declare const AUDD_PAYMENT_PLAN_SCHEMA_VERSION: "reddi.audd-payment-plan.v1";
export declare const AUDD_ASSET: "AUDD";
export type AuddSolanaPaymentPlan = {
    schemaVersion: typeof AUDD_PAYMENT_PLAN_SCHEMA_VERSION;
    asset: typeof AUDD_ASSET;
    network: string;
    mint: string;
    payee: string;
    settlementAccount: string;
    amount: string;
    quoteExpiresAt: string;
    failurePolicy: {
        mode: 'no_charge_on_failure' | 'refund_on_failure' | 'manual_review';
        description: string;
    };
    refundPolicy: {
        mode: 'none' | 'automatic' | 'manual_review';
        description: string;
    };
    evidenceRequired: boolean;
    paymentMode: 'dry-run' | 'live';
};
export type AuddPaymentPlanInput = Omit<AuddSolanaPaymentPlan, 'schemaVersion' | 'asset'> & {
    asset?: typeof AUDD_ASSET;
};
export type AuddPaymentPlanPreflightReasonCode = 'audd_payment_plan_allowed' | 'challenge_malformed' | 'missing_audd_payment_plan' | 'payment_plan_malformed' | 'credential_leakage_rejected' | 'buyer_policy_missing' | 'quote_payment_plan_mismatch' | 'wrong_asset' | 'wrong_network' | 'wrong_mint' | 'missing_payee' | 'quote_expired' | 'evidence_required' | 'operator_approval_required' | 'live_payment_not_approved' | 'amount_exceeds_max' | 'budget_policy_denied' | 'budget_policy_malformed' | 'unsupported_payment_rail';
export type AuddPaymentPlanPreflightDecision = {
    allowed: boolean;
    reasonCodes: AuddPaymentPlanPreflightReasonCode[];
    paymentProofRef?: string;
    policyDecision?: ReddiPolicyDecision;
    paymentPlan?: AuddSolanaPaymentPlan;
    auditNotes: string[];
};
export type AuddPaymentPlanPreflightOptions = {
    allowedNetworks?: string[];
    allowedMints?: string[];
    allowedPayees?: string[];
    allowedSettlementAccounts?: string[];
    maxAmount?: string;
    requireEvidence?: boolean;
    approvalState?: ReddiPolicyApprovalState;
    approveLivePayment?: boolean;
    paymentProofRef?: string;
    now?: string | Date;
    evaluateBudgetPolicy?: BudgetPolicyEvaluator;
};
export declare function validateAuddSolanaPaymentPlan(value: unknown): value is AuddSolanaPaymentPlan;
export declare function createAuddSolanaPaymentPlan(input: AuddPaymentPlanInput): AuddSolanaPaymentPlan;
export declare function createAuddPaymentChallenge(input: Omit<PaymentChallenge, 'schemaVersion' | 'status' | 'quote' | 'payTo' | 'policyMetadata'> & {
    paymentPlan: AuddSolanaPaymentPlan;
    quote?: Partial<PaymentChallenge['quote']>;
    payTo?: string;
    policyMetadata?: Record<string, unknown>;
}): PaymentChallenge;
export declare function evaluateAuddPaymentPlanPreflight(challengeInput: unknown, options?: AuddPaymentPlanPreflightOptions): AuddPaymentPlanPreflightDecision;
