export declare const BUYER_AUTHORITY_POLICY_SCHEMA_VERSION: "reddi.buyer-authority-policy.v1";
export type BuyerAuthorityAsset = 'SOL' | 'USDC' | 'AUDD';
export type BuyerAuthoritySupportState = 'fixture' | 'dry-run' | 'proof-metadata-only' | 'devnet-gated' | 'live-gated';
export type BuyerAuthorityOperatorApprovalState = 'approved' | 'denied' | 'requires_operator_approval' | 'not_required';
export type BuyerAuthorityPolicyMode = 'allow' | 'deny' | 'approval-required';
export type BuyerAuthoritySpendCap = {
    asset: BuyerAuthorityAsset;
    network: string;
    maxAmountUnits: string;
    window: 'per_request' | 'daily' | 'monthly';
    approvalRequiredAboveUnits?: string;
};
export type BuyerAuthorityRailPermission = {
    asset: BuyerAuthorityAsset;
    network: string;
    supportStates: BuyerAuthoritySupportState[];
};
export type BuyerAuthorityPolicy = {
    schemaVersion: typeof BUYER_AUTHORITY_POLICY_SCHEMA_VERSION;
    issue: 549;
    policyId: string;
    mode: BuyerAuthorityPolicyMode;
    buyerAgentId: string;
    expiresAt: string;
    allowedRails: BuyerAuthorityRailPermission[];
    allowedCurrencies: BuyerAuthorityAsset[];
    spendCaps: BuyerAuthoritySpendCap[];
    sellerAllowlist: {
        sellerIds: string[];
        endpointIds: string[];
    };
    receiptEvidence: {
        receiptRequired: boolean;
        evidenceRequired: boolean;
        evidenceArchiveRequired: boolean;
    };
    refundFailurePolicy: {
        failureMode: 'no_charge_on_failure' | 'manual_review_required';
        refundMode: 'manual_review' | 'not_applicable';
        operatorReviewRequired: boolean;
    };
    operatorApproval: {
        required: boolean;
        approvalState: BuyerAuthorityOperatorApprovalState;
        thresholdAmountUnits?: string;
    };
    supportStateConstraints: {
        allowLivePayment: false;
        allowedRuntimeStates: BuyerAuthoritySupportState[];
        forbidCustody: true;
        forbidSettlementFinality: true;
    };
    notes: string[];
};
export type BuyerAuthorityPolicyEvaluationRequest = {
    sellerId: string;
    endpointId: string;
    asset: string;
    network: string;
    amountUnits: string;
    supportState: string;
    receiptPresented: boolean;
    evidencePresented: boolean;
    now: string;
    operatorApprovalState?: BuyerAuthorityOperatorApprovalState;
};
export type BuyerAuthorityPolicyReasonCode = 'buyer_authority_policy_valid' | 'policy_malformed' | 'policy_contains_credentials' | 'policy_denied' | 'policy_expired' | 'unsupported_rail_currency' | 'seller_not_allowlisted' | 'spend_cap_exceeded' | 'receipt_requirement_missing' | 'evidence_requirement_missing' | 'operator_approval_required' | 'operator_approval_denied' | 'live_payment_rejected' | 'wallet_rpc_provider_call_rejected' | 'transfer_instruction_rejected' | 'custody_claim_rejected' | 'settlement_finality_claim_rejected';
export type BuyerAuthorityPolicyEvaluation = {
    allowed: boolean;
    reasonCodes: BuyerAuthorityPolicyReasonCode[];
    auditNotes: string[];
};
export type BuyerAuthorityPolicyExampleKey = 'allow' | 'deny' | 'expired' | 'approvalRequired' | 'unsupportedRailCurrency' | 'sellerNotAllowlisted' | 'missingEvidenceRequirement';
export type BuyerAuthorityPolicyExampleCase = {
    key: BuyerAuthorityPolicyExampleKey;
    description: string;
    policy: BuyerAuthorityPolicy;
    request: BuyerAuthorityPolicyEvaluationRequest;
    expectedAllowed: boolean;
    expectedReasonCodes: BuyerAuthorityPolicyReasonCode[];
};
export declare function validateBuyerAuthorityPolicy(policy: unknown): BuyerAuthorityPolicyEvaluation;
export declare function evaluateBuyerAuthorityPolicy(policy: unknown, request: BuyerAuthorityPolicyEvaluationRequest): BuyerAuthorityPolicyEvaluation;
export declare const buyerAuthorityPolicyExamples: Record<BuyerAuthorityPolicyExampleKey, BuyerAuthorityPolicyExampleCase>;
export declare function listBuyerAuthorityPolicyExamples(): BuyerAuthorityPolicyExampleCase[];
