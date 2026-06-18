export type ReddiPolicyReasonCode =
  | 'allowed'
  | 'budget_policy_missing'
  | 'invalid_quote'
  | 'malformed_limit'
  | 'request_amount_exceeds_limit'
  | 'session_budget_exceeded'
  | 'source_budget_exceeded'
  | 'specialist_budget_exceeded'
  | 'asset_network_budget_exceeded'
  | 'call_count_exceeded'
  | 'unsupported_asset_network'
  | 'operator_denied'
  | 'operator_approval_required'
  | 'payment_proof_missing'
  | 'unsupported_network_asset'
  | 'malformed_receipt'
  | 'credential_leakage_rejected';

export type ReddiPolicyApprovalState =
  | 'approved'
  | 'denied'
  | 'requires_operator_approval';

export type ReddiPolicyDecision = {
  schemaVersion: 'reddi.policy-decision.v1';
  allowed: boolean;
  reasonCodes: ReddiPolicyReasonCode[];
  quotedAmount: {
    amount: string;
    asset: string;
    network: string;
    source?: string;
    specialist?: string;
  } | null;
  limits?: Record<string, string | number | boolean | null>;
  asset: string;
  network: string;
  approvalState: ReddiPolicyApprovalState;
  auditNotes: string[];
  operatorNote?: string;
};

export type BudgetPolicyDecisionLike = {
  allowed: boolean;
  reasonCodes: string[];
  quotedAmount: ReddiPolicyDecision['quotedAmount'];
  remainingBudget?: Record<string, string | number | boolean | null>;
  auditNotes: string[];
};

export const REDDI_POLICY_REASON_CODES: readonly ReddiPolicyReasonCode[] = [
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
] as const;

export function policyDecisionFromBudgetPolicyDecision(
  decision: BudgetPolicyDecisionLike,
  options: { approvalState?: ReddiPolicyApprovalState; operatorNote?: string } = {},
): ReddiPolicyDecision {
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

function normalizeReasonCodes(codes: string[]): ReddiPolicyReasonCode[] {
  return codes.map((code) => {
    if (isReddiPolicyReasonCode(code)) return code;
    throw new Error(`unsupported_policy_reason_code:${code}`);
  });
}

export function isReddiPolicyReasonCode(code: unknown): code is ReddiPolicyReasonCode {
  return typeof code === 'string' && REDDI_POLICY_REASON_CODES.includes(code as ReddiPolicyReasonCode);
}
