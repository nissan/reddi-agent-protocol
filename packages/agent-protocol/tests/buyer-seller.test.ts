import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPaymentChallenge,
  evaluateBuyerPaymentChallenge,
  handlePaidSpecialistRequest,
  type BudgetPolicyEvaluator,
} from '../dist/index.js';

const challenge = createPaymentChallenge({
  mode: 'dry-run',
  quote: {
    amount: '50000',
    asset: 'USDC',
    network: 'solana-devnet',
    source: 'source:planning',
    specialist: 'specialist:coder',
  },
  payTo: 'solana:seller-demo',
  nonce: 'unit-001',
  endpoint: 'http://localhost:4021/specialist',
});

const allowBudget: BudgetPolicyEvaluator = (quote) => ({
  allowed: true,
  reasonCodes: ['allowed'],
  quotedAmount: quote,
  remainingBudget: { perRequest: '50000' },
  auditNotes: ['Allowed by local budget policy.'],
});

const denyBudget: BudgetPolicyEvaluator = (quote) => ({
  allowed: false,
  reasonCodes: ['request_amount_exceeds_limit'],
  quotedAmount: quote,
  remainingBudget: { perRequest: '0' },
  auditNotes: ['Denied by local budget policy.'],
});

const malformedBudget: BudgetPolicyEvaluator = (quote) => ({
  allowed: false,
  reasonCodes: ['not_a_rap_reason'],
  quotedAmount: quote,
  remainingBudget: {},
  auditNotes: ['Malformed budget output.'],
});

