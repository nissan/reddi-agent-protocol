import { createHash } from 'node:crypto';
import { createEvidenceArchiveRecord, type EvidenceArchiveRecord } from './evidence-archive.js';
import { policyDecisionFromBudgetPolicyDecision, type ReddiPolicyDecision } from './policy.js';
import { createReddiReceipt, type ReddiReceipt } from './receipts.js';

export const PAYMENT_CHALLENGE_SCHEMA_VERSION = 'reddi.payment-challenge.v1' as const;

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

export type BuyerPreflightReasonCode =
  | 'buyer_policy_allowed'
  | 'challenge_malformed'
  | 'live_payment_not_approved'
  | 'unsupported_payment_rail'
  | 'budget_policy_denied'
  | 'budget_policy_malformed';

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
  allowedRails?: Array<{ asset: string; network: string }>;
  approveLivePayment?: boolean;
  paymentProofRef?: string;
  evaluateBudgetPolicy?: BudgetPolicyEvaluator;
};

export type SellerSpecialistFunction = (input: unknown) => unknown | Promise<unknown>;

export type SellerRequest = {
  body?: unknown;
  paymentProofRef?: string;
};

export type SellerResponse =
  | { status: 400; error: { code: 'challenge_malformed'; message: string } }
  | { status: 402; challenge: PaymentChallenge }
  | {
      status: 403;
      error: {
        code: 'live_payment_not_approved' | 'policy_denied' | 'policy_mismatch' | 'policy_not_approved' | 'policy_required';
        reasonCodes?: string[];
        message: string;
      };
    }
  | { status: 200; result: unknown; receipt: ReddiReceipt; evidence: EvidenceArchiveRecord }
  | { status: 500; error: { code: 'specialist_failed'; message: string } };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveAmount(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function validateChallenge(challenge: unknown): challenge is PaymentChallenge {
  if (!isPlainObject(challenge)) return false;
  if (challenge.schemaVersion !== PAYMENT_CHALLENGE_SCHEMA_VERSION || challenge.status !== 402) return false;
  if (!['dry-run', 'fixture', 'live'].includes(String(challenge.mode))) return false;
  if (!isPlainObject(challenge.quote)) return false;
  return positiveAmount(challenge.quote.amount)
    && isNonEmptyString(challenge.quote.asset)
    && isNonEmptyString(challenge.quote.network)
    && isNonEmptyString(challenge.quote.source)
    && isNonEmptyString(challenge.quote.specialist)
    && isNonEmptyString(challenge.payTo)
    && isNonEmptyString(challenge.nonce)
    && isNonEmptyString(challenge.endpoint);
}

function railAllowed(challenge: PaymentChallenge, allowedRails: BuyerPreflightOptions['allowedRails']): boolean {
  if (!allowedRails || allowedRails.length === 0) return true;
  return allowedRails.some((rail) => (
    rail.asset.toUpperCase() === challenge.quote.asset.toUpperCase()
    && rail.network.toLowerCase() === challenge.quote.network.toLowerCase()
  ));
}

function defaultPolicyDecision(challenge: PaymentChallenge): ReddiPolicyDecision {
  return {
    schemaVersion: 'reddi.policy-decision.v1',
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: {
      amount: challenge.quote.amount,
      asset: challenge.quote.asset,
      network: challenge.quote.network,
      source: challenge.quote.source,
      specialist: challenge.quote.specialist,
    },
    limits: {},
    asset: challenge.quote.asset,
    network: challenge.quote.network,
    approvalState: 'approved',
    auditNotes: ['Allowed: local buyer preflight accepted the dry-run challenge.'],
  };
}

function policyMatchesChallenge(policyDecision: ReddiPolicyDecision, challenge: PaymentChallenge): boolean {
  const quoted = policyDecision.quotedAmount;
  return policyDecision.allowed
    && policyDecision.approvalState === 'approved'
    && quoted !== null
    && quoted.amount === challenge.quote.amount
    && quoted.asset.toUpperCase() === challenge.quote.asset.toUpperCase()
    && quoted.network.toLowerCase() === challenge.quote.network.toLowerCase()
    && quoted.source === challenge.quote.source
    && quoted.specialist === challenge.quote.specialist
    && policyDecision.asset.toUpperCase() === challenge.quote.asset.toUpperCase()
    && policyDecision.network.toLowerCase() === challenge.quote.network.toLowerCase();
}

export function createPaymentChallenge(input: Omit<PaymentChallenge, 'schemaVersion' | 'status'>): PaymentChallenge {
  const challenge: PaymentChallenge = {
    schemaVersion: PAYMENT_CHALLENGE_SCHEMA_VERSION,
    status: 402,
    ...input,
  };
  if (!validateChallenge(challenge)) throw new Error('invalid_payment_challenge');
  return challenge;
}

export function evaluateBuyerPaymentChallenge(
  challengeInput: unknown,
  options: BuyerPreflightOptions = {},
): BuyerPreflightDecision {
  if (!validateChallenge(challengeInput)) {
    return {
      allowed: false,
      reasonCodes: ['challenge_malformed'],
      auditNotes: ['Denied: payment challenge is malformed.'],
    };
  }
  const challenge = challengeInput;
  if (challenge.mode === 'live' && !options.approveLivePayment) {
    return {
      allowed: false,
      reasonCodes: ['live_payment_not_approved'],
      auditNotes: ['Denied: live payment requires explicit buyer approval.'],
    };
  }
  if (!railAllowed(challenge, options.allowedRails)) {
    return {
      allowed: false,
      reasonCodes: ['unsupported_payment_rail'],
      auditNotes: [`Denied: ${challenge.quote.asset} on ${challenge.quote.network} is not allowed by buyer rails.`],
    };
  }

  if (options.evaluateBudgetPolicy) {
    let budgetDecision: ReturnType<BudgetPolicyEvaluator>;
    let policyDecision: ReddiPolicyDecision;
    try {
      budgetDecision = options.evaluateBudgetPolicy(challenge.quote);
      policyDecision = policyDecisionFromBudgetPolicyDecision(budgetDecision);
    } catch (err) {
      return {
        allowed: false,
        reasonCodes: ['budget_policy_malformed'],
        auditNotes: [err instanceof Error ? `Denied: budget policy output is malformed: ${err.message}` : 'Denied: budget policy output is malformed.'],
      };
    }
    if (!budgetDecision.allowed) {
      return {
        allowed: false,
        reasonCodes: ['budget_policy_denied'],
        policyDecision,
        auditNotes: budgetDecision.auditNotes ?? ['Denied: local budget policy rejected the challenge.'],
      };
    }
    return {
      allowed: true,
      reasonCodes: ['buyer_policy_allowed'],
      paymentProofRef: options.paymentProofRef ?? `dry-run:${challenge.nonce}`,
      policyDecision,
      auditNotes: budgetDecision.auditNotes ?? ['Allowed: local budget policy accepted the challenge.'],
    };
  }

  return {
    allowed: true,
    reasonCodes: ['buyer_policy_allowed'],
    paymentProofRef: options.paymentProofRef ?? `dry-run:${challenge.nonce}`,
    policyDecision: defaultPolicyDecision(challenge),
    auditNotes: ['Allowed: no local budget policy evaluator was supplied for this dry-run challenge.'],
  };
}

export async function handlePaidSpecialistRequest(input: {
  challenge: PaymentChallenge;
  request: SellerRequest;
  specialist: SellerSpecialistFunction;
  policyDecision?: ReddiPolicyDecision;
  approveLivePayment?: boolean;
  createdAt?: string;
}): Promise<SellerResponse> {
  if (!validateChallenge(input.challenge)) {
    return {
      status: 400,
      error: {
        code: 'challenge_malformed',
        message: 'payment challenge is malformed',
      },
    };
  }
  if (!input.request.paymentProofRef) {
    return { status: 402, challenge: input.challenge };
  }
  if (input.challenge.mode === 'live' && !input.approveLivePayment) {
    return {
      status: 403,
      error: {
        code: 'live_payment_not_approved',
        message: 'live payment requires explicit seller approval before execution',
      },
    };
  }
  if (!input.policyDecision) {
    return {
      status: 403,
      error: {
        code: 'policy_required',
        message: 'an approved buyer policy decision is required before execution',
      },
    };
  }
  if (!input.policyDecision.allowed) {
    return {
      status: 403,
      error: {
        code: 'policy_denied',
        reasonCodes: input.policyDecision.reasonCodes,
        message: 'policy decision denied this paid specialist request',
      },
    };
  }
  if (input.policyDecision.approvalState !== 'approved') {
    return {
      status: 403,
      error: {
        code: 'policy_not_approved',
        reasonCodes: input.policyDecision.reasonCodes,
        message: 'policy decision must be approved before specialist execution',
      },
    };
  }
  if (!policyMatchesChallenge(input.policyDecision, input.challenge)) {
    return {
      status: 403,
      error: {
        code: 'policy_mismatch',
        reasonCodes: input.policyDecision.reasonCodes,
        message: 'policy decision does not match this payment challenge',
      },
    };
  }

  try {
    const result = await input.specialist(input.request.body);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const requestHash = hashJson(input.request.body ?? null);
    const responseHash = hashJson(result);
    const evidencePayload = { requestHash, responseHash, resultSummary: result };
    const evidence = createEvidenceArchiveRecord({
      id: `evidence:${input.challenge.nonce}`,
      receiptId: `receipt:${input.challenge.nonce}`,
      sourceId: input.challenge.quote.source,
      requestHash,
      responseHash,
      evidenceRef: `file://fixtures/evidence/${input.challenge.nonce}.json`,
      createdAt,
      evidencePayload,
    });
    const receipt = createReddiReceipt({
      schemaVersion: 'reddi.receipt.v1',
      job: { id: `job:${input.challenge.nonce}`, type: 'specialist-call' },
      source: { id: input.challenge.quote.source, type: 'seller-middleware', uri: input.challenge.endpoint },
      payer: { id: 'buyer:local-dry-run' },
      specialist: { id: input.challenge.quote.specialist, endpoint: input.challenge.endpoint },
      protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
      payment: {
        network: input.challenge.quote.network,
        asset: input.challenge.quote.asset,
        amount: input.challenge.quote.amount,
        paymentProofRef: input.request.paymentProofRef,
      },
      requestHash,
      responseHash,
      evidenceRef: evidence.evidenceRef,
      policyDecision: input.policyDecision,
      attestationStatus: 'not_requested',
      createdAt,
    });
    return { status: 200, result, receipt, evidence };
  } catch (err) {
    return {
      status: 500,
      error: {
        code: 'specialist_failed',
        message: err instanceof Error ? err.message : 'specialist failed',
      },
    };
  }
}
