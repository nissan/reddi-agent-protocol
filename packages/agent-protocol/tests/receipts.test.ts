import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createReddiReceipt,
  policyDecisionFromBudgetPolicyDecision,
  reddiReceiptFixtureCases,
  reddiReceiptFixtures,
  validateReddiReceipt,
  type ReddiReceipt,
} from '../dist/index.js';

function receipt(overrides: Partial<ReddiReceipt> = {}): ReddiReceipt {
  return {
    ...reddiReceiptFixtures.happyPath,
    ...overrides,
    payment: {
      ...reddiReceiptFixtures.happyPath.payment,
      ...overrides.payment,
    },
    policyDecision: {
      ...reddiReceiptFixtures.happyPath.policyDecision,
      ...overrides.policyDecision,
    },
  };
}

describe('Reddi receipt v1', () => {
  it('validates the happy-path fixture and keeps payment proof metadata separate from rail settlement', () => {
    const result = validateReddiReceipt(reddiReceiptFixtures.happyPath);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.receipt.schemaVersion, 'reddi.receipt.v1');
      assert.equal(result.receipt.payment.paymentProofRef, 'dry-run:x402-demo-payment-proof');
      assert.equal(result.receipt.policyDecision.schemaVersion, 'reddi.policy-decision.v1');
    }
  });

  it('exports all issue-required fixture cases with expected validation outcomes', () => {
    const expected = [
      'happyPath',
      'policyDenial',
      'missingProofReference',
      'unsupportedNetworkAsset',
      'malformedReceipt',
      'credentialLeakage',
    ];

    assert.deepEqual(Object.keys(reddiReceiptFixtureCases).sort(), expected.sort());
    for (const fixture of Object.values(reddiReceiptFixtureCases)) {
      const result = validateReddiReceipt(fixture.receipt);
      assert.equal(result.ok, fixture.expectedValid, fixture.description);
      if (!result.ok) {
        for (const code of fixture.expectedErrorCodes) {
          assert.ok(result.errors.some((item) => item.code === code), `${fixture.description} should include ${code}`);
        }
      }
    }
  });

  it('converts a local budget-policy decision into a public policy-decision primitive', () => {
    const decision = policyDecisionFromBudgetPolicyDecision({
      allowed: true,
      reasonCodes: ['allowed'],
      quotedAmount: {
        amount: '50000',
        asset: 'USDC',
        network: 'solana-devnet',
        source: 'source:planning',
        specialist: 'specialist:coder',
      },
      remainingBudget: { perRequest: '50000' },
      auditNotes: ['Allowed: quoted spend is within all configured local buyer budget limits.'],
    });

    assert.equal(decision.schemaVersion, 'reddi.policy-decision.v1');
    assert.equal(decision.allowed, true);
    assert.equal(decision.approvalState, 'approved');
    assert.equal(decision.asset, 'USDC');
    assert.equal(decision.network, 'solana-devnet');
  });

  it('rejects unknown policy reason codes from budget-policy adapters', () => {
    assert.throws(
      () => policyDecisionFromBudgetPolicyDecision({
        allowed: false,
        reasonCodes: ['totally_not_a_reason'],
        quotedAmount: { amount: '50000', asset: 'USDC', network: 'solana-devnet' },
        auditNotes: ['bad reason probe'],
      }),
      /unsupported_policy_reason_code:totally_not_a_reason/,
    );
  });

  it('preserves machine-readable denial reasons in the policy-denial fixture', () => {
    const result = validateReddiReceipt(reddiReceiptFixtures.policyDenial);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.receipt.policyDecision.allowed, false);
      assert.ok(result.receipt.policyDecision.reasonCodes.includes('request_amount_exceeds_limit'));
      assert.equal(result.receipt.policyDecision.approvalState, 'denied');
    }
  });

  it('rejects missing payment proof references with a structured validation error', () => {
    const result = validateReddiReceipt(receipt({ payment: { ...reddiReceiptFixtures.happyPath.payment, paymentProofRef: '' } }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'payment_proof_missing' && item.path === '$.payment.paymentProofRef'));
    }
  });

  it('rejects unsupported network/asset pairs', () => {
    const result = validateReddiReceipt(receipt({ payment: { ...reddiReceiptFixtures.happyPath.payment, network: 'tempo-testnet', asset: 'USDG' } }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'unsupported_network_asset' && item.path === '$.payment'));
    }
  });

  it('accepts AUDD receipt proof metadata on Solana networks without implying custody', () => {
    const result = validateReddiReceipt(receipt({
      payment: {
        network: 'solana-devnet',
        asset: 'AUDD',
        amount: '2500000',
        paymentProofRef: 'dry-run:audd-receipt-proof',
      },
      policyDecision: {
        ...reddiReceiptFixtures.happyPath.policyDecision,
        quotedAmount: {
          amount: '2500000',
          asset: 'AUDD',
          network: 'solana-devnet',
          source: 'source:planning',
          specialist: 'specialist:coder',
        },
        asset: 'AUDD',
        network: 'solana-devnet',
      },
    }));

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.receipt.payment.asset, 'AUDD');
      assert.equal(result.receipt.payment.paymentProofRef, 'dry-run:audd-receipt-proof');
    }
  });

  it('rejects malformed receipt envelopes instead of accepting partial protocol records', () => {
    const result = validateReddiReceipt({ ...reddiReceiptFixtures.happyPath, schemaVersion: 'reddi.receipt.v2', evidenceRef: '' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'malformed_receipt' && item.path === '$.schemaVersion'));
      assert.ok(result.errors.some((item) => item.code === 'malformed_receipt' && item.path === '$.evidenceRef'));
    }
  });

  it('rejects missing or malformed policy quoted amounts', () => {
    const missing = validateReddiReceipt(receipt({
      // @ts-expect-error exercising runtime validation
      policyDecision: { ...reddiReceiptFixtures.happyPath.policyDecision, quotedAmount: undefined },
    }));
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.ok(missing.errors.some((item) => item.code === 'malformed_receipt' && item.path === '$.policyDecision.quotedAmount'));
    }

    const malformed = validateReddiReceipt(receipt({
      policyDecision: { ...reddiReceiptFixtures.happyPath.policyDecision, quotedAmount: { amount: '0', asset: '', network: '' } },
    }));
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.ok(malformed.errors.some((item) => item.code === 'malformed_receipt' && item.path === '$.policyDecision.quotedAmount.amount'));
    }
  });

  it('rejects unknown policy reason codes in receipt validation', () => {
    const result = validateReddiReceipt(receipt({
      // @ts-expect-error exercising runtime validation
      policyDecision: { ...reddiReceiptFixtures.happyPath.policyDecision, reasonCodes: ['totally_not_a_reason'] },
    }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((item) => item.code === 'malformed_receipt' && item.path === '$.policyDecision.reasonCodes'));
    }
  });

  it('rejects credential-bearing auth metadata, raw secrets, and provider credentials', () => {
    const probes = [
      { metadata: { auth: { accessToken: 'tok_live_should_not_leave_app' } } },
      { metadata: { provider: { apiKey: 'sk-redacted-but-still-secret-shaped' } } },
      { metadata: { note: 'Authorization: Bearer secret-token' } },
      { metadata: { signer: { privateKey: [1, 2, 3] } } },
    ];

    for (const probe of probes) {
      const result = validateReddiReceipt(receipt(probe));
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.errors.some((item) => item.code === 'credential_leakage_rejected'));
    }
  });

  it('throws when creating an invalid receipt so callers cannot accidentally persist it', () => {
    assert.throws(
      () => createReddiReceipt(receipt({ payment: { ...reddiReceiptFixtures.happyPath.payment, paymentProofRef: '' } })),
      /invalid_reddi_receipt/,
    );
  });
});
