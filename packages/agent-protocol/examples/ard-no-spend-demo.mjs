import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAiCatalogSnapshot,
  createAuddPaymentChallenge,
  createAuddSolanaPaymentPlan,
  createLocalEvidenceArchive,
  createPaymentChallenge,
  evaluateAuddPaymentPlanPreflight,
  evaluateBuyerPaymentChallenge,
  handlePaidSpecialistRequest,
  validateAiCatalog,
  validateEvidenceArchiveRecord,
} from '../dist/index.js';
import {
  createAiCatalogDiscoveryCandidates,
  evaluateDiscoveryCandidatePolicyPreflight,
} from '../dist/discovery-source.js';
import { createSourceAwareCandidateDiagnostics } from '../dist/source-diagnostics.js';
import {
  applyAttestationToReputation,
  createAttestationRecord,
  createInitialReputationState,
} from '../dist/attestation-reputation.js';
import { railNeutralProofChainFixtures } from '../dist/rail-neutral-proof-chain-fixture.js';

const createdAt = '2026-06-19T07:45:00.000Z';
const nonce = 'ard-no-spend-001';
const sourceId = 'source:ard-local-catalog';
const specialistId = 'specialist:listing-writer';
const auddMint = 'AUDDdev111111111111111111111111111111111111';
const payee = 'solana:seller-demo';
const settlementAccount = 'solana:settlement-demo';
const catalogPath = join(dirname(fileURLToPath(import.meta.url)), 'ard-no-spend-ai-catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

function hashJson(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function assertOk(result, label) {
  if (!result.ok) {
    throw new Error(`${label}:${JSON.stringify(result.errors ?? result, null, 2)}`);
  }
  return result;
}

const catalogValidation = assertOk(validateAiCatalog(catalog, {
  rawSnapshotRef: 'file://examples/ard-no-spend-ai-catalog.json',
}), 'catalog_validation');
const snapshot = createAiCatalogSnapshot(catalog, {
  rawSnapshotRef: 'file://examples/ard-no-spend-ai-catalog.json',
});

const normalized = assertOk(createAiCatalogDiscoveryCandidates(snapshot, {
  sourceKind: 'direct-ai-catalog',
  relevanceScores: {
    'urn:ai:reddi.local:specialists:listing-writer': 0.93,
  },
  trustOptionsByResourceId: {
    'urn:ai:reddi.local:specialists:listing-writer': {
      verification: {
        status: 'verified',
        verifier: 'rap:local-demo-fixture',
        checkedAt: createdAt,
      },
    },
  },
}), 'candidate_normalization');

const paymentPlan = createAuddSolanaPaymentPlan({
  network: 'solana-devnet',
  mint: auddMint,
  payee,
  settlementAccount,
  amount: '2500000',
  quoteExpiresAt: '2026-06-19T08:45:00.000Z',
  failurePolicy: {
    mode: 'no_charge_on_failure',
    description: 'Dry-run fixture jobs do not charge on failure.',
  },
  refundPolicy: {
    mode: 'manual_review',
    description: 'Live refunds require operator review before settlement.',
  },
  evidenceRequired: true,
  paymentMode: 'dry-run',
});

const candidate = {
  ...normalized.candidates[0],
  quote: {
    amount: paymentPlan.amount,
    asset: 'AUDD',
    network: paymentPlan.network,
    expiresAt: paymentPlan.quoteExpiresAt,
    payee,
  },
};

const discoveryDecision = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
  allowedSourceKinds: ['direct-ai-catalog'],
  requireVerifiedTrust: true,
  allowedAssets: ['AUDD'],
  allowedNetworks: ['solana-devnet'],
  maxQuote: { amount: '3000000', asset: 'AUDD', network: 'solana-devnet' },
});

const diagnostics = createSourceAwareCandidateDiagnostics(candidate, {
  policyDecision: discoveryDecision,
  reputation: { receiptCount: 0, attestationCount: 0 },
});

const challenge = createAuddPaymentChallenge({
  mode: 'dry-run',
  paymentPlan,
  quote: {
    source: sourceId,
    specialist: specialistId,
  },
  nonce,
  endpoint: 'fixture://specialists/listing-writer',
});

const auddDecision = evaluateAuddPaymentPlanPreflight(challenge, {
  allowedNetworks: ['solana-devnet'],
  allowedMints: [auddMint],
  allowedPayees: [payee],
  allowedSettlementAccounts: [settlementAccount],
  maxAmount: '3000000',
  requireEvidence: true,
  approvalState: 'approved',
  paymentProofRef: `dry-run:${nonce}`,
  now: '2026-06-19T07:45:01.000Z',
});

