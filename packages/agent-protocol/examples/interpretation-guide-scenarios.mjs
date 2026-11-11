// Runnable no-spend scenarios for docs/RAP-INTERPRETATION-GUIDE-INTERIM.md (#679).
//
// Every scenario calls the built package with maintained fixtures and prints what
// the current implementation returns. Nothing here signs, spends, opens a wallet,
// calls an RPC endpoint or a provider, or reads a credential.
import {
  AUDD_DETERMINISTIC_FIXTURE_MINT,
  SOLANA_DEVNET_CAIP2,
  SPL_TOKEN_PROGRAM_ID,
  airwallexWebhookRejectionFixtures,
  buyerAuthorityPolicyExamples,
  createLocalEvidenceArchive,
  createPaymentIntentDraft,
  createPaymentObservationRecord,
  createRefundRecord,
  deriveRailNeutralPaymentReceipt,
  deriveReddiPaymentId,
  evaluateBuyerAuthorityPolicy,
  evidenceArchiveFixtureRecord,
  railNeutralProofChainFixtures,
  reddiReceiptFixtureCases,
  validatePaymentIntentRecord,
  validatePaymentObservationRecord,
  validatePaymentRecordLabels,
  validateReddiReceipt,
  validateRefundRecord,
} from '../dist/index.js';

const fixtureLabels = { environment: 'deterministic-fixture', eligibility: 'non_eligible' };
const createdAt = '2026-08-01T00:00:00.000Z';

function authority(key) {
  const example = buyerAuthorityPolicyExamples[key];
  const result = evaluateBuyerAuthorityPolicy(example.policy, example.request);
  return { allowed: result.allowed, codes: result.reasonCodes };
}

function receipt(key) {
  const result = validateReddiReceipt(reddiReceiptFixtureCases[key].receipt);
  return result.ok
    ? { ok: true, policyAllowed: result.receipt.policyDecision.allowed, codes: result.receipt.policyDecision.reasonCodes }
    : { ok: false, codes: result.errors.map((item) => item.code) };
}

function labels(value) {
  const result = validatePaymentRecordLabels(value);
  return result.ok ? { ok: true, codes: [] } : { ok: false, codes: result.errors.map((item) => item.code) };
}

function observation(status) {
  return createPaymentObservationRecord({
    labels: fixtureLabels,
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
    status,
  });
}

