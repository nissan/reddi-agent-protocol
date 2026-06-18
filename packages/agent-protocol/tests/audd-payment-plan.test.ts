import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAuddPaymentChallenge,
  createAuddSolanaPaymentPlan,
  evaluateAuddPaymentPlanPreflight,
  type BudgetPolicyEvaluator,
} from '../dist/index.js';

const AUDD_DEVNET_MINT = 'AUDDdev111111111111111111111111111111111111';
const PAYEE = 'solana:9xQeWvG816bUx9EPjHmaT23yvVM2ZW9qQqz4hK5x9demo';

const plan = createAuddSolanaPaymentPlan({
  network: 'solana-devnet',
  mint: AUDD_DEVNET_MINT,
  payee: PAYEE,
  settlementAccount: PAYEE,
  amount: '2500000',
  quoteExpiresAt: '2026-06-18T15:00:00.000Z',
  failurePolicy: {
    mode: 'no_charge_on_failure',
    description: 'Dry-run jobs do not charge when the specialist fails.',
  },
  refundPolicy: {
    mode: 'manual_review',
    description: 'Live refunds require operator review before settlement.',
  },
  evidenceRequired: true,
  paymentMode: 'dry-run',
});

const challenge = createAuddPaymentChallenge({
  mode: 'dry-run',
  paymentPlan: plan,
  quote: {
    source: 'source:ard-catalog',
    specialist: 'specialist:listing-writer',
  },
  nonce: 'audd-001',
  endpoint: 'http://localhost:4021/specialist',
});

const allowBudget: BudgetPolicyEvaluator = (quote) => ({
  allowed: true,
  reasonCodes: ['allowed'],
  quotedAmount: quote,
  remainingBudget: { perRequest: '10000000' },
  auditNotes: ['Allowed by local AUDD budget policy.'],
});

const denyBudget: BudgetPolicyEvaluator = (quote) => ({
  allowed: false,
  reasonCodes: ['request_amount_exceeds_limit'],
  quotedAmount: quote,
  remainingBudget: { perRequest: '0' },
  auditNotes: ['Denied by local AUDD budget policy.'],
});

const baseBuyerPolicy = {
  allowedNetworks: ['solana-devnet'],
  allowedMints: [AUDD_DEVNET_MINT],
  allowedPayees: [PAYEE],
  allowedSettlementAccounts: [PAYEE],
  maxAmount: '3000000',
  requireEvidence: true,
  approvalState: 'approved' as const,
  now: '2026-06-18T14:00:00.000Z',
};