describe('RAP buyer client and seller middleware primitives', () => {
  it('returns a structured 402 payment challenge for unpaid requests', async () => {
    const response = await handlePaidSpecialistRequest({
      challenge,
      request: { body: { task: 'plan' } },
      specialist: () => ({ ok: true }),
    });

    assert.equal(response.status, 402);
    if (response.status === 402) {
      assert.equal(response.challenge.schemaVersion, 'reddi.payment-challenge.v1');
      assert.equal(response.challenge.status, 402);
      assert.equal(response.challenge.quote.amount, '50000');
      assert.equal(response.challenge.mode, 'dry-run');
    }
  });

  it('lets the buyer parse a challenge and approve local dry-run payment with budget policy', () => {
    const decision = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: allowBudget,
      paymentProofRef: 'dry-run:paid',
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.reasonCodes, ['buyer_policy_allowed']);
    assert.equal(decision.paymentProofRef, 'dry-run:paid');
    assert.equal(decision.policyDecision?.allowed, true);
    assert.equal(decision.policyDecision?.quotedAmount?.source, 'source:planning');
  });

  it('executes a bounded specialist and returns result, receipt, and evidence for approved dry-run payment', async () => {
    const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: allowBudget,
      paymentProofRef: 'dry-run:paid',
    });
    assert.equal(buyerDecision.allowed, true);

    const response = await handlePaidSpecialistRequest({
      challenge,
      request: { body: { task: 'plan' }, paymentProofRef: buyerDecision.paymentProofRef },
      policyDecision: buyerDecision.policyDecision,
      createdAt: '2026-06-18T13:40:00.000Z',
      specialist: (body) => ({ ok: true, body }),
    });

    assert.equal(response.status, 200);
    if (response.status === 200) {
      assert.deepEqual(response.result, { ok: true, body: { task: 'plan' } });
      assert.equal(response.receipt.schemaVersion, 'reddi.receipt.v1');
      assert.equal(response.receipt.payment.paymentProofRef, 'dry-run:paid');
      assert.equal(response.receipt.policyDecision.allowed, true);
      assert.equal(response.evidence.schemaVersion, 'reddi.evidence-archive.v1');
      assert.equal(response.evidence.receiptId, response.receipt.job.id.replace('job:', 'receipt:'));
      assert.equal(Object.prototype.hasOwnProperty.call(response.evidence, 'evidencePayload'), false);
    }
  });

  it('denies over-budget challenges without producing payment proof', () => {
    const decision = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: denyBudget,
    });

    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.reasonCodes, ['budget_policy_denied']);
    assert.equal(decision.paymentProofRef, undefined);
    assert.equal(decision.policyDecision?.allowed, false);
    assert.deepEqual(decision.policyDecision?.reasonCodes, ['request_amount_exceeds_limit']);
  });

  it('fails closed for malformed budget policy hook output', () => {
    const decision = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: malformedBudget,
    });

    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.reasonCodes, ['budget_policy_malformed']);
    assert.equal(decision.paymentProofRef, undefined);
  });

  it('requires an approved matching policy decision before seller execution', async () => {
    const noPolicy = await handlePaidSpecialistRequest({
      challenge,
      request: { body: { task: 'plan' }, paymentProofRef: 'dry-run:paid' },
      specialist: () => ({ ok: true }),
    });
    assert.equal(noPolicy.status, 403);
    if (noPolicy.status === 403) assert.equal(noPolicy.error.code, 'policy_required');

    const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: allowBudget,
      paymentProofRef: 'dry-run:paid',
    });
    assert.equal(buyerDecision.allowed, true);
    const mismatched = await handlePaidSpecialistRequest({
      challenge,
      request: { body: { task: 'plan' }, paymentProofRef: 'dry-run:paid' },
      policyDecision: {
        ...buyerDecision.policyDecision!,
        quotedAmount: {
          ...buyerDecision.policyDecision!.quotedAmount!,
          amount: '60000',
        },
      },
      specialist: () => ({ ok: true }),
    });
    assert.equal(mismatched.status, 403);
    if (mismatched.status === 403) assert.equal(mismatched.error.code, 'policy_mismatch');
  });

  it('does not execute a specialist when seller receives a denied policy decision', async () => {
    const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: denyBudget,
      paymentProofRef: 'dry-run:paid',
    });
    let executed = false;
    const response = await handlePaidSpecialistRequest({
      challenge,
      request: { body: { task: 'plan' }, paymentProofRef: 'dry-run:paid' },
      policyDecision: buyerDecision.policyDecision,
      specialist: () => {
        executed = true;
        return { ok: true };
      },
    });

    assert.equal(response.status, 403);
    assert.equal(executed, false);
    if (response.status === 403) {
      assert.equal(response.error.code, 'policy_denied');
      assert.deepEqual(response.error.reasonCodes, ['request_amount_exceeds_limit']);
    }
  });

  it('does not execute a specialist when policy still requires operator approval', async () => {
    const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: allowBudget,
      paymentProofRef: 'dry-run:paid',
    });
    let executed = false;
    const response = await handlePaidSpecialistRequest({
      challenge,
      request: { body: { task: 'plan' }, paymentProofRef: 'dry-run:paid' },
      policyDecision: {
        ...buyerDecision.policyDecision!,
        approvalState: 'requires_operator_approval',
      },
      specialist: () => {
        executed = true;
        return { ok: true };
      },
    });

    assert.equal(response.status, 403);
    assert.equal(executed, false);
    if (response.status === 403) assert.equal(response.error.code, 'policy_not_approved');
  });

  it('fails closed for malformed challenges, unsupported rails, and unapproved live mode', () => {
    const malformed = evaluateBuyerPaymentChallenge({
      ...challenge,
      quote: { ...challenge.quote, amount: 'abc' },
    });
    assert.equal(malformed.allowed, false);
    assert.deepEqual(malformed.reasonCodes, ['challenge_malformed']);

    const unsupportedRail = evaluateBuyerPaymentChallenge(challenge, {
      allowedRails: [{ asset: 'AUDD', network: 'solana-devnet' }],
    });
    assert.equal(unsupportedRail.allowed, false);
    assert.deepEqual(unsupportedRail.reasonCodes, ['unsupported_payment_rail']);

    const liveChallenge = createPaymentChallenge({ ...challenge, mode: 'live' });
    const live = evaluateBuyerPaymentChallenge(liveChallenge);
    assert.equal(live.allowed, false);
    assert.deepEqual(live.reasonCodes, ['live_payment_not_approved']);
  });

  it('requires explicit seller approval before executing live-mode challenges', async () => {
    const liveChallenge = createPaymentChallenge({ ...challenge, mode: 'live' });
    const buyerDecision = evaluateBuyerPaymentChallenge(liveChallenge, {
      approveLivePayment: true,
      allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
      evaluateBudgetPolicy: allowBudget,
      paymentProofRef: 'dry-run:paid',
    });
    assert.equal(buyerDecision.allowed, true);

    let executed = false;
    const blocked = await handlePaidSpecialistRequest({
      challenge: liveChallenge,
      request: { body: { task: 'plan' }, paymentProofRef: 'dry-run:paid' },
      policyDecision: buyerDecision.policyDecision,
      specialist: () => {
        executed = true;
        return { ok: true };
      },
    });

    assert.equal(blocked.status, 403);
    assert.equal(executed, false);
    if (blocked.status === 403) assert.equal(blocked.error.code, 'live_payment_not_approved');
  });

  it('fails closed on malformed seller challenges before execution', async () => {
    let executed = false;
    const response = await handlePaidSpecialistRequest({
      challenge: { ...challenge, quote: { ...challenge.quote, amount: 'abc' } },
      request: { body: { task: 'plan' }, paymentProofRef: 'dry-run:paid' },
      specialist: () => {
        executed = true;
        return { ok: true };
      },
    });

    assert.equal(response.status, 400);
    assert.equal(executed, false);
    if (response.status === 400) {
      assert.equal(response.error.code, 'challenge_malformed');
    }
  });

  it('returns specialist failure without creating a receipt', async () => {
    const response = await handlePaidSpecialistRequest({
      challenge,
      request: { body: { task: 'plan' }, paymentProofRef: 'dry-run:paid' },
      policyDecision: evaluateBuyerPaymentChallenge(challenge, {
        allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
        evaluateBudgetPolicy: allowBudget,
        paymentProofRef: 'dry-run:paid',
      }).policyDecision,
      specialist: () => {
        throw new Error('boom');
      },
    });

    assert.equal(response.status, 500);
    if (response.status === 500) {
      assert.equal(response.error.code, 'specialist_failed');
      assert.equal(response.error.message, 'boom');
    }
  });
});