const requestBody = {
  brief: 'Create a public marketplace listing for a local RAP-compatible documentation specialist.',
};
const specialistResponse = await handlePaidSpecialistRequest({
  challenge,
  request: {
    body: requestBody,
    paymentProofRef: auddDecision.paymentProofRef,
  },
  policyDecision: auddDecision.policyDecision,
  createdAt,
  specialist: async (body) => ({
    title: 'RAP Documentation Listing Writer',
    summary: `Local fixture drafted a listing for: ${body.brief}`,
    reviewRequired: true,
    noSpend: true,
  }),
});

if (specialistResponse.status !== 200) {
  throw new Error(`specialist_response:${JSON.stringify(specialistResponse, null, 2)}`);
}

const archive = createLocalEvidenceArchive([specialistResponse.evidence]);
const attestation = createAttestationRecord({
  schemaVersion: 'reddi.attestation.v1',
  id: `attestation:${nonce}`,
  receiptId: specialistResponse.receipt.job.id,
  evidenceId: specialistResponse.evidence.id,
  evidenceRef: specialistResponse.evidence.evidenceRef,
  evidenceHash: specialistResponse.evidence.evidenceHash,
  attestor: { id: 'attestor:local-fixture', type: 'local-fixture' },
  trustBoundary: 'self_attested',
  verdict: 'passed',
  workStatus: 'completed',
  confidence: 82,
  rubric: {
    dimensions: [
      { id: 'evidence_integrity', score: 88, weight: 1, summary: 'Receipt and evidence hashes are present.', reasonCodes: ['evidence_attached'] },
      { id: 'policy_compliance', score: 92, weight: 1, summary: 'AUDD preflight and discovery policy allowed the dry-run.', reasonCodes: ['policy_allowed'] },
      { id: 'delivery_quality', score: 84, weight: 1, summary: 'Fixture produced a deterministic listing draft.', reasonCodes: ['specialist_completed'] },
    ],
  },
  createdAt,
});
const reputation = applyAttestationToReputation(
  attestation,
  createInitialReputationState({ id: specialistId, type: 'specialist' }, createdAt),
  { now: createdAt },
);

const unsupportedNetwork = evaluateAuddPaymentPlanPreflight(challenge, {
  allowedNetworks: ['solana-mainnet-beta'],
  allowedMints: [auddMint],
  allowedPayees: [payee],
  allowedSettlementAccounts: [settlementAccount],
  maxAmount: '3000000',
  requireEvidence: true,
  approvalState: 'approved',
  now: '2026-06-19T07:45:01.000Z',
});
const policyDenial = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
  allowedSourceKinds: ['direct-ai-catalog'],
  requireVerifiedTrust: true,
  allowedAssets: ['AUDD'],
  allowedNetworks: ['solana-devnet'],
  maxQuote: { amount: '1000', asset: 'AUDD', network: 'solana-devnet' },
});
const malformedChallenge = evaluateBuyerPaymentChallenge({
  ...createPaymentChallenge({
    mode: 'dry-run',
    quote: {
      amount: '2500000',
      asset: 'AUDD',
      network: 'solana-devnet',
      source: sourceId,
      specialist: specialistId,
    },
    payTo: payee,
    nonce: 'malformed-demo',
    endpoint: 'fixture://specialists/listing-writer',
  }),
  quote: { amount: 2500000 },
});
const missingEvidence = validateEvidenceArchiveRecord(specialistResponse.evidence);
const missingPaymentSetup = evaluateAuddPaymentPlanPreflight(challenge, {
  allowedNetworks: ['solana-devnet'],
  allowedMints: [auddMint],
  allowedPayees: [payee],
  allowedSettlementAccounts: [settlementAccount],
  maxAmount: '3000000',
  requireEvidence: true,
  approvalState: 'pending',
  now: '2026-06-19T07:45:01.000Z',
});
const unsafeMetadata = validateEvidenceArchiveRecord({
  ...specialistResponse.evidence,
  metadata: {
    publicLabel: 'unsafe metadata fixture',
    api_key: 'redacted',
  },
}, {
  resultRef: specialistResponse.evidence.evidenceRef,
});

const railNeutralProofCases = Object.values(railNeutralProofChainFixtures).map((item) => ({
  case: item.case,
  status: item.status,
  rail: item.sourceRef.rail,
  sourceId: item.sourceRef.sourceId,
  paymentProofRef: item.bindingRefs.paymentProofRef,
  evidenceRef: item.bindingRefs.evidenceRef,
  blockedBy: item.blockedBy?.map((error) => error.code) ?? [],
  claimBoundaryLabels: item.claimBoundaryLabels,
}));

