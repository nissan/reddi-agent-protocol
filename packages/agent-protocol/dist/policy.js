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
    return codes.map((code) => code);
}
