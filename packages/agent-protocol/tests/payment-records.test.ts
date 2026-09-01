import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDD_DETERMINISTIC_FIXTURE_MINT,
  AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
  SOLANA_DEVNET_CAIP2,
  SOLANA_MAINNET_BETA_CAIP2,
  SOLANA_TESTNET_CAIP2,
  SPL_TOKEN_PROGRAM_ID,
  canonicalPaymentHash,
  canonicalizePaymentObject,
  createPaymentAgreementRecord,
  createPaymentIntentDraft,
  createPaymentJobRecord,
  createPaymentObservationRecord,
  createRefundRecord,
  deriveReddiPaymentId,
  formatPaymentObservationProofRef,
  validatePaymentIntentRecord,
  validatePaymentObservationRecord,
  validatePaymentRecordLabels,
  type ReddiPaymentRecordLabels,
} from '../dist/index.js';

const labels: ReddiPaymentRecordLabels = {
  environment: 'deterministic-fixture',
  eligibility: 'non_eligible',
  exclusionReason: 'offline fixture is never grant-volume eligible',
};

const requestDisclosureHash = canonicalPaymentHash({ request: 'redacted fixture request' });
const signedOfferHash = canonicalPaymentHash({ offer: 'seller terms fixture' });
const buyerPolicyDecisionHash = canonicalPaymentHash({ allowed: true, approvalState: 'approved' });
const sellerTermsHash = canonicalPaymentHash({ failure: 'manual review refunds' });
const createdAt = '2026-09-01T01:00:00.000Z';

