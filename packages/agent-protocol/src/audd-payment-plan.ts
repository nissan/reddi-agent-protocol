import {
  evaluateBuyerPaymentChallenge,
  PAYMENT_CHALLENGE_SCHEMA_VERSION,
  type BudgetPolicyEvaluator,
  type BuyerPreflightDecision,
  type PaymentChallenge,
} from './buyer-seller.js';
import type { ReddiPolicyApprovalState, ReddiPolicyDecision } from './policy.js';

export const AUDD_PAYMENT_PLAN_SCHEMA_VERSION = 'reddi.audd-payment-plan.v1' as const;
export const AUDD_ASSET = 'AUDD' as const;

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

export type AuddPaymentPlanPreflightReasonCode =
  | 'audd_payment_plan_allowed'
  | 'challenge_malformed'
  | 'missing_audd_payment_plan'
  | 'payment_plan_malformed'
  | 'credential_leakage_rejected'
  | 'buyer_policy_missing'
  | 'quote_payment_plan_mismatch'
  | 'wrong_asset'
  | 'wrong_network'
  | 'wrong_mint'
  | 'missing_payee'
  | 'quote_expired'
  | 'evidence_required'
  | 'operator_approval_required'
  | 'live_payment_not_approved'
  | 'amount_exceeds_max'
  | 'budget_policy_denied'
  | 'budget_policy_malformed'
  | 'unsupported_payment_rail';

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

const CREDENTIAL_KEYS = new Set([
  'api_key',
  'apikey',
  'access_token',
  'auth',
  'authorization',
  'bearer',
  'credential',
  'password',
  'private_key',
  'secret',
  'signature',
  'sig',
  'token',
  'x-amz-signature',
  'x-goog-signature',
]);

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

function amountToBigInt(value: string): bigint {
  return BigInt(value);
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function hasOnlyNonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function containsCredentialMaterial(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.username || url.password) return true;
      for (const [key, item] of url.searchParams.entries()) {
        if (CREDENTIAL_KEYS.has(normalized(key))) return true;
        if (/bearer\s+[a-z0-9._-]+/i.test(item)) return true;
      }
    } catch {
      if (/bearer\s+[a-z0-9._-]+/i.test(value)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.some((item) => containsCredentialMaterial(item, seen));
  }
  if (!isPlainObject(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, item]) => (
    CREDENTIAL_KEYS.has(normalized(key)) || containsCredentialMaterial(item, seen)
  ));
}

