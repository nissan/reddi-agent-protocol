// ARD no-spend quickstart: Discover -> Decide -> Prove on local fixtures.
//
// Discover a specialist from an AI Catalog, decide with a buyer-side discovery
// policy, call a local fixture specialist, and prove the call with a
// provider-signed reddi.receipt.v2 that the buyer verifies offline.
//
// Nothing here spends, opens a wallet, calls an RPC endpoint or a provider, or
// reads a credential. The provider key is derived from a public label inside
// this file, and the transaction signature in the receipt is a made-up fixture
// value: no payment was made and none is claimed.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUDD_DETERMINISTIC_FIXTURE_MINT,
  createAiCatalogSnapshot,
  createEvidenceArchiveRecord,
  createLocalEvidenceArchive,
  hashReddiReceiptV2Body,
  signReddiReceiptV2,
  validateAiCatalog,
  validateEvidenceArchiveRecord,
  validateReddiReceiptV2,
  verifyReddiReceiptV2,
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

const createdAt = '2026-06-19T07:45:00.000Z';
const jobId = 'job:ard-no-spend-001';
const evidenceId = 'evidence:ard-no-spend-001';
const sourceId = 'source:ard-local-catalog';
const specialistId = 'specialist:listing-writer';
const declaredModel = 'fixture/listing-writer-v1';
const network = 'solana-devnet';
const amount = '2500000';
const catalogPath = join(dirname(fileURLToPath(import.meta.url)), 'ard-no-spend-ai-catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A fixture ed25519 identity derived from a public label. Never use this pattern for a real key. */
function fixtureIdentity(label) {
  const seed = createHash('sha256').update(label).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { address: base58(publicKey), signer: (message) => sign(null, Buffer.from(message), privateKey) };
}

function assertOk(result, label) {
  if (!result.ok) {
    throw new Error(`${label}:${JSON.stringify(result.errors ?? result, null, 2)}`);
  }
  return result;
}

function errorCodes(result) {
  return result.ok ? [] : [...new Set(result.errors.map((item) => item.code))];
}

// --- Discover -----------------------------------------------------------------
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

const provider = fixtureIdentity('reddi:ard-no-spend:fixture-provider');
const otherProvider = fixtureIdentity('reddi:ard-no-spend:another-provider');

const candidate = {
  ...normalized.candidates[0],
  quote: {
    amount,
    asset: 'AUDD',
    network,
    expiresAt: '2026-06-19T08:45:00.000Z',
    payee: provider.address,
  },
};

// --- Decide -------------------------------------------------------------------
const discoveryPolicy = {
  allowedSourceKinds: ['direct-ai-catalog'],
  requireVerifiedTrust: true,
  allowedAssets: ['AUDD'],
  allowedNetworks: [network],
  maxQuote: { amount: '3000000', asset: 'AUDD', network },
};
const discoveryDecision = evaluateDiscoveryCandidatePolicyPreflight(candidate, discoveryPolicy);
const diagnostics = createSourceAwareCandidateDiagnostics(candidate, {
  policyDecision: discoveryDecision,
  reputation: { receiptCount: 0, attestationCount: 0 },
});
if (!discoveryDecision.allowed) {
  throw new Error(`discovery_policy_denied:${discoveryDecision.reasonCodes.join(',')}`);
}

// --- Call a local fixture specialist ------------------------------------------
const requestBody = JSON.stringify({
  brief: 'Create a public marketplace listing for a local RAP-compatible documentation specialist.',
});
const responseBody = JSON.stringify({
  title: 'RAP Documentation Listing Writer',
  summary: 'Local fixture drafted a listing for the brief.',
  reviewRequired: true,
  noSpend: true,
});
const requestHash = hashReddiReceiptV2Body(requestBody);
const responseHash = hashReddiReceiptV2Body(responseBody);

// --- Prove: the provider signs a receipt, the buyer verifies it offline --------
// A made-up transaction signature: this quickstart pays nothing.
const fixtureTxSignature = base58(createHash('sha512').update('reddi:ard-no-spend:fixture-transaction').digest());
const payment = {
  network,
  txSignature: fixtureTxSignature,
  currency: 'AUDD',
  mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
  amount,
  fee: { amount: '0' },
  settlement: 'direct',
};
const signedReceipt = await signReddiReceiptV2({
  schemaVersion: 'reddi.receipt.v2',
  providerId: provider.address,
  declaredModel,
  requestHash,
  responseHash,
  payment,
  jobId,
  issuedAt: createdAt,
}, provider.signer);

// The buyer passes only what it knows itself: who it chose, what it sent and
// received, and the payment it would have made.
const buyerExpectation = {
  providerId: provider.address,
  declaredModel,
  requestHash,
  responseHash,
  payment: { network, txSignature: fixtureTxSignature, currency: 'AUDD', mint: AUDD_DETERMINISTIC_FIXTURE_MINT, amount, settlement: 'direct' },
};
const verification = assertOk(verifyReddiReceiptV2(signedReceipt, buyerExpectation), 'receipt_verification');

// --- Evidence, attestation, reputation ----------------------------------------
// The archive refuses signature-shaped fields, so the evidence names the signed
// receipt by hash and keeps the receipt itself beside it.
const evidencePayload = {
  signedReceiptHash: `sha256:${hashReddiReceiptV2Body(JSON.stringify(signedReceipt))}`,
  sourceId,
  specialistId,
};
const evidence = createEvidenceArchiveRecord({
  id: evidenceId,
  receiptId: jobId,
  sourceId,
  requestHash: `sha256:${requestHash}`,
  responseHash: `sha256:${responseHash}`,
  evidenceRef: 'file://artifacts/ard-no-spend/evidence-001.json',
  createdAt,
  evidencePayload,
  metadata: { publicLabel: 'ARD no-spend quickstart fixture' },
});
const archive = createLocalEvidenceArchive([evidence]);

const attestation = createAttestationRecord({
  schemaVersion: 'reddi.attestation.v1',
  id: 'attestation:ard-no-spend-001',
  receiptId: jobId,
  evidenceId: evidence.id,
  evidenceRef: evidence.evidenceRef,
  evidenceHash: evidence.evidenceHash,
  attestor: { id: 'attestor:local-fixture', type: 'local-fixture' },
  trustBoundary: 'self_attested',
  verdict: 'passed',
  workStatus: 'completed',
  confidence: 82,
  rubric: {
    dimensions: [
      { id: 'evidence_integrity', score: 88, weight: 1, summary: 'Signed receipt and evidence hashes are present.', reasonCodes: ['evidence_attached'] },
      { id: 'policy_compliance', score: 92, weight: 1, summary: 'Discovery policy allowed the fixture call.', reasonCodes: ['policy_allowed'] },
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

// --- Failure states: each one must refuse --------------------------------------
const policyDenial = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
  ...discoveryPolicy,
  maxQuote: { amount: '1000', asset: 'AUDD', network },
});
const unsupportedNetwork = evaluateDiscoveryCandidatePolicyPreflight(candidate, {
  ...discoveryPolicy,
  allowedNetworks: ['solana-mainnet-beta'],
  maxQuote: { amount: '3000000', asset: 'AUDD', network: 'solana-mainnet-beta' },
});
const tamperedResponse = verifyReddiReceiptV2(signedReceipt, {
  ...buyerExpectation,
  responseHash: hashReddiReceiptV2Body(`${responseBody} `),
});
const wrongProvider = verifyReddiReceiptV2(signedReceipt, { ...buyerExpectation, providerId: otherProvider.address });
const editedAfterSigning = verifyReddiReceiptV2({
  ...signedReceipt,
  receipt: { ...signedReceipt.receipt, declaredModel: 'fixture/a-bigger-model' },
});
const differentPayment = verifyReddiReceiptV2(signedReceipt, {
  ...buyerExpectation,
  payment: { ...buyerExpectation.payment, amount: '1' },
});
const removedVersion = validateReddiReceiptV2({ ...signedReceipt.receipt, schemaVersion: 'reddi.receipt.v1' });
const missingEvidence = validateEvidenceArchiveRecord(evidence);
const unsafeMetadata = validateEvidenceArchiveRecord({
  ...evidence,
  metadata: {
    publicLabel: 'unsafe metadata fixture',
    api_key: 'redacted',
  },
}, evidencePayload);

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
  receipt: {
    schemaVersion: verification.receipt.schemaVersion,
    verified: verification.ok,
    providerId: verification.receipt.providerId,
    declaredModel: verification.receipt.declaredModel,
    jobId: verification.receipt.jobId,
    requestHash: verification.receipt.requestHash,
    responseHash: verification.receipt.responseHash,
    payment: {
      currency: verification.receipt.payment.currency,
      network: verification.receipt.payment.network,
      amount: verification.receipt.payment.amount,
      settlement: verification.receipt.payment.settlement,
      fixtureTransaction: true,
    },
    reading: 'The provider declared this model and this payment. It is not proof of which model ran, and no payment was made.',
  },
  evidence: {
    evidenceId: evidence.id,
    receiptId: evidence.receiptId,
    evidenceRef: evidence.evidenceRef,
    evidenceHash: evidence.evidenceHash,
    archiveHasEvidence: archive.has(evidence.id),
  },
  attestation: {
    id: attestation.id,
    verdict: attestation.verdict,
    trustBoundary: attestation.trustBoundary,
    reputationScore: reputation.ok ? reputation.state.score : undefined,
    routingImpact: reputation.ok ? reputation.state.routingImpact : undefined,
  },
  failures: {
    policyDenial: { allowed: policyDenial.allowed, reasonCodes: policyDenial.reasonCodes },
    unsupportedNetwork: { allowed: unsupportedNetwork.allowed, reasonCodes: unsupportedNetwork.reasonCodes },
    tamperedResponse: { ok: tamperedResponse.ok, errorCodes: errorCodes(tamperedResponse) },
    wrongProvider: { ok: wrongProvider.ok, errorCodes: errorCodes(wrongProvider) },
    editedAfterSigning: { ok: editedAfterSigning.ok, errorCodes: errorCodes(editedAfterSigning) },
    differentPayment: { ok: differentPayment.ok, errorCodes: errorCodes(differentPayment) },
    removedReceiptVersion: { ok: removedVersion.ok, errorCodes: errorCodes(removedVersion) },
    missingEvidence: { ok: missingEvidence.ok, errorCodes: errorCodes(missingEvidence) },
    unsafeMetadata: { ok: unsafeMetadata.ok, errorCodes: errorCodes(unsafeMetadata) },
  },
  boundaries: {
    hostedService: false,
    paidProvider: false,
    walletAccess: false,
    rpcCall: false,
    splTransfer: false,
    quasarCustody: false,
    settlementFinalityProof: false,
    modelExecutionProof: false,
    trustUpgrade: false,
    reputationMutation: false,
    livePayment: false,
  },
}, null, 2));