describe('AUDD/Solana payment plan adapter', () => {
  it('creates AUDD/Solana quote metadata and approves a dry-run buyer preflight', () => {
    assert.equal(challenge.quote.asset, 'AUDD');
    assert.equal(challenge.quote.network, 'solana-devnet');
    assert.equal(challenge.quote.amount, '2500000');
    assert.equal(challenge.payTo, PAYEE);
    assert.equal(challenge.policyMetadata?.auddPaymentPlan, plan);

    const decision = evaluateAuddPaymentPlanPreflight(challenge, {
      ...baseBuyerPolicy,
      evaluateBudgetPolicy: allowBudget,
      paymentProofRef: 'dry-run:audd-001',
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.reasonCodes, ['audd_payment_plan_allowed']);
    assert.equal(decision.paymentProofRef, 'dry-run:audd-001');
    assert.equal(decision.paymentPlan?.asset, 'AUDD');
    assert.equal(decision.policyDecision?.quotedAmount?.asset, 'AUDD');
    assert.equal(decision.policyDecision?.approvalState, 'approved');
  });

  it('fails closed for wrong network, wrong mint, and missing payee', () => {
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedNetworks: ['solana-mainnet-beta'],
      }).reasonCodes,
      ['wrong_network'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedMints: ['not-the-audd-mint'],
      }).reasonCodes,
      ['wrong_mint'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedPayees: ['solana:other-payee'],
      }).reasonCodes,
      ['missing_payee'],
    );

    const badPayeeGoodSettlement = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: createAuddSolanaPaymentPlan({
        ...plan,
        payee: 'solana:attacker-payee',
        settlementAccount: PAYEE,
      }),
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-payee-mismatch',
      endpoint: 'http://localhost:4021/specialist',
    });
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(badPayeeGoodSettlement, {
        ...baseBuyerPolicy,
        allowedPayees: [PAYEE],
        allowedSettlementAccounts: [PAYEE],
      }).reasonCodes,
      ['missing_payee'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedPayees: [PAYEE],
        allowedSettlementAccounts: ['solana:other-settlement'],
      }).reasonCodes,
      ['missing_payee'],
    );
  });

  it('fails closed for expired quotes, missing evidence, missing approval, and over-budget plans', () => {
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        now: '2026-06-18T15:00:00.000Z',
      }).reasonCodes,
      ['quote_expired'],
    );

    const noEvidence = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: createAuddSolanaPaymentPlan({ ...plan, evidenceRequired: false }),
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-002',
      endpoint: 'http://localhost:4021/specialist',
    });
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(noEvidence, {
        ...baseBuyerPolicy,
        requireEvidence: true,
      }).reasonCodes,
      ['evidence_required'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        approvalState: undefined,
        now: '2026-06-18T14:00:00.000Z',
      }).reasonCodes,
      ['operator_approval_required'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        maxAmount: '2499999',
      }).reasonCodes,
      ['amount_exceeds_max'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        maxAmount: 'abc',
      }).reasonCodes,
      ['payment_plan_malformed'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        evaluateBudgetPolicy: denyBudget,
      }).reasonCodes,
      ['budget_policy_denied'],
    );

    const nullQuoteBudget = (() => ({
      allowed: true,
      reasonCodes: ['allowed'],
      quotedAmount: null,
      auditNotes: ['Malformed allowed budget output.'],
    })) as BudgetPolicyEvaluator;
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        evaluateBudgetPolicy: nullQuoteBudget,
      }).reasonCodes,
      ['budget_policy_malformed'],
    );

    const numericAmountBudget = (() => ({
      allowed: true,
      reasonCodes: ['allowed'],
      quotedAmount: {
        ...challenge.quote,
        amount: 2500000,
      },
      auditNotes: ['Malformed allowed budget output.'],
    })) as unknown as BudgetPolicyEvaluator;
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        evaluateBudgetPolicy: numericAmountBudget,
      }).reasonCodes,
      ['budget_policy_malformed'],
    );

    const mismatchedQuoteBudget = (() => ({
      allowed: true,
      reasonCodes: ['allowed'],
      quotedAmount: {
        ...challenge.quote,
        amount: '1',
        network: 'solana-mainnet-beta',
      },
      auditNotes: ['Wrong quote should not approve AUDD preflight.'],
    })) as BudgetPolicyEvaluator;
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        evaluateBudgetPolicy: mismatchedQuoteBudget,
      }).reasonCodes,
      ['budget_policy_malformed'],
    );
  });

  it('requires explicit buyer policy constraints before approving AUDD preflight', () => {
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        approvalState: 'approved',
        now: '2026-06-18T14:00:00.000Z',
      }).reasonCodes,
      ['buyer_policy_missing'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        maxAmount: undefined,
        evaluateBudgetPolicy: undefined,
      }).reasonCodes,
      ['buyer_policy_missing'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        requireEvidence: false,
      }).reasonCodes,
      ['buyer_policy_missing'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedNetworks: [42 as unknown as string],
      }).reasonCodes,
      ['buyer_policy_missing'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedMints: [42 as unknown as string],
      }).reasonCodes,
      ['buyer_policy_missing'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedPayees: [42 as unknown as string],
      }).reasonCodes,
      ['buyer_policy_missing'],
    );

    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(challenge, {
        ...baseBuyerPolicy,
        allowedSettlementAccounts: [42 as unknown as string],
      }).reasonCodes,
      ['buyer_policy_missing'],
    );
  });

  it('keeps live AUDD payment fail-closed unless explicitly approved', () => {
    const liveChallenge = createAuddPaymentChallenge({
      mode: 'live',
      paymentPlan: createAuddSolanaPaymentPlan({ ...plan, paymentMode: 'live' }),
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-live-001',
      endpoint: 'http://localhost:4021/specialist',
    });

    const blocked = evaluateAuddPaymentPlanPreflight(liveChallenge, {
      ...baseBuyerPolicy,
    });
    assert.equal(blocked.allowed, false);
    assert.deepEqual(blocked.reasonCodes, ['live_payment_not_approved']);

    const approved = evaluateAuddPaymentPlanPreflight(liveChallenge, {
      ...baseBuyerPolicy,
      approveLivePayment: true,
    });
    assert.equal(approved.allowed, true);
    assert.deepEqual(approved.reasonCodes, ['audd_payment_plan_allowed']);
  });

  it('rejects malformed, mismatched, and credential-bearing AUDD payment plans', () => {
    const missingPlan = { ...challenge, policyMetadata: {} };
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(missingPlan, {
        ...baseBuyerPolicy,
      }).reasonCodes,
      ['missing_audd_payment_plan'],
    );

    const mismatched = {
      ...challenge,
      quote: { ...challenge.quote, asset: 'USDC' },
    };
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(mismatched, {
        ...baseBuyerPolicy,
      }).reasonCodes,
      ['wrong_asset'],
    );

    const modeMismatch = {
      ...challenge,
      policyMetadata: {
        auddPaymentPlan: createAuddSolanaPaymentPlan({ ...plan, paymentMode: 'live' }),
      },
    };
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(modeMismatch, {
        ...baseBuyerPolicy,
      }).reasonCodes,
      ['quote_payment_plan_mismatch'],
    );

    const badPlan = {
      ...challenge,
      policyMetadata: {
        auddPaymentPlan: {
          ...plan,
          payee: 'https://pay.example/settle?api_key=secret',
        },
      },
    };
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(badPlan, {
        ...baseBuyerPolicy,
      }).reasonCodes,
      ['credential_leakage_rejected'],
    );

    const malformed = {
      ...challenge,
      policyMetadata: {
        auddPaymentPlan: {
          ...plan,
          amount: '0',
        },
      },
    };
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(malformed, {
        ...baseBuyerPolicy,
      }).reasonCodes,
      ['payment_plan_malformed'],
    );

    const circularPlan: Record<string, unknown> = { ...plan };
    circularPlan.self = circularPlan;
    const circular = {
      ...challenge,
      policyMetadata: {
        auddPaymentPlan: circularPlan,
      },
    };
    assert.deepEqual(
      evaluateAuddPaymentPlanPreflight(circular, {
        ...baseBuyerPolicy,
      }).reasonCodes,
      ['payment_plan_malformed'],
    );
  });
});
