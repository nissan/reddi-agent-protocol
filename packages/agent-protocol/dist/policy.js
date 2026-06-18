export const REDDI_POLICY_REASON_CODES = [
    'allowed',
    'budget_policy_missing',
    'invalid_quote',
    'malformed_limit',
    'request_amount_exceeds_limit',
    'session_budget_exceeded',
    'source_budget_exceeded',
    'specialist_budget_exceeded',
    'asset_network_budget_exceeded',
    'call_count_exceeded',
    'unsupported_asset_network',
    'operator_denied',
    'operator_approval_required',
    'payment_proof_missing',
    'unsupported_network_asset',
    'malformed_receipt',
    'credential_leakage_rejected',
];
export function policyDecisionFromBudgetPolicyDecision(decision, options = {}) {
    const asset = decision.quotedAmount?.asset ?? 'unknown';
    const network = decision.quotedAmount?.network ?? 'unknown';
    return {
        schemaVersion: 'reddi.policy-decision.v1',
        allowed: decision.allowed,
        reasonCodes: normalizeReasonCodes(decision.reasonCodes),
        quotedAmount: decision.quotedAmount,
        limits: decision.remainingBudget,
        asset,
        network,
        approvalState: options.approvalState ?? (decision.allowed ? 'approved' : 'denied'),
        auditNotes: decision.auditNotes,
        operatorNote: options.operatorNote,
    };
}
function normalizeReasonCodes(codes) {
    return codes.map((code) => {
        if (isReddiPolicyReasonCode(code))
            return code;
        throw new Error(`unsupported_policy_reason_code:${code}`);
    });
}
export function isReddiPolicyReasonCode(code) {
    return typeof code === 'string' && REDDI_POLICY_REASON_CODES.includes(code);
}
