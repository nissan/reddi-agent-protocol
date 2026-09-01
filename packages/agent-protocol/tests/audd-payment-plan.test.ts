import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDD_DETERMINISTIC_FIXTURE_MINT,
  AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
  SOLANA_DEVNET_CAIP2,
  SOLANA_MAINNET_BETA_CAIP2,
  SOLANA_TESTNET_CAIP2,
  SPL_TOKEN_PROGRAM_ID,
  createAuddPaymentChallenge,
  createAuddPaymentIntentDraft,
  createAuddSolanaPaymentPlan,
  createAuddX402SvmExactPaymentPlan,
  createAuddX402SvmExactPaymentRequired,
  createPaymentIntentDraft,
  evaluateAuddPaymentPlanPreflight,
  validateAuddX402SvmExactPaymentRequired,
  type BudgetPolicyEvaluator,
} from '../dist/index.js';

const AUDD_FIXTURE_MINT = AUDD_DETERMINISTIC_FIXTURE_MINT;
const PAYEE = 'solana:9xQeWvG816bUx9EPjHmaT23yvVM2ZW9qQqz4hK5x9demo';

const plan = createAuddSolanaPaymentPlan({
  network: 'solana-devnet',
  mint: AUDD_FIXTURE_MINT,
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
  allowedMints: [AUDD_FIXTURE_MINT],
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

  it('bridges AUDD plans to x402 v2 SVM exact while keeping model authority draft-only', () => {
    const x402Plan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      caip2Network: SOLANA_DEVNET_CAIP2,
      railEnvironment: 'deterministic-fixture',
      eligibility: 'non_eligible',
      memo: 'reddi:pay:audd-fixture-intent',
      maxTimeoutSeconds: 60,
      authority: {
        modelRole: 'draft_only',
        authorizationState: 'model_draft',
        operatorApprovalRequired: false,
      },
    });
    const intent = createAuddPaymentIntentDraft({
      agreementId: 'reddi.agreement:1111111111111111111111111111111111111111111111111111111111111111',
      paymentPlan: x402Plan,
      destinationTokenAccount: PAYEE,
      memo: 'reddi:pay:audd-fixture-intent',
    });
    const paymentRequired = createAuddX402SvmExactPaymentRequired({
      paymentPlan: x402Plan,
      paymentIntent: intent,
      resource: {
        url: 'https://seller.example.test/agent/task',
        description: 'Deterministic AUDD fixture task',
        mimeType: 'application/json',
        serviceName: 'seller-agent-fixture',
      },
    });

    assert.equal(validateAuddX402SvmExactPaymentRequired(paymentRequired), true);
    assert.equal(paymentRequired.x402Version, 2);
    assert.equal(paymentRequired.accepts[0].scheme, 'exact');
    assert.equal(paymentRequired.accepts[0].network, SOLANA_DEVNET_CAIP2);
    assert.equal(paymentRequired.accepts[0].amount, '2500000');
    assert.equal(paymentRequired.accepts[0].asset, AUDD_FIXTURE_MINT);
    assert.equal(paymentRequired.accepts[0].extra.tokenProgram, SPL_TOKEN_PROGRAM_ID);
    assert.equal(paymentRequired.accepts[0].extra.decimals, 6);
    assert.equal(paymentRequired.accepts[0].extra.memo, 'reddi:pay:audd-fixture-intent');
    assert.equal(paymentRequired.extensions.reddi.modelMayAuthorize, false);
    assert.equal(intent.authorization.state, 'model_draft');
    assert.equal(intent.authorization.modelMayAuthorize, false);

    assert.throws(
      () => createAuddX402SvmExactPaymentRequired({
        paymentPlan: x402Plan,
        paymentIntent: { ...intent, asset: { ...intent.asset, mint: 'WrongAuddMint1111111111111111111111111111111' } },
        resource: { url: 'https://seller.example.test/agent/task' },
      }),
      /audd_payment_intent_plan_mismatch/,
    );
    assert.equal(validateAuddX402SvmExactPaymentRequired({
      ...paymentRequired,
      accepts: [{
        ...paymentRequired.accepts[0],
        extra: { ...paymentRequired.accepts[0].extra, paymentIntentId: 'reddi.payment-intent:other' },
      }],
    }), false);

    const exactChallenge = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: x402Plan,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-x402-exact-001',
      endpoint: 'https://seller.example.test/agent/task',
    });
    const decision = evaluateAuddPaymentPlanPreflight(exactChallenge, {
      ...baseBuyerPolicy,
      allowedTokenPrograms: [SPL_TOKEN_PROGRAM_ID],
      allowedCaip2Networks: [SOLANA_DEVNET_CAIP2],
      allowedRailEnvironments: ['deterministic-fixture'],
      requireX402Exact: true,
      paymentProofRef: 'fixture:audd-x402-exact-001',
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.reasonCodes, ['audd_payment_plan_allowed']);
    assert.equal(decision.paymentPlan?.x402Version, 2);
  });

  it('keeps official AUDD mainnet disabled by a separate gate even when live payment is otherwise approved', () => {
    const mainnetPlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      network: 'solana-mainnet-beta',
      caip2Network: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      railEnvironment: 'mainnet-gated',
      paymentMode: 'live',
      authority: {
        modelRole: 'draft_only',
        authorizationState: 'operator_approved',
        operatorApprovalRequired: true,
        operatorApprovalRef: 'operator-approval:future-explicit-audd-mainnet-only',
      },
    });
    const liveChallenge = createAuddPaymentChallenge({
      mode: 'live',
      paymentPlan: mainnetPlan,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-mainnet-blocked-001',
      endpoint: 'https://seller.example.test/agent/task',
    });

    const blocked = evaluateAuddPaymentPlanPreflight(liveChallenge, {
      allowedNetworks: ['solana-mainnet-beta'],
      allowedMints: [AUDD_OFFICIAL_SOLANA_MAINNET_MINT],
      allowedTokenPrograms: [SPL_TOKEN_PROGRAM_ID],
      allowedCaip2Networks: [SOLANA_MAINNET_BETA_CAIP2],
      allowedPayees: [PAYEE],
      allowedSettlementAccounts: [PAYEE],
      allowedRailEnvironments: ['mainnet-gated'],
      maxAmount: '3000000',
      requireEvidence: true,
      requireX402Exact: true,
      approvalState: 'approved',
      approveLivePayment: true,
      now: '2026-06-18T14:00:00.000Z',
    });

    assert.equal(blocked.allowed, false);
    assert.deepEqual(blocked.reasonCodes, ['mainnet_audd_disabled']);
  });

  it('blocks unverified devnet AUDD and eligible fixture/devnet grant labels in preflight', () => {
    const devnetPlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      mint: 'UnverifiedDevnetAuddMintRequiresPartnerSource111111',
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      caip2Network: SOLANA_DEVNET_CAIP2,
      railEnvironment: 'devnet-unverified',
      eligibility: 'non_eligible',
    });
    const devnetChallenge = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: devnetPlan,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-devnet-unverified-001',
      endpoint: 'https://seller.example.test/agent/task',
    });

    const devnetDecision = evaluateAuddPaymentPlanPreflight(devnetChallenge, {
      ...baseBuyerPolicy,
      allowedMints: [devnetPlan.mint],
      allowedTokenPrograms: [SPL_TOKEN_PROGRAM_ID],
      allowedCaip2Networks: [SOLANA_DEVNET_CAIP2],
      allowedRailEnvironments: ['devnet-unverified'],
      requireX402Exact: true,
    });
    assert.equal(devnetDecision.allowed, false);
    assert.deepEqual(devnetDecision.reasonCodes, ['devnet_audd_unverified']);

    const eligibleFixture = createAuddX402SvmExactPaymentPlan({
      ...plan,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      caip2Network: SOLANA_DEVNET_CAIP2,
      railEnvironment: 'deterministic-fixture',
      eligibility: 'eligible',
    });
    const eligibleChallenge = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: eligibleFixture,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-fixture-eligible-001',
      endpoint: 'https://seller.example.test/agent/task',
    });
    const eligibleDecision = evaluateAuddPaymentPlanPreflight(eligibleChallenge, {
      ...baseBuyerPolicy,
      allowedTokenPrograms: [SPL_TOKEN_PROGRAM_ID],
      allowedCaip2Networks: [SOLANA_DEVNET_CAIP2],
      allowedRailEnvironments: ['deterministic-fixture'],
      requireX402Exact: true,
    });
    assert.equal(eligibleDecision.allowed, false);
    assert.deepEqual(eligibleDecision.reasonCodes, ['grant_eligibility_blocked']);
  });

  it('rejects any model-authored marker that claims spending authorization', () => {
    const x402Plan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      caip2Network: SOLANA_DEVNET_CAIP2,
      railEnvironment: 'deterministic-fixture',
    });
    const modelChallenge = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: x402Plan,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-model-auth-rejected-001',
      endpoint: 'https://seller.example.test/agent/task',
    });
    const tampered = {
      ...modelChallenge,
      policyMetadata: {
        auddPaymentPlan: {
          ...x402Plan,
          authority: {
            ...(x402Plan.authority ?? {}),
            modelMayAuthorize: true,
          },
        },
      },
    };

    const decision = evaluateAuddPaymentPlanPreflight(tampered, {
      ...baseBuyerPolicy,
      allowedTokenPrograms: [SPL_TOKEN_PROGRAM_ID],
      allowedCaip2Networks: [SOLANA_DEVNET_CAIP2],
      allowedRailEnvironments: ['deterministic-fixture'],
      requireX402Exact: true,
    });
    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.reasonCodes, ['model_authorization_rejected']);
  });

  it('keeps mainnet AUDD gated for a legacy-shaped plan that varies the network alias casing and omits railEnvironment', () => {
    const aliasedMainnetPlan = createAuddSolanaPaymentPlan({
      ...plan,
      network: 'Solana-Mainnet-Beta',
      caip2Network: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: 6,
      x402Version: 2,
      scheme: 'exact',
      paymentFlow: 'upfront',
      maxTimeoutSeconds: 60,
    });
    assert.equal(aliasedMainnetPlan.railEnvironment, undefined);

    const aliasedChallenge = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: aliasedMainnetPlan,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-mainnet-alias-001',
      endpoint: 'https://seller.example.test/agent/task',
    });

    const buyerPolicy = {
      allowedNetworks: ['solana-mainnet-beta'],
      allowedMints: [AUDD_OFFICIAL_SOLANA_MAINNET_MINT],
      allowedTokenPrograms: [SPL_TOKEN_PROGRAM_ID],
      allowedCaip2Networks: [SOLANA_MAINNET_BETA_CAIP2],
      allowedPayees: [PAYEE],
      allowedSettlementAccounts: [PAYEE],
      maxAmount: '3000000',
      requireEvidence: true,
      requireX402Exact: true,
      approvalState: 'approved' as const,
      now: '2026-06-18T14:00:00.000Z',
    };

    const blocked = evaluateAuddPaymentPlanPreflight(aliasedChallenge, buyerPolicy);
    assert.equal(blocked.allowed, false);
    assert.deepEqual(blocked.reasonCodes, ['mainnet_audd_disabled']);

    const withoutX402Exact = evaluateAuddPaymentPlanPreflight(aliasedChallenge, {
      ...buyerPolicy,
      requireX402Exact: false,
    });
    assert.equal(withoutX402Exact.allowed, false);
    assert.deepEqual(withoutX402Exact.reasonCodes, ['mainnet_audd_disabled']);

    assert.throws(
      () => createAuddSolanaPaymentPlan({ ...plan, mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT }),
      /audd_payment_plan_rail_identity_mismatch/,
    );
  });

  it('labels an intent draft for a live mainnet plan as mainnet-gated and keeps operator approval required', () => {
    const liveMainnetPlan = createAuddSolanaPaymentPlan({
      ...plan,
      network: 'solana-mainnet-beta',
      caip2Network: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      paymentMode: 'live',
    });
    assert.equal(liveMainnetPlan.railEnvironment, undefined);

    const intent = createAuddPaymentIntentDraft({
      agreementId: 'reddi.agreement:2222222222222222222222222222222222222222222222222222222222222222',
      paymentPlan: liveMainnetPlan,
    });
    assert.equal(intent.labels.environment, 'mainnet-gated');
    assert.equal(intent.labels.eligibility, 'pending_partner_acceptance');
    assert.equal(intent.authorization.operatorApprovalRequired, true);
    assert.equal(intent.authorization.modelMayAuthorize, false);

    assert.throws(
      () => createAuddPaymentIntentDraft({
        agreementId: 'reddi.agreement:2222222222222222222222222222222222222222222222222222222222222222',
        paymentPlan: liveMainnetPlan,
        labels: { environment: 'deterministic-fixture', eligibility: 'non_eligible' },
      }),
      /audd_payment_plan_label_environment_mismatch/,
    );

    const testnetPlan = createAuddSolanaPaymentPlan({ ...plan, network: 'solana-testnet', mint: 'UnknownRailAuddMint1111111111111111111111111' });
    assert.throws(
      () => createAuddPaymentIntentDraft({
        agreementId: 'reddi.agreement:3333333333333333333333333333333333333333333333333333333333333333',
        paymentPlan: testnetPlan,
      }),
      /audd_payment_plan_environment_undeclared/,
    );
  });

  it('derives the rail environment from the plan identity for every rail, not just mainnet', () => {
    const livePlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      network: 'solana-mainnet-beta',
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      paymentMode: 'live',
    });
    assert.equal(livePlan.railEnvironment, 'mainnet-gated');
    assert.equal(livePlan.authority?.operatorApprovalRequired, true);

    const fixturePlan = createAuddX402SvmExactPaymentPlan({ ...plan });
    assert.equal(fixturePlan.railEnvironment, 'deterministic-fixture');
    assert.equal(fixturePlan.authority?.operatorApprovalRequired, false);

    const unverifiedDevnetPlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      mint: 'UnverifiedAuddDevnetMint11111111111111111111',
    });
    assert.equal(unverifiedDevnetPlan.railEnvironment, 'devnet-unverified');
    assert.equal(unverifiedDevnetPlan.authority?.operatorApprovalRequired, true);

    assert.throws(
      () => createAuddX402SvmExactPaymentPlan({ ...plan, network: 'solana-testnet', mint: 'UnknownRailAuddMint1111111111111111111111111' }),
      /audd_payment_plan_environment_undeclared/,
    );
  });

  it('blocks an undeclared unverified devnet AUDD mint in preflight and labels it devnet-unverified', () => {
    const undeclaredDevnetPlan = createAuddSolanaPaymentPlan({
      ...plan,
      mint: 'UnverifiedAuddDevnetMint11111111111111111111',
    });
    assert.equal(undeclaredDevnetPlan.railEnvironment, undefined);

    const intent = createAuddPaymentIntentDraft({
      agreementId: 'reddi.agreement:4444444444444444444444444444444444444444444444444444444444444444',
      paymentPlan: undeclaredDevnetPlan,
    });
    assert.equal(intent.labels.environment, 'devnet-unverified');
    assert.equal(intent.authorization.operatorApprovalRequired, true);

    const devnetChallenge = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: undeclaredDevnetPlan,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-devnet-undeclared-001',
      endpoint: 'https://seller.example.test/agent/task',
    });
    const decision = evaluateAuddPaymentPlanPreflight(devnetChallenge, {
      ...baseBuyerPolicy,
      allowedMints: [undeclaredDevnetPlan.mint],
    });
    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.reasonCodes, ['devnet_audd_unverified']);
  });

  it('rejects intent labels that overstate the plan rail as well as labels that understate it', () => {
    const fixturePlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      caip2Network: SOLANA_DEVNET_CAIP2,
      railEnvironment: 'deterministic-fixture',
    });

    for (const environment of ['controlled-live', 'mainnet-gated', 'devnet-unverified'] as const) {
      assert.throws(
        () => createAuddPaymentIntentDraft({
          agreementId: 'reddi.agreement:5555555555555555555555555555555555555555555555555555555555555555',
          paymentPlan: fixturePlan,
          destinationTokenAccount: PAYEE,
          labels: { environment, eligibility: 'eligible', partnerAcceptanceRef: 'audd:not-real' },
        }),
        /audd_payment_plan_label_environment_mismatch/,
      );
    }

    const honest = createAuddPaymentIntentDraft({
      agreementId: 'reddi.agreement:5555555555555555555555555555555555555555555555555555555555555555',
      paymentPlan: fixturePlan,
      destinationTokenAccount: PAYEE,
      labels: { environment: 'deterministic-fixture', eligibility: 'non_eligible' },
    });
    assert.equal(honest.labels.environment, 'deterministic-fixture');
  });

  it('rejects seller-declared rails that do not exactly match the identity-derived rail', () => {
    assert.throws(
      () => createAuddX402SvmExactPaymentPlan({
        ...plan,
        network: 'solana-devnet',
        caip2Network: SOLANA_DEVNET_CAIP2,
        mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        paymentMode: 'live',
        railEnvironment: 'deterministic-fixture',
      }),
      /audd_payment_plan_rail_environment_mismatch/,
    );

    assert.throws(
      () => createAuddSolanaPaymentPlan({
        ...plan,
        mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
        railEnvironment: 'mainnet-gated',
      }),
      /audd_payment_plan_rail_environment_mismatch/,
    );
  });

  it('refuses to advertise a 402 whose intent labels do not match the plan rail', () => {
    const mainnetPlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      network: 'solana-mainnet-beta',
      caip2Network: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      paymentMode: 'live',
    });
    assert.equal(mainnetPlan.railEnvironment, 'mainnet-gated');

    const fixtureLabelledIntent = createPaymentIntentDraft({
      labels: { environment: 'deterministic-fixture', eligibility: 'non_eligible' },
      agreementId: 'reddi.agreement:7777777777777777777777777777777777777777777777777777777777777777',
      network: { caip2: SOLANA_MAINNET_BETA_CAIP2, rapAlias: mainnetPlan.network },
      asset: {
        symbol: 'AUDD',
        mint: mainnetPlan.mint,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        amountBaseUnits: mainnetPlan.amount,
      },
      payTo: mainnetPlan.payee,
      destinationTokenAccount: mainnetPlan.settlementAccount,
      memo: 'reddi:pay:mislabelled-mainnet',
      evidenceRequired: true,
      quoteExpiresAt: mainnetPlan.quoteExpiresAt,
      expiresAt: mainnetPlan.quoteExpiresAt,
      refundPolicy: mainnetPlan.refundPolicy,
      operatorApprovalRequired: false,
    });

    assert.throws(
      () => createAuddX402SvmExactPaymentRequired({
        paymentPlan: mainnetPlan,
        paymentIntent: fixtureLabelledIntent,
        resource: { url: 'https://seller.example.test/agent/task' },
      }),
      /audd_payment_plan_label_environment_mismatch/,
    );

    assert.throws(
      () => createAuddPaymentIntentDraft({
        agreementId: 'reddi.agreement:7777777777777777777777777777777777777777777777777777777777777777',
        paymentPlan: mainnetPlan,
        labels: { environment: 'controlled-live', eligibility: 'pending_partner_acceptance' },
      }),
      /audd_payment_plan_label_environment_mismatch/,
    );
  });

  it('carries the operator-approval gate from the plan onto the intent and the 402', () => {
    const strictFixturePlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      caip2Network: SOLANA_DEVNET_CAIP2,
      authority: {
        modelRole: 'draft_only',
        authorizationState: 'model_draft',
        operatorApprovalRequired: true,
      },
    });
    const strictIntent = createAuddPaymentIntentDraft({
      agreementId: 'reddi.agreement:8888888888888888888888888888888888888888888888888888888888888888',
      paymentPlan: strictFixturePlan,
      destinationTokenAccount: PAYEE,
    });
    assert.equal(strictIntent.authorization.operatorApprovalRequired, true);
    const strictRequirement = createAuddX402SvmExactPaymentRequired({
      paymentPlan: strictFixturePlan,
      paymentIntent: strictIntent,
      resource: { url: 'https://seller.example.test/agent/task' },
    });
    assert.equal(strictRequirement.accepts[0].extra.operatorApprovalRequired, true);

    const mainnetPlan = createAuddX402SvmExactPaymentPlan({
      ...plan,
      network: 'solana-mainnet-beta',
      caip2Network: SOLANA_MAINNET_BETA_CAIP2,
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      paymentMode: 'live',
    });
    const waivedIntent = createPaymentIntentDraft({
      labels: { environment: 'mainnet-gated', eligibility: 'non_eligible' },
      agreementId: 'reddi.agreement:9999999999999999999999999999999999999999999999999999999999999999',
      network: { caip2: SOLANA_MAINNET_BETA_CAIP2, rapAlias: mainnetPlan.network },
      asset: {
        symbol: 'AUDD',
        mint: mainnetPlan.mint,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        amountBaseUnits: mainnetPlan.amount,
      },
      payTo: mainnetPlan.payee,
      destinationTokenAccount: mainnetPlan.settlementAccount,
      memo: 'reddi:pay:waived-operator-approval',
      evidenceRequired: true,
      quoteExpiresAt: mainnetPlan.quoteExpiresAt,
      expiresAt: mainnetPlan.quoteExpiresAt,
      refundPolicy: mainnetPlan.refundPolicy,
      operatorApprovalRequired: false,
    });
    assert.throws(
      () => createAuddX402SvmExactPaymentRequired({
        paymentPlan: mainnetPlan,
        paymentIntent: waivedIntent,
        resource: { url: 'https://seller.example.test/agent/task' },
      }),
      /audd_payment_intent_operator_approval_mismatch/,
    );
  });

  it('refuses to build an AUDD plan or intent on a network with no configured AUDD rail', () => {
    assert.throws(
      () => createAuddX402SvmExactPaymentPlan({
        ...plan,
        network: 'solana-testnet',
        caip2Network: SOLANA_TESTNET_CAIP2,
        mint: 'NotAnAuddMint111111111111111111111111111111',
        paymentMode: 'live',
        railEnvironment: 'deterministic-fixture',
      }),
      /audd_payment_plan_environment_undeclared/,
    );

    assert.throws(
      () => createAuddSolanaPaymentPlan({
        ...plan,
        network: 'solana-testnet',
        mint: 'NotAnAuddMint111111111111111111111111111111',
        railEnvironment: 'deterministic-fixture',
      }),
      /audd_payment_plan_environment_undeclared/,
    );

    const legacyTestnetPlan = createAuddSolanaPaymentPlan({
      ...plan,
      network: 'solana-testnet',
      mint: 'NotAnAuddMint111111111111111111111111111111',
    });
    const testnetChallenge = createAuddPaymentChallenge({
      mode: 'dry-run',
      paymentPlan: legacyTestnetPlan,
      quote: {
        source: 'source:ard-catalog',
        specialist: 'specialist:listing-writer',
      },
      nonce: 'audd-testnet-undeclared-001',
      endpoint: 'https://seller.example.test/agent/task',
    });
    const testnetDecision = evaluateAuddPaymentPlanPreflight(testnetChallenge, {
      ...baseBuyerPolicy,
      allowedNetworks: ['solana-testnet'],
      allowedMints: [legacyTestnetPlan.mint],
      approveLivePayment: true,
    });
    assert.equal(testnetDecision.allowed, false);
    assert.deepEqual(testnetDecision.reasonCodes, ['blocked_rail_environment']);
  });

  it('keeps local-test-mint configuration-only at intent and x402 export boundaries', () => {
    const localTestPlan = createAuddSolanaPaymentPlan({
      ...plan,
      network: 'local-surfpool',
      mint: 'LocalGeneratedAuddTestMint1111111111111111111',
      railEnvironment: 'local-test-mint',
    });

    assert.throws(
      () => createAuddPaymentIntentDraft({
        agreementId: 'reddi.agreement:bbbbccccddddeeeeffff00001111222233334444555566667777888899990000',
        paymentPlan: localTestPlan,
      }),
      /audd_payment_plan_local_test_mint_not_exportable/,
    );
    assert.throws(
      () => createAuddX402SvmExactPaymentPlan({
        ...plan,
        network: 'local-surfpool',
        mint: 'LocalGeneratedAuddTestMint1111111111111111111',
        railEnvironment: 'local-test-mint',
      }),
      /audd_payment_plan_local_test_mint_not_exportable/,
    );
  });
});
