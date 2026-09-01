import { AUDD_ASSET, AUDD_DECIMALS, type AuddRailEnvironment } from './audd-rail-config.js';
import { type ReddiPaymentEligibilityLabel, type ReddiPaymentEnvironmentLabel, type ReddiPaymentIntentRecord, type ReddiPaymentRecordLabels } from './payment-records.js';
import { type BudgetPolicyEvaluator, type PaymentChallenge } from './buyer-seller.js';
import type { ReddiPolicyApprovalState, ReddiPolicyDecision } from './policy.js';
export { AUDD_ASSET } from './audd-rail-config.js';
export declare const AUDD_PAYMENT_PLAN_SCHEMA_VERSION: "reddi.audd-payment-plan.v1";
export declare const AUDD_X402_SVM_EXACT_PAYMENT_REQUIRED_SCHEMA_VERSION: "reddi.audd-x402-svm-exact-payment-required.v1";
export declare const AUDD_X402_VERSION: 2;
export declare const AUDD_X402_SCHEME: "exact";
export declare const AUDD_X402_PAYMENT_FLOW: "upfront";
export type AuddPaymentPlanAuthority = {
    /** Models may draft this intent only; spend authority must come from policy + operator approval. */
    modelRole: 'draft_only';
    authorizationState: 'model_draft' | 'policy_approved' | 'operator_approved';
    operatorApprovalRequired: boolean;
    operatorApprovalRef?: string;
    policyDecisionRef?: string;
};
export type AuddSolanaPaymentPlan = {
    schemaVersion: typeof AUDD_PAYMENT_PLAN_SCHEMA_VERSION;
    asset: typeof AUDD_ASSET;
    /** Legacy RAP network alias retained for existing callers. x402 v2 uses caip2Network. */
    network: string;
    caip2Network?: string;
    mint: string;
    tokenProgram?: string;
    decimals?: typeof AUDD_DECIMALS;
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
        refundAddress?: string;
    };
    evidenceRequired: boolean;
    paymentMode: 'dry-run' | 'live';
    /** Present on the AUDD x402 v2 SVM exact bridge; omitted for legacy v1-compatible plans. */
    x402Version?: typeof AUDD_X402_VERSION;
    scheme?: typeof AUDD_X402_SCHEME;
    paymentFlow?: typeof AUDD_X402_PAYMENT_FLOW;
    maxTimeoutSeconds?: number;
    memo?: string;
    railEnvironment?: AuddRailEnvironment;
    eligibility?: ReddiPaymentEligibilityLabel;
    authority?: AuddPaymentPlanAuthority;
    paymentIntentId?: string;
    evidence?: {
        required: boolean;
        observationSchema?: string;
        fixtureAndDevnetIneligible: true;
    };
};
export type AuddPaymentPlanInput = Omit<AuddSolanaPaymentPlan, 'schemaVersion' | 'asset'> & {
    asset?: typeof AUDD_ASSET;
};
export type AuddX402Resource = {
    url: string;
    description?: string;
    mimeType?: string;
    serviceName?: string;
};
export type AuddX402SvmExactAccept = {
    scheme: typeof AUDD_X402_SCHEME;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: {
        symbol: typeof AUDD_ASSET;
        decimals: typeof AUDD_DECIMALS;
        tokenProgram: string;
        rapNetworkAlias: string;
        destinationTokenAccount?: string;
        quoteExpiresAt: string;
        memo: string;
        paymentFlow: typeof AUDD_X402_PAYMENT_FLOW;
        receiptRequired: true;
        evidenceRequired: boolean;
        paymentIntentId: string;
        modelAuthority: 'draft_only';
        operatorApprovalRequired: boolean;
        refundPolicy: AuddSolanaPaymentPlan['refundPolicy'];
        failurePolicy: AuddSolanaPaymentPlan['failurePolicy'];
        environment: ReddiPaymentEnvironmentLabel;
        eligibility: ReddiPaymentEligibilityLabel;
    };
};
export type AuddX402SvmExactPaymentRequired = {
    schemaVersion: typeof AUDD_X402_SVM_EXACT_PAYMENT_REQUIRED_SCHEMA_VERSION;
    x402Version: typeof AUDD_X402_VERSION;
    resource: AuddX402Resource;
    accepts: [AuddX402SvmExactAccept, ...AuddX402SvmExactAccept[]];
    extensions: {
        reddi: {
            schemaVersion: typeof AUDD_PAYMENT_PLAN_SCHEMA_VERSION;
            paymentIntentId: string;
            legacyPlanCompatible: true;
            modelMayAuthorize: false;
            mainnetDisabledByDefault: true;
        };
    };
};
export type AuddPaymentPlanPreflightReasonCode = 'audd_payment_plan_allowed' | 'challenge_malformed' | 'missing_audd_payment_plan' | 'payment_plan_malformed' | 'credential_leakage_rejected' | 'buyer_policy_missing' | 'quote_payment_plan_mismatch' | 'wrong_asset' | 'wrong_network' | 'wrong_mint' | 'wrong_token_program' | 'wrong_x402_scheme' | 'missing_payee' | 'quote_expired' | 'evidence_required' | 'operator_approval_required' | 'live_payment_not_approved' | 'mainnet_audd_disabled' | 'devnet_audd_unverified' | 'blocked_rail_environment' | 'grant_eligibility_blocked' | 'model_authorization_rejected' | 'amount_exceeds_max' | 'budget_policy_denied' | 'budget_policy_malformed' | 'unsupported_payment_rail';
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
    allowedCaip2Networks?: string[];
    allowedMints?: string[];
    allowedTokenPrograms?: string[];
    allowedPayees?: string[];
    allowedSettlementAccounts?: string[];
    allowedRailEnvironments?: AuddRailEnvironment[];
    maxAmount?: string;
    requireEvidence?: boolean;
    requireX402Exact?: boolean;
    approvalState?: ReddiPolicyApprovalState;
    approveLivePayment?: boolean;
    /** Separate mainnet-AUDD gate; approveLivePayment alone is deliberately insufficient. */
    approveMainnetAudd?: boolean;
    paymentProofRef?: string;
    now?: string | Date;
    evaluateBudgetPolicy?: BudgetPolicyEvaluator;
};
export declare function validateAuddSolanaPaymentPlan(value: unknown): value is AuddSolanaPaymentPlan;
export declare function createAuddSolanaPaymentPlan(input: AuddPaymentPlanInput): AuddSolanaPaymentPlan;
export declare function createAuddX402SvmExactPaymentPlan(input: AuddPaymentPlanInput): AuddSolanaPaymentPlan;
export declare function createAuddPaymentChallenge(input: Omit<PaymentChallenge, 'schemaVersion' | 'status' | 'quote' | 'payTo' | 'policyMetadata'> & {
    paymentPlan: AuddSolanaPaymentPlan;
    quote?: Partial<PaymentChallenge['quote']>;
    payTo?: string;
    policyMetadata?: Record<string, unknown>;
}): PaymentChallenge;
export declare function createAuddPaymentIntentDraft(input: {
    agreementId: string;
    paymentPlan: AuddSolanaPaymentPlan;
    destinationTokenAccount?: string;
    memo?: string;
    createdAt?: string;
    labels?: ReddiPaymentRecordLabels;
}): ReddiPaymentIntentRecord;
export declare function createAuddX402SvmExactPaymentRequired(input: {
    paymentPlan: AuddSolanaPaymentPlan;
    paymentIntent: ReddiPaymentIntentRecord;
    resource: AuddX402Resource;
    maxTimeoutSeconds?: number;
}): AuddX402SvmExactPaymentRequired;
export declare function validateAuddX402SvmExactPaymentRequired(value: unknown): value is AuddX402SvmExactPaymentRequired;
export declare function evaluateAuddPaymentPlanPreflight(challengeInput: unknown, options?: AuddPaymentPlanPreflightOptions): AuddPaymentPlanPreflightDecision;
