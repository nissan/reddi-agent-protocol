import type { ReddiReceipt, ReddiReceiptValidationErrorCode } from './receipts.js';

export const reddiReceiptFixtures: Record<string, ReddiReceipt> = {
  happyPath: {
    schemaVersion: 'reddi.receipt.v1',
    job: { id: 'job:planning-001', type: 'planning' },
    source: { id: 'source:planning', type: 'local-fixture', uri: 'file://fixtures/planning-request.json' },
    payer: { id: 'buyer:demo', address: 'solana:buyer-demo' },
    specialist: { id: 'specialist:coder', endpoint: 'http://localhost:4021/specialist' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: 'solana-devnet',
      asset: 'USDC',
      amount: '50000',
      paymentProofRef: 'dry-run:x402-demo-payment-proof',
    },
    requestHash: 'sha256:7b2d0ef8455d0f0f41a37ea5e6a47f52c0d73d97f426097f159a98f8c8fb6b15',
    responseHash: 'sha256:8c9d1f1e3d0f02b5afcbb31dfbb3ab3de70ce1b84ff3ca856d272b2f4f7f4501',
    evidenceRef: 'file://fixtures/evidence/planning-001.json',
    policyDecision: {
      schemaVersion: 'reddi.policy-decision.v1',
      allowed: true,
      reasonCodes: ['allowed'],
      quotedAmount: {
        amount: '50000',
        asset: 'USDC',
        network: 'solana-devnet',
        source: 'source:planning',
        specialist: 'specialist:coder',
      },
      limits: {
        perRequest: '50000',
        perSession: '350000',
        perSource: '175000',
        perSpecialist: '200000',
        perAssetNetwork: '250000',
        callCount: 2,
      },
      asset: 'USDC',
      network: 'solana-devnet',
      approvalState: 'approved',
      auditNotes: ['Allowed: quoted spend is within all configured local buyer budget limits.'],
    },
    attestationStatus: 'not_requested',
    createdAt: '2026-06-18T03:52:30.000Z',
  },
  policyDenial: {
    schemaVersion: 'reddi.receipt.v1',
    job: { id: 'job:planning-002', type: 'planning' },
    source: { id: 'source:planning', type: 'local-fixture' },
    payer: { id: 'buyer:demo', address: 'solana:buyer-demo' },
    specialist: { id: 'specialist:coder', endpoint: 'http://localhost:4021/specialist' },
    protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
    payment: {
      network: 'solana-devnet',
      asset: 'USDC',
      amount: '150000',
      paymentProofRef: 'dry-run:not-paid-policy-denied',
    },
    requestHash: 'sha256:18e5cfb87844a6517aabf4d875d5697e9ef0f83e44e3f4873f4cb5bb7c8c51a5',
    responseHash: 'sha256:policy-denied-no-specialist-response',
    evidenceRef: 'file://fixtures/evidence/planning-002-denied.json',
    policyDecision: {
      schemaVersion: 'reddi.policy-decision.v1',
      allowed: false,
      reasonCodes: ['request_amount_exceeds_limit'],
      quotedAmount: {
        amount: '150000',
        asset: 'USDC',
        network: 'solana-devnet',
        source: 'source:planning',
        specialist: 'specialist:coder',
      },
      limits: { perRequest: '0' },
      asset: 'USDC',
      network: 'solana-devnet',
      approvalState: 'denied',
      auditNotes: ['Denied: request quote 150000 exceeds per-request limit 100000.'],
    },
    attestationStatus: 'not_requested',
    createdAt: '2026-06-18T03:52:30.000Z',
  },
};

export type ReddiReceiptFixtureCase = {
  description: string;
  receipt: unknown;
  expectedValid: boolean;
  expectedErrorCodes: ReddiReceiptValidationErrorCode[];
};

export const reddiReceiptFixtureCases: Record<string, ReddiReceiptFixtureCase> = {
  happyPath: {
    description: 'Allowed local USDC devnet dry-run receipt.',
    receipt: reddiReceiptFixtures.happyPath,
    expectedValid: true,
    expectedErrorCodes: [],
  },
  policyDenial: {
    description: 'Denied receipt preserving policy reason and audit note.',
    receipt: reddiReceiptFixtures.policyDenial,
    expectedValid: true,
    expectedErrorCodes: [],
  },
  missingProofReference: {
    description: 'Invalid receipt with missing payment proof reference.',
    receipt: {
      ...reddiReceiptFixtures.happyPath,
      payment: { ...reddiReceiptFixtures.happyPath.payment, paymentProofRef: '' },
    },
    expectedValid: false,
    expectedErrorCodes: ['payment_proof_missing'],
  },
  unsupportedNetworkAsset: {
    description: 'Invalid receipt with unsupported network and asset pair.',
    receipt: {
      ...reddiReceiptFixtures.happyPath,
      payment: { ...reddiReceiptFixtures.happyPath.payment, network: 'tempo-testnet', asset: 'USDG' },
      policyDecision: { ...reddiReceiptFixtures.happyPath.policyDecision, network: 'tempo-testnet', asset: 'USDG' },
    },
    expectedValid: false,
    expectedErrorCodes: ['unsupported_network_asset'],
  },
  malformedReceipt: {
    description: 'Invalid receipt with wrong schema version and missing evidence reference.',
    receipt: {
      ...reddiReceiptFixtures.happyPath,
      schemaVersion: 'reddi.receipt.v2',
      evidenceRef: '',
    },
    expectedValid: false,
    expectedErrorCodes: ['malformed_receipt'],
  },
  credentialLeakage: {
    description: 'Invalid receipt with credential-bearing metadata.',
    receipt: {
      ...reddiReceiptFixtures.happyPath,
      metadata: { provider: { apiKey: 'sk-redacted-but-still-secret-shaped' } },
    },
    expectedValid: false,
    expectedErrorCodes: ['credential_leakage_rejected'],
  },
};