describe('canonical RAP payment identifiers and records', () => {
  it('uses stable canonical JSON hashing independent of object key order', () => {
    const first = { b: ['two', { z: true, a: 1 }], a: 'one' };
    const second = { a: 'one', b: ['two', { a: 1, z: true }] };

    assert.equal(canonicalizePaymentObject(first), canonicalizePaymentObject(second));
    assert.equal(canonicalPaymentHash(first), canonicalPaymentHash(second));
    assert.notEqual(canonicalPaymentHash(first), canonicalPaymentHash({ ...second, a: 'tampered' }));
    assert.match(deriveReddiPaymentId('payment-intent', first), /^reddi\.payment-intent:[a-f0-9]{64}$/);
  });

  it('creates a rail-neutral job -> agreement -> payment intent -> observation -> refund chain', () => {
    const job = createPaymentJobRecord({
      labels,
      requestDisclosureHash,
      sourceId: 'source:fixture-catalog',
      specialistId: 'specialist:fixture-worker',
      nonce: 'job-nonce-001',
      createdAt,
    });
    const agreement = createPaymentAgreementRecord({
      labels,
      jobId: job.id,
      signedOfferHash,
      buyerPolicyDecisionHash,
      sellerTermsHash,
      quoteExpiresAt: '2026-09-01T02:00:00.000Z',
      createdAt,
    });
    const intent = createPaymentIntentDraft({
      labels,
      agreementId: agreement.id,
      network: { caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', rapAlias: 'solana-devnet' },
      asset: {
        symbol: 'AUDD',
        mint: 'AUDDdev111111111111111111111111111111111111',
        tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        decimals: 6,
        amountBaseUnits: '2500000',
      },
      payTo: 'payee-owner-fixture',
      destinationTokenAccount: 'payee-audd-token-account-fixture',
      memo: 'reddi:pay:fixture-intent',
      evidenceRequired: true,
      quoteExpiresAt: '2026-09-01T02:00:00.000Z',
      expiresAt: '2026-09-01T02:00:00.000Z',
      refundPolicy: { mode: 'manual_review', description: 'Refunds are separately authorized transfers.' },
      createdAt,
    });

    assert.equal(intent.authorization.state, 'model_draft');
    assert.equal(intent.authorization.modelMayAuthorize, false);
    assert.equal(intent.authorization.operatorApprovalRequired, false);

    const paymentProofRef = formatPaymentObservationProofRef({
      network: intent.network,
      asset: 'AUDD',
      signature: 'fixtureSignature1111111111111111111111111111111111',
      instructionIndex: '0',
      mint: intent.asset.mint,
      amountBaseUnits: intent.asset.amountBaseUnits,
    });
    const observation = createPaymentObservationRecord({
      labels,
      paymentIntentId: intent.id,
      agreementId: agreement.id,
      observedAt: createdAt,
      verifier: { name: 'fixture-spl-transfer-checked', version: 'v1' },
      payment: {
        rail: 'svm-spl-token-transfer-checked',
        network: intent.network,
        asset: 'AUDD',
        mint: intent.asset.mint,
        tokenProgram: intent.asset.tokenProgram,
        amountBaseUnits: intent.asset.amountBaseUnits,
        payTo: intent.payTo,
        sourceTokenAccount: 'payer-audd-token-account-fixture',
        destinationTokenAccount: intent.destinationTokenAccount ?? 'payee-audd-token-account-fixture',
        authority: 'payer-owner-fixture',
        signature: 'fixtureSignature1111111111111111111111111111111111',
        instructionIndex: '0',
        memo: intent.memo,
        paymentProofRef,
      },
      confirmation: { slot: 443284058, blockTime: 1785523200, commitment: 'confirmed' },
      status: 'observed_confirmed',
    });
    const refund = createRefundRecord({
      labels,
      originalPaymentObservationId: observation.id,
      amountBaseUnits: '2500000',
      reason: 'fixture refund branch records a separate transfer requirement',
      state: 'manual_review',
      createdAt,
    });

    assert.match(job.id, /^reddi\.job:/);
    assert.match(agreement.id, /^reddi\.agreement:/);
    assert.match(intent.id, /^reddi\.payment-intent:/);
    assert.match(observation.id, /^reddi\.payment-observation:/);
    assert.match(refund.id, /^reddi\.refund:/);
    assert.equal(observation.payment.paymentProofRef, paymentProofRef);
    assert.equal(observation.labels.eligibility, 'non_eligible');
  });

  it('enforces canonical AUDD rail identity on generic payment intents', () => {
    const intent = createPaymentIntentDraft({
      labels,
      agreementId: 'reddi.agreement:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      network: { caip2: SOLANA_DEVNET_CAIP2 },
      asset: {
        symbol: 'AUDD',
        mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        amountBaseUnits: '1',
      },
      payTo: 'payee-owner-fixture',
      destinationTokenAccount: 'payee-audd-token-account-fixture',
      evidenceRequired: true,
      quoteExpiresAt: '2026-09-01T02:00:00.000Z',
      expiresAt: '2026-09-01T02:00:00.000Z',
      refundPolicy: { mode: 'manual_review', description: 'Refunds are separate transfers.' },
    });
    assert.equal(validatePaymentIntentRecord(intent).ok, true);

    assert.throws(
      () => createPaymentIntentDraft({
        ...intent,
        labels: { environment: 'controlled-live', eligibility: 'pending_partner_acceptance' },
        network: { caip2: SOLANA_MAINNET_BETA_CAIP2, rapAlias: 'solana-mainnet-beta' },
        asset: { ...intent.asset, mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT },
        operatorApprovalRequired: true,
      }),
      /audd_rail_label_mismatch/,
    );
    assert.throws(
      () => createPaymentIntentDraft({
        ...intent,
        labels: { environment: 'mainnet-gated', eligibility: 'eligible', partnerAcceptanceRef: 'audd:not-real' },
        network: { caip2: SOLANA_MAINNET_BETA_CAIP2, rapAlias: 'solana-mainnet-beta' },
        asset: { ...intent.asset, mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT },
        operatorApprovalRequired: true,
      }),
      /audd_rail_label_mismatch/,
    );
    assert.throws(
      () => createPaymentIntentDraft({
        ...intent,
        network: { caip2: SOLANA_TESTNET_CAIP2, rapAlias: 'solana-testnet' },
        asset: { ...intent.asset, mint: 'UnknownAuddTestnetMint111111111111111111111111' },
        operatorApprovalRequired: true,
      }),
      /audd_rail_identity_mismatch/,
    );

    const lowercaseUnknownIntent = validatePaymentIntentRecord({
      ...intent,
      asset: { ...intent.asset, symbol: 'audd', mint: 'UnknownAuddMint111111111111111111111111111111' },
    });
    assert.equal(lowercaseUnknownIntent.ok, false);
    if (!lowercaseUnknownIntent.ok) assert.ok(lowercaseUnknownIntent.errors.some((item) => item.code === 'audd_rail_identity_mismatch' && item.path === '$.asset.symbol'));
  });

  it('enforces canonical AUDD rail identity on generic payment observations', () => {
    const observation = createPaymentObservationRecord({
      labels,
      observedAt: createdAt,
      verifier: { name: 'fixture-spl-transfer-checked', version: 'v1' },
      payment: {
        rail: 'svm-spl-token-transfer-checked',
        network: { caip2: SOLANA_DEVNET_CAIP2 },
        asset: 'AUDD',
        mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        amountBaseUnits: '2500000',
        payTo: 'payee-owner-fixture',
        sourceTokenAccount: 'payer-audd-token-account-fixture',
        destinationTokenAccount: 'payee-audd-token-account-fixture',
        authority: 'payer-owner-fixture',
        signature: 'fixtureSignature2222222222222222222222222222222222',
        instructionIndex: '0',
      },
      confirmation: { slot: 443284058, blockTime: 1785523200, commitment: 'confirmed' },
      status: 'observed_confirmed',
    });
    assert.equal(validatePaymentObservationRecord(observation).ok, true);

    const wrongRail = validatePaymentObservationRecord({
      ...observation,
      payment: { ...observation.payment, rail: 'unrelated-payment-rail' },
    });
    assert.equal(wrongRail.ok, false);
    if (!wrongRail.ok) assert.ok(wrongRail.errors.some((item) => item.code === 'audd_rail_identity_mismatch' && item.path === '$.payment.rail'));

    const missingTokenProgram = validatePaymentObservationRecord({
      ...observation,
      payment: { ...observation.payment, tokenProgram: undefined },
    });
    assert.equal(missingTokenProgram.ok, false);
    if (!missingTokenProgram.ok) assert.ok(missingTokenProgram.errors.some((item) => item.code === 'audd_rail_identity_mismatch' && item.path === '$.payment.tokenProgram'));

    const lowercaseForgedAudd = validatePaymentObservationRecord({
      ...observation,
      payment: {
        ...observation.payment,
        asset: 'audd',
        mint: 'UnknownAuddMint111111111111111111111111111111',
        rail: 'unrelated-payment-rail',
        tokenProgram: undefined,
      },
    });
    assert.equal(lowercaseForgedAudd.ok, false);
    if (!lowercaseForgedAudd.ok) {
      assert.ok(lowercaseForgedAudd.errors.some((item) => item.path === '$.payment.asset'));
      assert.ok(lowercaseForgedAudd.errors.some((item) => item.path === '$.payment.rail'));
      assert.ok(lowercaseForgedAudd.errors.some((item) => item.path === '$.payment.tokenProgram'));
    }

    assert.throws(
      () => createPaymentObservationRecord({
        labels: { environment: 'controlled-live', eligibility: 'pending_partner_acceptance' },
        observedAt: createdAt,
        verifier: { name: 'fixture-spl-transfer-checked', version: 'v1' },
        payment: {
          ...observation.payment,
          network: { caip2: SOLANA_TESTNET_CAIP2, rapAlias: 'solana-testnet' },
          mint: 'UnknownAuddTestnetMint111111111111111111111111',
          signature: 'fixtureSignature3333333333333333333333333333333333',
          paymentProofRef: undefined,
        },
        confirmation: observation.confirmation,
        status: 'observed_confirmed',
      }),
      /audd_rail_identity_mismatch/,
    );

    const controlledLiveMainnet = validatePaymentObservationRecord({
      ...observation,
      labels: { environment: 'controlled-live', eligibility: 'pending_partner_acceptance' },
      payment: {
        ...observation.payment,
        network: { caip2: SOLANA_MAINNET_BETA_CAIP2, rapAlias: 'solana-mainnet-beta' },
        mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      },
    });
    assert.equal(controlledLiveMainnet.ok, false);
    if (!controlledLiveMainnet.ok) assert.ok(controlledLiveMainnet.errors.some((item) => item.code === 'audd_rail_label_mismatch' && item.path === '$.labels.environment'));

    const eligibleMainnet = validatePaymentObservationRecord({
      ...observation,
      labels: { environment: 'mainnet-gated', eligibility: 'eligible', partnerAcceptanceRef: 'audd:not-real' },
      payment: {
        ...observation.payment,
        network: { caip2: SOLANA_MAINNET_BETA_CAIP2, rapAlias: 'solana-mainnet-beta' },
        mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      },
    });
    assert.equal(eligibleMainnet.ok, false);
    if (!eligibleMainnet.ok) assert.ok(eligibleMainnet.errors.some((item) => item.code === 'audd_rail_label_mismatch' && item.path === '$.labels.eligibility'));
  });

  it('rejects fixture, local-test-mint, and devnet records marked grant eligible', () => {
    for (const environment of ['deterministic-fixture', 'local-test-mint', 'devnet-unverified'] as const) {
      const result = validatePaymentRecordLabels({ environment, eligibility: 'eligible' });
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.errors.some((item) => item.code === 'non_live_evidence_marked_eligible'));
    }
  });

  it('requires partner provenance before a mainnet-gated row can be eligible', () => {
    const missing = validatePaymentRecordLabels({ environment: 'mainnet-gated', eligibility: 'eligible' });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.errors.some((item) => item.code === 'mainnet_partner_acceptance_missing'));

    const pending = validatePaymentRecordLabels({ environment: 'mainnet-gated', eligibility: 'pending_partner_acceptance' });
    assert.equal(pending.ok, true);

    const eligible = validatePaymentRecordLabels({ environment: 'mainnet-gated', eligibility: 'eligible', partnerAcceptanceRef: 'audd-approval:future-explicit-written-alignment' });
    assert.equal(eligible.ok, true);
  });

  it('requires partner provenance before a controlled-live row can be eligible', () => {
    const missing = validatePaymentRecordLabels({ environment: 'controlled-live', eligibility: 'eligible' });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.errors.some((item) => item.code === 'mainnet_partner_acceptance_missing'));

    const eligible = validatePaymentRecordLabels({ environment: 'controlled-live', eligibility: 'eligible', partnerAcceptanceRef: 'audd-approval:future-explicit-written-alignment' });
    assert.equal(eligible.ok, true);

    const pending = validatePaymentRecordLabels({ environment: 'controlled-live', eligibility: 'pending_partner_acceptance' });
    assert.equal(pending.ok, true);
  });

  it('rejects model-controlled spend authority on payment intents', () => {
    const intent = createPaymentIntentDraft({
      labels,
      agreementId: 'reddi.agreement:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      network: { caip2: SOLANA_DEVNET_CAIP2, rapAlias: 'solana-devnet' },
      asset: {
        symbol: 'AUDD',
        mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: 6,
        amountBaseUnits: '1',
      },
      payTo: 'payee-owner-fixture',
      evidenceRequired: true,
      quoteExpiresAt: '2026-09-01T02:00:00.000Z',
      expiresAt: '2026-09-01T02:00:00.000Z',
      refundPolicy: { mode: 'manual_review', description: 'Refunds are separate transfers.' },
    });
    const tampered = {
      ...intent,
      authorization: {
        ...intent.authorization,
        modelMayAuthorize: true,
      },
    };
    const result = validatePaymentIntentRecord(tampered);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.some((item) => item.code === 'model_spend_authority_rejected'));
  });
});
