import {
  createPaymentChallenge,
  evaluateBuyerPaymentChallenge,
  handlePaidSpecialistRequest,
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
  nonce: 'example-001',
  endpoint: 'http://localhost:4021/specialist',
});

const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
  allowedRails: [{ asset: 'USDC', network: 'solana-devnet' }],
  paymentProofRef: 'dry-run:example-001',
  evaluateBudgetPolicy: (quote) => ({
    allowed: true,
    reasonCodes: ['allowed'],
    quotedAmount: quote,
    remainingBudget: { perRequest: '50000' },
    auditNotes: ['Allowed by local dry-run budget policy.'],
  }),
});

if (!buyerDecision.allowed) {
  console.log(JSON.stringify({ ok: false, stage: 'buyer-preflight', buyerDecision }, null, 2));
  process.exitCode = 1;
} else {
  const response = await handlePaidSpecialistRequest({
    challenge,
    request: {
      body: { task: 'draft a local implementation plan' },
      paymentProofRef: buyerDecision.paymentProofRef,
    },
    policyDecision: buyerDecision.policyDecision,
    createdAt: '2026-06-18T13:45:00.000Z',
    specialist: async (body) => ({
      ok: true,
      summary: 'Local dry-run specialist completed without spend.',
      request: body,
    }),
  });

  console.log(JSON.stringify({
    ok: response.status === 200,
    status: response.status,
    receiptId: response.status === 200 ? response.receipt.job.id : undefined,
    evidenceId: response.status === 200 ? response.evidence.id : undefined,
    paymentProofRef: buyerDecision.paymentProofRef,
  }, null, 2));
}