const scenarios = [
  {
    id: 'S1',
    name: 'Success: authority allows the request',
    run: () => authority('allow'),
    expect: { allowed: true, codes: ['buyer_authority_policy_valid'] },
    reading: 'Permission only. Nothing was signed, sent, observed or settled.',
  },
  {
    id: 'S2',
    name: 'Success: a valid receipt for allowed work',
    run: () => receipt('happyPath'),
    expect: { ok: true, policyAllowed: true },
    reading: 'A well-formed record that links policy, a payment-proof reference and evidence. Not proof of settlement or work quality.',
  },
  {
    id: 'S3',
    name: 'Safe refusal: a valid receipt that records a denial',
    run: () => receipt('policyDenial'),
    expect: { ok: true, policyAllowed: false },
    reading: 'Valid shape, refused work. A receipt that validates is not a receipt that allows.',
  },
  {
    id: 'S4',
    name: 'Safe refusal: authority expired',
    run: () => authority('expired'),
    expect: { allowed: false, codes: ['policy_expired'] },
    reading: 'Refuse. Next safe action: obtain a fresh policy from the buyer or operator.',
  },
  {
    id: 'S5',
    name: 'Safe refusal: operator approval still required',
    run: () => authority('approvalRequired'),
    expect: { allowed: false, codes: ['operator_approval_required'] },
    reading: 'Refuse until an operator approves. A model draft is never spending authority.',
  },
  {
    id: 'S6',
    name: 'Missing evidence: authority requires evidence that was not presented',
    run: () => authority('missingEvidenceRequirement'),
    expect: { allowed: false, codes: ['evidence_requirement_missing'] },
    reading: 'Refuse. Next safe action: obtain the missing evidence.',
  },
  {
    id: 'S7',
    name: 'Missing evidence: receipt has no payment-proof reference',
    run: () => receipt('missingProofReference'),
    expect: { ok: false, codes: ['payment_proof_missing'] },
    reading: 'Not a receipt. Do not treat the job as paid.',
  },
  {
    id: 'S8',
    name: 'Wrong environment: devnet evidence labelled eligible',
    run: () => labels({ environment: 'devnet-unverified', eligibility: 'eligible' }),
    expect: { ok: false, codes: ['non_live_evidence_marked_eligible'] },
    reading: 'Refuse the label. Fixture, local and devnet evidence is never eligible.',
  },
  {
    id: 'S9',
    name: 'Wrong environment: mainnet evidence labelled eligible without partner acceptance',
    run: () => labels({ environment: 'mainnet-gated', eligibility: 'eligible' }),
    expect: { ok: false, codes: ['mainnet_partner_acceptance_missing'] },
    reading: 'Refuse the label. Eligibility needs recorded partner acceptance, not an observation alone.',
  },
  {
    id: 'S10',
    name: 'Wrong environment: receipt on an unsupported network and asset pair',
    run: () => receipt('unsupportedNetworkAsset'),
    expect: { ok: false, codes: ['unsupported_network_asset'] },
    reading: 'Refuse. New rails arrive through adapter work, never silently.',
  },
  {
    id: 'S11',
    name: 'Duplicate: the same payload always derives the same record id',
    run: () => {
      const payload = { originalPaymentObservationId: 'reddi.payment-observation:example', amountBaseUnits: '1' };
      const first = deriveReddiPaymentId('refund', payload);
      const second = deriveReddiPaymentId('refund', { amountBaseUnits: '1', originalPaymentObservationId: 'reddi.payment-observation:example' });
      return { sameId: first === second };
    },
    expect: { sameId: true },
    reading: 'A repeated record is recognisable by id. This package keeps no replay ledger; the consumer must compare ids.',
  },
  {
    id: 'S12',
    name: 'Duplicate: the local evidence archive never replaces a stored record',
    run: () => {
      const archive = createLocalEvidenceArchive();
      archive.put(evidenceArchiveFixtureRecord);
      const repeat = archive.put(evidenceArchiveFixtureRecord);
      const conflict = archive.put({ ...evidenceArchiveFixtureRecord, receiptId: 'job:retry' });
      return {
        stored: archive.list().length,
        repeatOk: repeat.ok,
        conflictCodes: conflict.ok ? [] : conflict.errors.map((item) => item.code),
      };
    },
    expect: { stored: 1, repeatOk: true, conflictCodes: ['evidence_id_conflict'] },
    reading: 'The same record again is accepted once. Different content under the same id is refused, and the first record stays.',
  },
  {
    id: 'S13',
    name: 'Refund: a refund request is its own record and proves no refund',
    run: () => {
      const original = observation('observed_confirmed');
      const refund = createRefundRecord({
        labels: fixtureLabels,
        originalPaymentObservationId: original.id,
        amountBaseUnits: '2500000',
        reason: 'fixture refund request',
        state: 'requested',
        createdAt,
      });
      return { ok: validateRefundRecord(refund).ok, state: refund.state, hasRefundObservation: refund.refundObservationId !== undefined };
    },
    expect: { ok: true, state: 'requested', hasRefundObservation: false },
    reading: 'Money has not moved back. Only a refund in state observed_confirmed with its own observation records a return transfer.',
  },
  {
    id: 'S14',
    name: 'Reversal: a card-rail reversal event is not a receipt',
    run: () => {
      const result = deriveRailNeutralPaymentReceipt({ rail: 'airwallex-hosted-checkout', fixture: airwallexWebhookRejectionFixtures.reversalSucceeded });
      return result.ok ? { ok: true, codes: [] } : { ok: false, codes: [...new Set(result.errors.map((item) => item.code))] };
    },
    expect: { ok: false, codes: ['revocable_event_rejected'] },
    reading: 'Refused. Receipt v1 has no revoked or contested state, so an earlier receipt is not updated by a reversal.',
  },
  {
    id: 'S15',
    name: 'Redaction: credential-shaped metadata is rejected',
    run: () => receipt('credentialLeakage'),
    expect: { ok: false, codes: ['credential_leakage_rejected'] },
    reading: 'Rejected even when the value looks redacted. Remove the field; do not mask it.',
  },
  {
    id: 'S16',
    name: 'Redaction: the proof-chain fixture stores hashes, not prompts or outputs',
    run: () => {
      const fixture = railNeutralProofChainFixtures.payShSandboxSingleChargeBinding;
      return { status: fixture.status, rawPromptStored: fixture.guardrails.rawPromptStored, rawOutputStored: fixture.guardrails.rawOutputStored };
    },
    expect: { status: 'binding_ready', rawPromptStored: false, rawOutputStored: false },
    reading: 'A redacted record can still be bound and checked by hash. It cannot be used to read the original content.',
  },
  {
    id: 'S17',
    name: 'Unavailable dependency: the verifier could not reach a conclusion',
    run: () => {
      const record = observation('observation_inconclusive');
      return { ok: validatePaymentObservationRecord(record).ok, status: record.status };
    },
    expect: { ok: true, status: 'observation_inconclusive' },
    reading: 'A durable unknown. Not paid, not failed. Next safe action: observe again later; keep this record.',
  },
  {
    id: 'S18',
    name: 'Unavailable dependency: a rail the receipt contract does not cover',
    run: () => {
      const fixture = railNeutralProofChainFixtures.mppTempoUnsupportedNetwork;
      return { status: fixture.status };
    },
    expect: { status: 'blocked' },
    reading: 'Blocked, with a reason. Wait for adapter support; do not route around it.',
  },
  {
    id: 'S19',
    name: 'Authority: a model may draft a payment intent but cannot approve one',
    run: () => {
      const draft = createPaymentIntentDraft({
        labels: fixtureLabels,
        agreementId: 'reddi.agreement:example',
        network: { caip2: SOLANA_DEVNET_CAIP2 },
        asset: { symbol: 'USDC', amountBaseUnits: '1000' },
        payTo: 'payee-owner-fixture',
        evidenceRequired: true,
        quoteExpiresAt: '2026-08-01T00:05:00.000Z',
        expiresAt: '2026-08-01T00:10:00.000Z',
        refundPolicy: { mode: 'manual_review', description: 'fixture' },
      });
      const forged = validatePaymentIntentRecord({ ...draft, authorization: { ...draft.authorization, modelMayAuthorize: true } });
      return {
        state: draft.authorization.state,
        modelMayAuthorize: draft.authorization.modelMayAuthorize,
        forgedCodes: forged.ok ? [] : [...new Set(forged.errors.map((item) => item.code))],
      };
    },
    expect: { state: 'model_draft', modelMayAuthorize: false, forgedCodes: ['model_spend_authority_rejected'] },
    reading: 'A drafted intent is a proposal. Editing it to claim model authority is rejected.',
  },
];

const results = scenarios.map((scenario) => {
  let observed;
  try {
    observed = scenario.run();
  } catch (caught) {
    observed = { threw: caught instanceof Error ? caught.message : String(caught) };
  }
  const matches = Object.entries(scenario.expect).every(([key, value]) => JSON.stringify(observed[key]) === JSON.stringify(value));
  return { id: scenario.id, name: scenario.name, matches, observed, expected: scenario.expect, reading: scenario.reading };
});

const ok = results.every((item) => item.matches);
console.log(JSON.stringify({
  ok,
  guide: 'docs/RAP-INTERPRETATION-GUIDE-INTERIM.md',
  boundaries: { livePayment: false, walletSigning: false, rpcCall: false, providerCall: false, credentialsRead: false },
  scenarios: results,
}, null, 2));
if (!ok) process.exitCode = 1;