function containsCircularReference(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (Array.isArray(value)) {
    if (seen.has(value)) return true;
    seen.add(value);
    return value.some((item) => containsCircularReference(item, seen));
  }
  if (!isPlainObject(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.values(value).some((item) => containsCircularReference(item, seen));
}

function isPaymentChallenge(value: unknown): value is PaymentChallenge {
  if (!isPlainObject(value)) return false;
  if (value.schemaVersion !== PAYMENT_CHALLENGE_SCHEMA_VERSION || value.status !== 402) return false;
  if (!['dry-run', 'fixture', 'live'].includes(String(value.mode))) return false;
  if (!isPlainObject(value.quote)) return false;
  return positiveAmount(value.quote.amount)
    && isNonEmptyString(value.quote.asset)
    && isNonEmptyString(value.quote.network)
    && isNonEmptyString(value.quote.source)
    && isNonEmptyString(value.quote.specialist)
    && isNonEmptyString(value.payTo)
    && isNonEmptyString(value.nonce)
    && isNonEmptyString(value.endpoint);
}

function validatePolicyText(value: unknown): value is AuddSolanaPaymentPlan['failurePolicy'] {
  if (!isPlainObject(value)) return false;
  return ['no_charge_on_failure', 'refund_on_failure', 'manual_review'].includes(String(value.mode))
    && isNonEmptyString(value.description);
}

function validateRefundText(value: unknown): value is AuddSolanaPaymentPlan['refundPolicy'] {
  if (!isPlainObject(value)) return false;
  return ['none', 'automatic', 'manual_review'].includes(String(value.mode))
    && isNonEmptyString(value.description);
}

export function validateAuddSolanaPaymentPlan(value: unknown): value is AuddSolanaPaymentPlan {
  if (!isPlainObject(value)) return false;
  if (value.schemaVersion !== AUDD_PAYMENT_PLAN_SCHEMA_VERSION) return false;
  if (value.asset !== AUDD_ASSET) return false;
  if (!isNonEmptyString(value.network)) return false;
  if (!isNonEmptyString(value.mint)) return false;
  if (!isNonEmptyString(value.payee)) return false;
  if (!isNonEmptyString(value.settlementAccount)) return false;
  if (!positiveAmount(value.amount)) return false;
  if (!isNonEmptyString(value.quoteExpiresAt) || Number.isNaN(Date.parse(value.quoteExpiresAt))) return false;
  if (!validatePolicyText(value.failurePolicy)) return false;
  if (!validateRefundText(value.refundPolicy)) return false;
  if (typeof value.evidenceRequired !== 'boolean') return false;
  if (!['dry-run', 'live'].includes(String(value.paymentMode))) return false;
  if (containsCircularReference(value)) return false;
  return !containsCredentialMaterial(value);
}

export function createAuddSolanaPaymentPlan(input: AuddPaymentPlanInput): AuddSolanaPaymentPlan {
  const plan: AuddSolanaPaymentPlan = {
    schemaVersion: AUDD_PAYMENT_PLAN_SCHEMA_VERSION,
    asset: AUDD_ASSET,
    ...input,
  };
  if (!validateAuddSolanaPaymentPlan(plan)) throw new Error('invalid_audd_payment_plan');
  return plan;
}

export function createAuddPaymentChallenge(
  input: Omit<PaymentChallenge, 'schemaVersion' | 'status' | 'quote' | 'payTo' | 'policyMetadata'> & {
    paymentPlan: AuddSolanaPaymentPlan;
    quote?: Partial<PaymentChallenge['quote']>;
    payTo?: string;
    policyMetadata?: Record<string, unknown>;
  },
): PaymentChallenge {
  const { paymentPlan, quote, payTo, policyMetadata, ...rest } = input;
  if (!validateAuddSolanaPaymentPlan(paymentPlan)) throw new Error('invalid_audd_payment_plan');
  const challenge: PaymentChallenge = {
    schemaVersion: PAYMENT_CHALLENGE_SCHEMA_VERSION,
    status: 402,
    ...rest,
    quote: {
      amount: paymentPlan.amount,
      asset: AUDD_ASSET,
      network: paymentPlan.network,
      source: quote?.source ?? '',
      specialist: quote?.specialist ?? '',
    },
    payTo: payTo ?? paymentPlan.payee,
    policyMetadata: {
      ...policyMetadata,
      auddPaymentPlan: paymentPlan,
    },
  };
  if (!isPaymentChallenge(challenge)) throw new Error('invalid_payment_challenge');
  return challenge;
}

function planFromChallenge(challenge: PaymentChallenge): AuddSolanaPaymentPlan | undefined {
  const plan = isPlainObject(challenge.policyMetadata)
    ? challenge.policyMetadata.auddPaymentPlan
    : undefined;
  return validateAuddSolanaPaymentPlan(plan) ? plan : undefined;
}

function deny(
  reasonCode: AuddPaymentPlanPreflightReasonCode,
  auditNote: string,
  extras: Partial<AuddPaymentPlanPreflightDecision> = {},
): AuddPaymentPlanPreflightDecision {
  return {
    allowed: false,
    reasonCodes: [reasonCode],
    auditNotes: [auditNote],
    ...extras,
  };
}

function adaptBuyerDecision(
  decision: BuyerPreflightDecision,
  plan: AuddSolanaPaymentPlan,
  challenge: PaymentChallenge,
): AuddPaymentPlanPreflightDecision {
  if (decision.allowed) {
    const quoted = decision.policyDecision?.quotedAmount;
    const matchesAuddPlan = decision.policyDecision?.allowed === true
      && decision.policyDecision.approvalState === 'approved'
      && quoted !== null
      && quoted?.amount === plan.amount
      && quoted.asset.toUpperCase() === AUDD_ASSET
      && quoted.asset.toUpperCase() === challenge.quote.asset.toUpperCase()
      && quoted.network.toLowerCase() === plan.network.toLowerCase()
      && quoted.network.toLowerCase() === challenge.quote.network.toLowerCase()
      && quoted.source === challenge.quote.source
      && quoted.specialist === challenge.quote.specialist
      && decision.policyDecision.asset.toUpperCase() === AUDD_ASSET
      && decision.policyDecision.network.toLowerCase() === plan.network.toLowerCase();
    if (!matchesAuddPlan) {
      return {
        allowed: false,
        reasonCodes: ['budget_policy_malformed'],
        policyDecision: decision.policyDecision,
        paymentPlan: plan,
        auditNotes: ['Denied: buyer budget policy decision did not match the AUDD payment plan quote.'],
      };
    }
    return {
      allowed: true,
      reasonCodes: ['audd_payment_plan_allowed'],
      paymentProofRef: decision.paymentProofRef,
      policyDecision: decision.policyDecision,
      paymentPlan: plan,
      auditNotes: decision.auditNotes,
    };
  }

  const mapped = decision.reasonCodes.includes('budget_policy_malformed')
    ? 'budget_policy_malformed'
    : decision.reasonCodes.includes('budget_policy_denied')
      ? 'budget_policy_denied'
      : decision.reasonCodes.includes('live_payment_not_approved')
        ? 'live_payment_not_approved'
        : decision.reasonCodes.includes('unsupported_payment_rail')
          ? 'unsupported_payment_rail'
          : 'challenge_malformed';
  return {
    allowed: false,
    reasonCodes: [mapped],
    policyDecision: decision.policyDecision,
    paymentPlan: plan,
    auditNotes: decision.auditNotes,
  };
}

export function evaluateAuddPaymentPlanPreflight(
  challengeInput: unknown,
  options: AuddPaymentPlanPreflightOptions = {},
): AuddPaymentPlanPreflightDecision {
  if (!isPaymentChallenge(challengeInput)) {
    return deny('challenge_malformed', 'Denied: payment challenge is malformed.');
  }
  const challenge = challengeInput;
  const rawPlan = isPlainObject(challenge.policyMetadata)
    ? challenge.policyMetadata.auddPaymentPlan
    : undefined;
  if (rawPlan === undefined) {
    return deny('missing_audd_payment_plan', 'Denied: AUDD/Solana payment plan metadata is missing.');
  }
  if (containsCredentialMaterial(rawPlan)) {
    return deny('credential_leakage_rejected', 'Denied: AUDD/Solana payment plan includes credential-bearing material.');
  }
  const plan = planFromChallenge(challenge);
  if (!plan) {
    return deny('payment_plan_malformed', 'Denied: AUDD/Solana payment plan metadata is malformed.');
  }
  if (challenge.quote.asset.toUpperCase() !== AUDD_ASSET) {
    return deny('wrong_asset', 'Denied: challenge quote asset is not AUDD.', { paymentPlan: plan });
  }
  if (challenge.quote.amount !== plan.amount || challenge.quote.network !== plan.network || challenge.payTo !== plan.payee) {
    return deny('quote_payment_plan_mismatch', 'Denied: challenge quote/payee does not match the AUDD payment plan.', { paymentPlan: plan });
  }
  if (challenge.mode !== plan.paymentMode) {
    return deny('quote_payment_plan_mismatch', 'Denied: challenge mode does not match the AUDD payment plan mode.', { paymentPlan: plan });
  }
  if (!hasOnlyNonEmptyStrings(options.allowedNetworks)) {
    return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD/Solana networks.', { paymentPlan: plan });
  }
  if (!hasOnlyNonEmptyStrings(options.allowedMints)) {
    return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD mints.', { paymentPlan: plan });
  }
  if (!hasOnlyNonEmptyStrings(options.allowedPayees)) {
    return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD payees.', { paymentPlan: plan });
  }
  if (!hasOnlyNonEmptyStrings(options.allowedSettlementAccounts)) {
    return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD settlement accounts.', { paymentPlan: plan });
  }
  if (options.requireEvidence !== true) {
    return deny('buyer_policy_missing', 'Denied: buyer policy must explicitly require evidence for AUDD payment plans.', { paymentPlan: plan });
  }
  if (!options.maxAmount && !options.evaluateBudgetPolicy) {
    return deny('buyer_policy_missing', 'Denied: buyer policy must declare max AUDD amount or provide a budget evaluator.', { paymentPlan: plan });
  }
  if (!options.allowedNetworks.some((network) => normalized(network) === normalized(plan.network))) {
    return deny('wrong_network', `Denied: ${plan.network} is not an allowed AUDD/Solana network.`, { paymentPlan: plan });
  }
  if (!options.allowedMints.some((mint) => normalized(mint) === normalized(plan.mint))) {
    return deny('wrong_mint', 'Denied: AUDD mint is not allowed by buyer policy.', { paymentPlan: plan });
  }
  if (!options.allowedPayees.some((payee) => payee === plan.payee)) {
    return deny('missing_payee', 'Denied: AUDD payee is not allowed by buyer policy.', { paymentPlan: plan });
  }
  if (!options.allowedSettlementAccounts.some((account) => account === plan.settlementAccount)) {
    return deny('missing_payee', 'Denied: AUDD settlement account is not allowed by buyer policy.', { paymentPlan: plan });
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime()) || Date.parse(plan.quoteExpiresAt) <= now.getTime()) {
    return deny('quote_expired', 'Denied: AUDD quote is expired.', { paymentPlan: plan });
  }
  if (options.requireEvidence && !plan.evidenceRequired) {
    return deny('evidence_required', 'Denied: buyer policy requires evidence for AUDD payment plans.', { paymentPlan: plan });
  }
  if (options.approvalState !== 'approved') {
    return deny('operator_approval_required', 'Denied: AUDD/Solana payment plan requires explicit operator approval.', { paymentPlan: plan });
  }
  if (challenge.mode === 'live' && !options.approveLivePayment) {
    return deny('live_payment_not_approved', 'Denied: live AUDD/Solana payment remains disabled without explicit approval.', { paymentPlan: plan });
  }
  if (options.maxAmount && !positiveAmount(options.maxAmount)) {
    return deny('payment_plan_malformed', 'Denied: buyer maximum amount is malformed.', { paymentPlan: plan });
  }
  if (options.maxAmount && amountToBigInt(plan.amount) > amountToBigInt(options.maxAmount)) {
    return deny('amount_exceeds_max', 'Denied: AUDD payment plan amount exceeds buyer maximum.', { paymentPlan: plan });
  }

  const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
    allowedRails: [{ asset: AUDD_ASSET, network: plan.network }],
    approveLivePayment: options.approveLivePayment,
    paymentProofRef: options.paymentProofRef,
    evaluateBudgetPolicy: options.evaluateBudgetPolicy,
  });
  return adaptBuyerDecision(buyerDecision, plan, challenge);
}
