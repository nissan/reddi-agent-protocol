// Runnable no-spend scenarios for docs/RAP-INTERPRETATION-GUIDE-INTERIM.md (#679).
//
// Every scenario calls the built package with maintained fixtures and prints what
// the current implementation returns. Nothing here spends, opens a wallet, calls
// an RPC endpoint or a provider, or reads a credential. The one signature made
// here uses a fixture key derived from a public label in this file.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import {
  AUDD_DETERMINISTIC_FIXTURE_MINT,
  SOLANA_DEVNET_CAIP2,
  SPL_TOKEN_PROGRAM_ID,
  createLocalEvidenceArchive,
  createPaymentIntentDraft,
  createPaymentObservationRecord,
  createRefundRecord,
  deriveReddiPaymentId,
  evidenceArchiveFixtureRecord,
  hashReddiReceiptV2Body,
  signReddiReceiptV2,
  validatePaymentIntentRecord,
  validatePaymentObservationRecord,
  validatePaymentRecordLabels,
  validateRefundRecord,
  validateReddiReceiptV2,
  verifyReddiReceiptV2,
} from '../dist/index.js';

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

const provider = fixtureIdentity('reddi:interpretation-guide:fixture-provider');
const otherProvider = fixtureIdentity('reddi:interpretation-guide:another-provider');
const requestBody = '{"prompt":"fixture request"}';
const responseBody = '{"answer":"fixture response"}';
// A made-up transaction signature: no payment was made.
const fixtureTxSignature = base58(createHash('sha512').update('reddi:interpretation-guide:fixture-transaction').digest());
const signedReceipt = await signReddiReceiptV2({
  schemaVersion: 'reddi.receipt.v2',
  providerId: provider.address,
  declaredModel: 'fixture/model-a',
  requestHash: hashReddiReceiptV2Body(requestBody),
  responseHash: hashReddiReceiptV2Body(responseBody),
  payment: {
    network: 'solana-devnet',
    txSignature: fixtureTxSignature,
    currency: 'AUDD',
    mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
    amount: '2500000',
    fee: { amount: '0' },
    settlement: 'direct',
  },
  issuedAt: '2026-08-01T00:00:00.000Z',
}, provider.signer);
const buyerKnows = {
  providerId: provider.address,
  declaredModel: 'fixture/model-a',
  requestHash: hashReddiReceiptV2Body(requestBody),
  responseHash: hashReddiReceiptV2Body(responseBody),
  payment: { network: 'solana-devnet', txSignature: fixtureTxSignature, currency: 'AUDD', amount: '2500000' },
};

function verify(input, expected) {
  const result = verifyReddiReceiptV2(input, expected);
  return result.ok ? { ok: true, codes: [] } : { ok: false, codes: [...new Set(result.errors.map((item) => item.code))] };
}

const fixtureLabels = { environment: 'deterministic-fixture', eligibility: 'non_eligible' };
const createdAt = '2026-08-01T00:00:00.000Z';

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
    name: 'Success: a signed receipt matches what the buyer knows',
    run: () => verify(signedReceipt, buyerKnows),
    expect: { ok: true },
    reading: 'The provider signed a statement that matches the provider you chose, the bytes you sent and received and the payment you name. It is the declared model, not proof of which model ran, and not proof of settlement.',
  },
  {
    id: 'S2',
    name: 'Weak pass: a signature checked with nothing to compare',
    run: () => verify(signedReceipt),
    expect: { ok: true },
    reading: 'Only says some key signed some statement. Always pass what you know yourself.',
  },
  {
    id: 'S3',
    name: 'Refusal: the response is not the one that was signed',
    run: () => verify(signedReceipt, { ...buyerKnows, responseHash: hashReddiReceiptV2Body(`${responseBody} `) }),
    expect: { ok: false, codes: ['response_hash_mismatch'] },
    reading: 'The receipt is for different bytes. Do not treat it as a receipt for this response.',
  },
  {
    id: 'S4',
    name: 'Refusal: signed by a different provider than the one chosen',
    run: () => verify(signedReceipt, { ...buyerKnows, providerId: otherProvider.address }),
    expect: { ok: false, codes: ['provider_mismatch'] },
    reading: 'A valid signature from the wrong key. Refuse.',
  },
  {
    id: 'S5',
    name: 'Refusal: the receipt was edited after signing',
    run: () => verify({ ...signedReceipt, receipt: { ...signedReceipt.receipt, declaredModel: 'fixture/model-b' } }),
    expect: { ok: false, codes: ['signature_invalid'] },
    reading: 'Any change to a signed field breaks the signature. Refuse.',
  },
  {
    id: 'S6',
    name: 'Refusal: the receipt names a different payment',
    run: () => verify(signedReceipt, { ...buyerKnows, payment: { ...buyerKnows.payment, amount: '1' } }),
    expect: { ok: false, codes: ['payment_mismatch'] },
    reading: 'The payment fields are the provider\'s statement. They count only when they equal what you verified yourself.',
  },
  {
    id: 'S7',
    name: 'Refusal: a removed receipt version',
    run: () => {
      const result = validateReddiReceiptV2({ ...signedReceipt.receipt, schemaVersion: 'reddi.receipt.v1' });
      return result.ok ? { ok: true, codes: [] } : { ok: false, codes: result.errors.map((item) => item.code) };
    },
    expect: { ok: false, codes: ['unsupported_version'] },
    reading: 'reddi.receipt.v2 is the only receipt this package accepts.',
  },
  {
    id: 'S8',
    name: 'Redaction: a receipt carries only the fields the version defines',
    run: () => {
      const result = validateReddiReceiptV2({ ...signedReceipt.receipt, prompt: 'raw prompt text' });
      return result.ok ? { ok: true, codes: [] } : { ok: false, codes: [...new Set(result.errors.map((item) => item.code))] };
    },
    expect: { ok: false, codes: ['malformed_receipt'] },
    reading: 'A receipt holds hashes, never prompts, outputs or credentials. An extra field is rejected, not ignored.',
  },
  {
    id: 'S9',
    name: 'Wrong environment: devnet evidence labelled eligible',
    run: () => labels({ environment: 'devnet-unverified', eligibility: 'eligible' }),
    expect: { ok: false, codes: ['non_live_evidence_marked_eligible'] },
    reading: 'Refuse the label. Fixture, local and devnet evidence is never eligible.',
  },
  {
    id: 'S10',
    name: 'Wrong environment: mainnet evidence labelled eligible without partner acceptance',
    run: () => labels({ environment: 'mainnet-gated', eligibility: 'eligible' }),
    expect: { ok: false, codes: ['mainnet_partner_acceptance_missing'] },
    reading: 'Refuse the label. Eligibility needs recorded partner acceptance, not an observation alone.',
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
    name: 'Unavailable dependency: the verifier could not reach a conclusion',
    run: () => {
      const record = observation('observation_inconclusive');
      return { ok: validatePaymentObservationRecord(record).ok, status: record.status };
    },
    expect: { ok: true, status: 'observation_inconclusive' },
    reading: 'A durable unknown. Not paid, not failed. Next safe action: observe again later; keep this record.',
  },
  {
    id: 'S15',
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