console.log(JSON.stringify({
  ok: true,
  mode: 'no-spend',
  catalog: {
    valid: catalogValidation.ok,
    rawSnapshotRef: snapshot.rawSnapshotRef,
    publisher: snapshot.publisher,
    resourceCount: snapshot.resources.length,
  },
  discovery: {
    candidate: {
      identifier: candidate.identifier,
      name: candidate.name,
      sourceKind: candidate.sourceKind,
      publisher: candidate.publisher,
      trustStatus: candidate.providerTrust?.verification.status,
      relevanceScore: candidate.relevance?.score,
    },
    policyDecision: {
      allowed: discoveryDecision.allowed,
      reasonCodes: discoveryDecision.reasonCodes,
    },
    diagnostics: {
      capability: diagnostics.capabilityMatch.summary,
      publisher: diagnostics.publisherIdentity.summary,
      trust: diagnostics.trustEvidence.summary,
      payment: diagnostics.paymentFit.summary,
    },
  },
  payment: {
    asset: paymentPlan.asset,
    network: paymentPlan.network,
    mint: paymentPlan.mint,
    mode: paymentPlan.paymentMode,
    allowed: auddDecision.allowed,
    reasonCodes: auddDecision.reasonCodes,
    paymentProofRef: auddDecision.paymentProofRef,
  },
  execution: {
    status: specialistResponse.status,
    result: specialistResponse.result,
    receiptId: specialistResponse.receipt.job.id,
    evidenceId: specialistResponse.evidence.id,
    evidenceRef: specialistResponse.evidence.evidenceRef,
    requestHash: specialistResponse.receipt.requestHash,
    responseHash: specialistResponse.receipt.responseHash,
    archiveHasEvidence: archive.has(specialistResponse.evidence.id),
  },
  receiptEvidenceBinding: {
    receiptId: specialistResponse.receipt.job.id,
    evidenceId: specialistResponse.evidence.id,
    paymentProofRef: auddDecision.paymentProofRef,
    requestHash: specialistResponse.receipt.requestHash,
    responseHash: specialistResponse.receipt.responseHash,
    evidenceRef: specialistResponse.evidence.evidenceRef,
    bindingMode: 'local_fixture_refs_only',
  },
  attestation: {
    id: attestation.id,
    verdict: attestation.verdict,
    trustBoundary: attestation.trustBoundary,
    reputationScore: reputation.ok ? reputation.state.score : undefined,
    routingImpact: reputation.ok ? reputation.state.routingImpact : undefined,
  },
  failures: {
    policyDenial: {
      allowed: policyDenial.allowed,
      reasonCodes: policyDenial.reasonCodes,
    },
    malformedChallenge: {
      allowed: malformedChallenge.allowed,
      reasonCodes: malformedChallenge.reasonCodes,
    },
    missingEvidence: {
      ok: missingEvidence.ok,
      errorCodes: missingEvidence.ok ? [] : missingEvidence.errors.map((item) => item.code),
    },
    missingPaymentSetup: {
      allowed: missingPaymentSetup.allowed,
      reasonCodes: missingPaymentSetup.reasonCodes,
    },
    unsupportedRailNetwork: {
      allowed: unsupportedNetwork.allowed,
      reasonCodes: unsupportedNetwork.reasonCodes,
    },
    unsafeMetadata: {
      ok: unsafeMetadata.ok,
      errorCodes: unsafeMetadata.ok ? [] : unsafeMetadata.errors.map((item) => item.code),
    },
  },
  railNeutralProofChain: {
    schemaVersion: 'reddi.rail-neutral-proof-chain-fixture.v1',
    bindingReadyCase: railNeutralProofCases.find((item) => item.status === 'binding_ready')?.case,
    blockedCases: railNeutralProofCases.filter((item) => item.status === 'blocked').map((item) => item.case),
    cases: railNeutralProofCases,
  },
  downstreamPublicProofContracts: {
    publicProofPageData: 'reddi.economic-demo.public-proof-page-data.v1',
    paidWorkflowProofUiFixturePack: 'reddi.economic-demo.paid-workflow-proof-ui-fixture-pack.v1',
    stateLabels: [
      'fixture_zero_spend',
      'planned_dry_run',
      'simulated',
      'devnet_proof_metadata',
      'live_gated',
      'production_live_disabled',
    ],
  },
  boundaries: {
    hostedService: false,
    paidProvider: false,
    walletAccess: false,
    rpcCall: false,
    splTransfer: false,
    quasarCustody: false,
    settlementFinalityProof: false,
    trustUpgrade: false,
    reputationMutation: false,
    livePayment: false,
  },
  hashes: {
    request: hashJson(requestBody),
    receipt: hashJson(specialistResponse.receipt),
  },
}, null, 2));
