export type BudgetPolicyAmount = bigint | number | string;
export type BudgetPolicyReasonCode = 'allowed' | 'budget_policy_missing' | 'invalid_quote' | 'malformed_limit' | 'request_amount_exceeds_limit' | 'session_budget_exceeded' | 'source_budget_exceeded' | 'specialist_budget_exceeded' | 'asset_network_budget_exceeded' | 'call_count_exceeded' | 'unsupported_asset_network';
export type BudgetPolicyAssetNetwork = {
    asset: string;
    network: string;
};
export type BudgetAmountLimit = {
    /** Maximum spend in the asset's smallest unit. */
    maxAmount: BudgetPolicyAmount;
    note?: string;
};
export type BudgetAssetNetworkLimit = BudgetPolicyAssetNetwork & BudgetAmountLimit;
export type BudgetCallCountLimit = {
    maxCalls: number;
    note?: string;
};
export type BudgetPolicy = {
    schemaVersion: 'reddi.budget-policy.v1';
    limits: {
        perRequest?: BudgetAmountLimit;
        perSession?: BudgetAmountLimit;
        perSource?: Record<string, BudgetAmountLimit>;
        perSpecialist?: Record<string, BudgetAmountLimit>;
        perAssetNetwork?: BudgetAssetNetworkLimit[];
        callCount?: BudgetCallCountLimit;
    };
};
export type BudgetPolicyUsage = {
    sessionSpent?: BudgetPolicyAmount;
    sourceSpent?: Record<string, BudgetPolicyAmount>;
    specialistSpent?: Record<string, BudgetPolicyAmount>;
    assetNetworkSpent?: Record<string, BudgetPolicyAmount>;
    callCount?: number;
};
export type BudgetPolicyQuote = BudgetPolicyAssetNetwork & {
    /** Quoted spend in the asset's smallest unit. */
    amount: BudgetPolicyAmount;
    source?: string;
    specialist?: string;
};
export type BudgetRemaining = {
    perRequest?: string;
    perSession?: string;
    perSource?: string;
    perSpecialist?: string;
    perAssetNetwork?: string;
    callCount?: number;
};
export type BudgetPolicyDecision = {
    schemaVersion: 'reddi.budget-policy-decision.v1';
    allowed: boolean;
    reasonCodes: BudgetPolicyReasonCode[];
    quotedAmount: {
        amount: string;
        asset: string;
        network: string;
        source?: string;
        specialist?: string;
    } | null;
    remainingBudget: BudgetRemaining;
    auditNotes: string[];
};
export declare function evaluateBudgetPolicy(input: {
    policy?: BudgetPolicy | null;
    quote: BudgetPolicyQuote;
    usage?: BudgetPolicyUsage;
}): BudgetPolicyDecision;
export declare function assetNetworkKey(asset: string, network: string): string;
