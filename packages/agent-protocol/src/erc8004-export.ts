import {
  validateReddiReceipt,
  type ReddiReceipt,
} from './receipts.js';
import {
  validateAttestationRecord,
  type AttestationRecord,
} from './attestation-reputation.js';
import type { RailNeutralPaymentReceipt } from './rail-neutral-payment-receipts.js';
import {
  verifyReputationCredential,
  type ReputationCredential,
} from './reputation-credential-export.js';

/**
 * `reddi.erc8004-export.v1` — one-way, offline export from a `reddi.receipt.v1`
 * (+ optional `reddi.attestation.v1`, + optional `reddi.reputation-credential.v1`)
 * into ERC-8004 "Trustless Agents" registry *payloads an EVM operator COULD
 * submit* — never an on-chain write.
 *
 * SPEC STATUS (promoted by #562, was DRAFT in PR #570): the RAP-side mapping —
 * source fields, exclusion rules, fail-closed lanes, reason codes, and the
 * round-trip conformance contract — is spec'd and frozen for v1. See
 * `docs/ERC8004-EXPORT-SPEC-2026-07-06.md` and the machine-readable
 * `ERC8004_EXPORT_FIELD_PROVENANCE` / `ERC8004_UNSUPPORTED_FIELDS` tables.
 *
 * EXTERNAL-STANDARD PROVENANCE: ERC-8004 itself is an external draft standard.
 * ERC-8004-side field names below are interface-level references to that draft
 * and are tagged `(unverified — ERC-8004 draft standard)`; they have NOT been
 * verified against any live deployment, and this module asserts NO deployment
 * claim on any chain (see `ERC8004_DOCUMENTED_CHAINS`). Chain refs are fixture
 * placeholders marked unverified.
 *
 * ONE-WAY BOUNDARY: RAP → ERC-8004 only. Nothing in this module (or this
 * package) imports ERC-8004 trust, feedback, identity, or validation state back
 * into RAP. Any RAP-side consumption of ERC-8004 registry state would be a
 * separate, operator-approved issue with its own trust review.
 *
 * This module is PURE and OFFLINE: no network, no RPC, no chain access, no
 * signer, no minting, no EVM write, no live signature verification. It only
 * projects local RAP records into EVM-shaped payload objects plus CAIP
 * cross-refs, and fails closed everywhere it cannot do that truthfully.
 */
export const ERC8004_EXPORT_SCHEMA_VERSION = 'reddi.erc8004-export.v1' as const;

/**
 * Promoted by #562: the RAP-side mapping spec is no longer a draft. External
 * ERC-8004 field-shape uncertainty is tracked separately and honestly via
 * `externalStandard.fieldShapesVerified: false` on every bundle — promotion of
 * the RAP spec does NOT upgrade confidence in the external draft standard.
 */
export const ERC8004_EXPORT_IS_DRAFT = false as const;

/**
 * External-standard provenance block carried on every bundle. RAP claims no
 * deployment and asserts no verified ERC-8004 field shapes.
 */
export const ERC8004_EXTERNAL_STANDARD = {
  name: 'ERC-8004 (Trustless Agents)',
  status: 'external-draft-standard',
  fieldShapesVerified: false,
  deploymentClaim: false,
} as const;

export type Erc8004ExternalStandard = typeof ERC8004_EXTERNAL_STANDARD;

/**
 * Chains where ERC-8004 registries are discussed/expected per the #562 issue
 * text. DOCUMENTATION ONLY — every entry is unverified, no deployment is
 * claimed or checked (this module never touches a chain or RPC), and the CAIP-2
 * refs are fixture placeholders. `caip2: null` where the chain id was not
 * confirmable offline.
 */
export const ERC8004_DOCUMENTED_CHAINS: ReadonlyArray<{
  name: string;
  /** CAIP-2 fixture placeholder, or null when unconfirmed. (unverified — ERC-8004 draft standard.) */
  caip2: string | null;
  source: 'issue #562 text';
  deploymentClaim: false;
  verified: false;
}> = [
  { name: 'Ethereum', caip2: 'eip155:1', source: 'issue #562 text', deploymentClaim: false, verified: false },
  { name: 'Base', caip2: 'eip155:8453', source: 'issue #562 text', deploymentClaim: false, verified: false },
  { name: 'Polygon', caip2: 'eip155:137', source: 'issue #562 text', deploymentClaim: false, verified: false },
  { name: 'Monad', caip2: null, source: 'issue #562 text', deploymentClaim: false, verified: false },
  { name: 'BNB Chain', caip2: 'eip155:56', source: 'issue #562 text', deploymentClaim: false, verified: false },
];

/** Network/asset pairs RAP receipts support. Mirrors receipts.ts `SUPPORTED_NETWORK_ASSETS`. */
const SUPPORTED_NETWORK_ASSETS = new Set([
  'solana-devnet:AUDD',
  'solana-devnet:USDC',
  'solana-devnet:SOL',
  'solana-testnet:USDC',
  'solana-testnet:SOL',
  'solana-mainnet-beta:USDC',
  'solana-mainnet-beta:SOL',
]);

/** Fixed-point decimals used for the Reputation `value`. 2 => 0.00..100.00. */
const REPUTATION_VALUE_DECIMALS = 2 as const;

/** Chain hints must be CAIP-2 EVM refs. Hint only — nothing is submitted. */
const CHAIN_HINT_PATTERN = /^eip155:\d+$/;

const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|signature|sig|signed|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey|X-Goog-Signature|X-Amz-Signature/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;

export type Erc8004ExportIntent = 'metadata_only' | 'exportable' | 'blocked';

export type Erc8004ExportReasonCode =
  | 'erc8004_export_ok'
  | 'receipt_malformed'
  | 'attestation_missing'
  | 'attestation_malformed'
  | 'unsupported_network_asset'
  | 'credential_leakage_rejected'
  | 'onchain_write_not_permitted'
  | 'validation_registry_experimental'
  // Exclusion lanes (#562 hardening) — non-final sources never export.
  | 'non_final_receipt_excluded'
  | 'attestation_state_excluded'
  | 'attestation_receipt_mismatch'
  | 'payment_proof_missing_excluded'
  | 'probe_only_receipt_excluded'
  | 'rail_neutral_bridge_required'
  | 'unsupported_chain_hint'
  // reddi.reputation-credential.v1 composition lanes (#565 / PR #569).
  | 'reputation_credential_invalid'
  | 'reputation_credential_subject_mismatch'
  | 'reputation_credential_evidence_mismatch';

/**
 * Identity Registry projection. ERC-8004 Identity is described as ERC-721
 * based; the agent is an NFT whose `tokenURI` points to a registration file.
 * We NEVER mint — this is only the registration-file + metadata content an
 * operator would host/post.
 */
export type Erc8004IdentityPayload = {
  /**
   * CAIP-style agent reference `{namespace}:{chainId}:{identityRegistry}/{tokenId}`,
   * or null if the agent is not yet registered on the EVM side. RAP cannot
   * derive an on-chain tokenId locally — it is operator-supplied or null.
   * (unverified — ERC-8004 draft standard; fixture placeholder, no deployment claim.)
   */
  caipAgentRef: string | null;
  /** Content that would become the `tokenURI` target (the registration file). */
  registrationFile: {
    /** Display name — RAP specialist id. (unverified — ERC-8004 draft standard.) */
    name: string;
    /** Optional agent endpoint. (unverified — ERC-8004 draft standard.) */
    endpoint?: string;
    /**
     * Solana CAIP-10-style back-reference — standard-neutrality bridge so an EVM
     * reader can find the Solana-native agent. Illustrative, not a validated
     * CAIP-10 account id. (unverified — CAIP-10 account id shape.)
     */
    solanaAgentRef?: string;
    /** Originating protocol identity. (unverified — ERC-8004 draft standard.) */
    protocol: { name: string; version: string };
  };
  /**
   * Key/value metadata an operator would post via `setMetadata(agentId,key,value)`.
   * (unverified — ERC-8004 draft standard `setMetadata` signature + key vocabulary.)
   */
  metadata: Array<{ key: string; value: string }>;
};

/**
 * Reference to a portable `reddi.reputation-credential.v1` (#565) that backs a
 * Reputation Registry entry. COMPOSITION, NOT DUPLICATION: only the credential
 * id, subject, evidence hashes, and proof envelope metadata (public key, never
 * the signature) are carried — the portable credential itself travels
 * separately and is verifiable fully offline via `verifyReputationCredential`.
 */
export type Erc8004ReputationCredentialRef = {
  schemaVersion: 'reddi.reputation-credential.v1';
  credentialId: string;
  subjectId: string;
  subjectType: string;
  issuedAt: string;
  score: number;
  evidenceHashes: string[];
  proof: {
    type: 'ed25519';
    canonicalization: string;
    publicKeyEncoding: string;
    publicKey: string;
  };
};

/**
 * Reputation Registry projection: maps one AttestationRecord -> the arguments of
 * one `giveFeedback(...)` call. Evidence is referenced by URI + hash ONLY — the
 * raw evidence payload is never inlined.
 */
export type Erc8004ReputationPayload = {
  /** Subject (specialist) agent ref. (unverified — ERC-8004 draft standard.) */
  agentRef: string | null;
  /**
   * Signed fixed-point score as an integer decimal string (an int128 on-chain),
   * to be read together with `valueDecimals`. e.g. "9500" + decimals 2 => 95.00.
   * (unverified — ERC-8004 draft standard `value` int128 encoding.)
   */
  value: string;
  /** uint8 fixed-point decimals for `value`. (unverified — ERC-8004 draft standard.) */
  valueDecimals: number;
  /** Coarse tag — attestation verdict. (unverified — ERC-8004 draft standard `tag1` semantics.) */
  tag1: string;
  /** Secondary tag — primary rubric dimension id or job type. (unverified — ERC-8004 draft standard `tag2` semantics.) */
  tag2: string;
  /** Optional endpoint URI. (unverified — ERC-8004 draft standard.) */
  endpointURI?: string;
  /** Evidence URI (public ref, NOT the private payload). (unverified — ERC-8004 draft standard.) */
  payloadURI: string;
  /** Evidence hash. (unverified — ERC-8004 draft standard.) */
  payloadHash: string;
  /** Optional composition ref to a portable reddi.reputation-credential.v1 (#565). */
  credentialRef?: Erc8004ReputationCredentialRef;
};

/**
 * OPTIONAL Validation Registry projection. Upstream flags the Validation Registry
 * as "under active update and discussion" — treat as experimental. Maps receipt
 * request/response/evidence into `validationResponse(...)`-style args.
 */
export type Erc8004ValidationPayload = {
  /** Subject agent ref. (unverified — ERC-8004 draft standard.) */
  agentRef: string | null;
  /** = receipt.requestHash. (unverified — ERC-8004 draft standard.) */
  requestHash: string;
  /** Normalized 0..100 response. (unverified — ERC-8004 draft standard `response` encoding.) */
  response: number;
  /** = receipt.evidenceRef (public URI, not raw payload). (unverified — ERC-8004 draft standard.) */
  responseURI: string;
  /** = receipt.responseHash. (unverified — ERC-8004 draft standard.) */
  hash: string;
  /** Freeform tag. (unverified — ERC-8004 draft standard.) */
  tag: string;
  /** Marks the Validation Registry mapping as experimental/unstable upstream. */
  experimental: true;
};

export type Erc8004ExportBundle = {
  schemaVersion: typeof ERC8004_EXPORT_SCHEMA_VERSION;
  /**
   * Promoted by #562 — the RAP-side mapping spec is final for v1. External
   * ERC-8004 uncertainty is carried in `externalStandard`, not here.
   */
  draft: false;
  /** External-standard provenance: ERC-8004 is a draft standard; no deployment claim. */
  externalStandard: Erc8004ExternalStandard;
  exportIntent: Erc8004ExportIntent;
  /**
   * Optional target chain hint, e.g. "eip155:8453" (Base). HINT ONLY — no call is
   * made and nothing is submitted; the hint is a fixture placeholder marked
   * unverified via `externalStandard`. (unverified — ERC-8004 draft standard chain refs.)
   */
  targetChainHint?: string;
  identity: Erc8004IdentityPayload | null;
  reputation: Erc8004ReputationPayload | null;
  validation: Erc8004ValidationPayload | null;
  reasonCodes: Erc8004ExportReasonCode[];
  /**
   * Cross-reference block: never asserts an on-chain write happened. Records the
   * Solana back-ref and the (non-)supported EVM chain hint for auditability.
   */
  crossReference: {
    /** Solana CAIP-10-style back-ref (illustrative). (unverified — CAIP-10 account id shape.) */
    solanaAgentRef: string | null;
    /** Solana network/asset the receipt settled against (RAP-native, verified locally). */
    solanaNetworkAsset: string;
    /** EVM chain hint (fixture placeholder, unverified). (unverified — ERC-8004 draft standard chain refs.) */
    evmChainHint: string | null;
  };
  /**
   * Hard-coded false guardrails — this export never touches EVM rails. Asserting
   * these in the output lets tests prove nothing implies an on-chain write.
   */
  guardrails: {
    minted: false;
    onchainWrite: false;
    signerInvoked: false;
    rpcCall: false;
    evidencePayloadInlined: false;
    liveSignatureVerified: false;
    /** One-way boundary: no ERC-8004 trust is ever imported back into RAP. */
    trustImported: false;
  };
  notes: string[];
};

export type Erc8004ExportOptions = {
  /** Illustrative CAIP agent ref if the agent is already EVM-registered. */
  caipAgentRef?: string;
  /** EVM chain hint, e.g. "eip155:8453". Must be CAIP-2 `eip155:*` shaped; no call is made. */
  targetChainHint?: string;
  /** Include the experimental Validation Registry payload. Defaults to false. */
  includeValidation?: boolean;
  /**
   * Optional portable reputation credential (`reddi.reputation-credential.v1`,
   * #565) to COMPOSE with the Reputation payload. Verified offline; fails closed
   * on invalid proof, subject mismatch, or evidence-hash mismatch.
   */
  reputationCredential?: unknown;
  /**
   * FAIL-CLOSED: any attempt to request an actual on-chain submission/broadcast/sign
   * is rejected with `onchain_write_not_permitted`. This module never writes.
   */
  submit?: boolean;
  broadcast?: boolean;
  sign?: boolean;
};

/**
 * Machine-readable per-field provenance for every exported field (#562).
 * `confidence: 'rap-native'` fields are sourced from locally validated RAP
 * records; `confidence: 'erc8004-draft-interface'` marks the ERC-8004-side
 * field NAME as an unverified reference to the external draft standard.
 * `lossy` documents any information loss in the projection.
 */
export const ERC8004_EXPORT_FIELD_PROVENANCE: ReadonlyArray<{
  registry: 'identity' | 'reputation' | 'validation' | 'crossReference';
  field: string;
  source: string;
  confidence: 'rap-native' | 'erc8004-draft-interface';
  lossy?: string;
}> = [
  { registry: 'identity', field: 'caipAgentRef', source: 'operator option caipAgentRef (null when unregistered)', confidence: 'erc8004-draft-interface' },
  { registry: 'identity', field: 'registrationFile.name', source: 'reddi.receipt.v1 $.specialist.id', confidence: 'rap-native' },
  { registry: 'identity', field: 'registrationFile.endpoint', source: 'reddi.receipt.v1 $.specialist.endpoint', confidence: 'rap-native' },
  { registry: 'identity', field: 'registrationFile.solanaAgentRef', source: 'derived: reddi.receipt.v1 $.payment.network + $.specialist.id', confidence: 'rap-native', lossy: 'CAIP-10-style pointer, not a validated CAIP-10 account id' },
  { registry: 'identity', field: 'registrationFile.protocol', source: 'reddi.receipt.v1 $.protocol', confidence: 'rap-native' },
  { registry: 'identity', field: 'metadata[]', source: 'derived reddi.* keys from reddi.receipt.v1 (protocol, specialistId, solanaAgentRef, jobType)', confidence: 'erc8004-draft-interface', lossy: 'setMetadata key vocabulary is not standardized upstream' },
  { registry: 'reputation', field: 'agentRef', source: 'operator option caipAgentRef (null when unregistered)', confidence: 'erc8004-draft-interface' },
  { registry: 'reputation', field: 'value', source: 'reddi.attestation.v1 $.confidence', confidence: 'erc8004-draft-interface', lossy: 'clamped to 0..100 integer, fixed-point encoded with valueDecimals=2' },
  { registry: 'reputation', field: 'valueDecimals', source: 'exporter constant (2)', confidence: 'erc8004-draft-interface' },
  { registry: 'reputation', field: 'tag1', source: 'reddi.attestation.v1 $.verdict', confidence: 'erc8004-draft-interface' },
  { registry: 'reputation', field: 'tag2', source: 'reddi.attestation.v1 $.rubric.dimensions[0].id, fallback reddi.receipt.v1 $.job.type', confidence: 'erc8004-draft-interface', lossy: 'only the first rubric dimension is carried; remaining dimensions are dropped' },
  { registry: 'reputation', field: 'endpointURI', source: 'reddi.receipt.v1 $.specialist.endpoint', confidence: 'erc8004-draft-interface' },
  { registry: 'reputation', field: 'payloadURI', source: 'reddi.attestation.v1 $.evidenceRef', confidence: 'erc8004-draft-interface' },
  { registry: 'reputation', field: 'payloadHash', source: 'reddi.attestation.v1 $.evidenceHash', confidence: 'erc8004-draft-interface' },
  { registry: 'reputation', field: 'credentialRef', source: 'reddi.reputation-credential.v1 (id, subject, evidence hashes, proof envelope sans signature)', confidence: 'rap-native', lossy: 'signature intentionally not duplicated; verify the portable credential itself offline' },
  { registry: 'validation', field: 'requestHash', source: 'reddi.receipt.v1 $.requestHash', confidence: 'erc8004-draft-interface' },
  { registry: 'validation', field: 'response', source: 'reddi.attestation.v1 $.confidence (normalized 0..100)', confidence: 'erc8004-draft-interface', lossy: 'rounded integer' },
  { registry: 'validation', field: 'responseURI', source: 'reddi.receipt.v1 $.evidenceRef', confidence: 'erc8004-draft-interface' },
  { registry: 'validation', field: 'hash', source: 'reddi.receipt.v1 $.responseHash', confidence: 'erc8004-draft-interface' },
  { registry: 'validation', field: 'tag', source: 'reddi.attestation.v1 $.verdict', confidence: 'erc8004-draft-interface' },
  { registry: 'crossReference', field: 'solanaAgentRef', source: 'derived: reddi.receipt.v1 $.payment.network + $.specialist.id', confidence: 'rap-native', lossy: 'CAIP-10-style pointer, not a validated CAIP-10 account id' },
  { registry: 'crossReference', field: 'solanaNetworkAsset', source: 'reddi.receipt.v1 $.payment.network + $.payment.asset', confidence: 'rap-native' },
  { registry: 'crossReference', field: 'evmChainHint', source: 'operator option targetChainHint (CAIP-2 eip155:* shape enforced)', confidence: 'erc8004-draft-interface', lossy: 'fixture placeholder; never verified against a deployment' },
];

/**
 * ERC-8004 surface RAP cannot (or deliberately will not) populate — documented
 * fail-closed (#562). `behavior` is what this exporter does about each gap.
 */
export const ERC8004_UNSUPPORTED_FIELDS: ReadonlyArray<{
  surface: string;
  behavior: 'null' | 'omitted' | 'blocked' | 'excluded';
  reason: string;
}> = [
  { surface: 'Identity on-chain agentId / tokenId (minting)', behavior: 'null', reason: 'RAP holds no EVM registration; caipAgentRef stays null unless operator-supplied. This exporter never mints.' },
  { surface: 'Feedback authorization / EVM signatures (feedbackAuth-style)', behavior: 'blocked', reason: 'RAP holds no EVM signer; any submit/broadcast/sign request fails closed with onchain_write_not_permitted.' },
  { surface: 'Registry write lifecycle (revoke feedback, append responses)', behavior: 'omitted', reason: 'One-way export only; no registry state is read or mutated, so no lifecycle operations exist to map.' },
  { surface: 'Negative / disputed / refunded feedback export', behavior: 'excluded', reason: 'v1 exports only passed+completed attestations; failed/disputed/refunded states are excluded fail-closed (attestation_state_excluded). Negative-feedback export would need its own spec issue.' },
  { surface: 'Full multi-dimension rubric', behavior: 'omitted', reason: 'Only the first rubric dimension id fits tag2; the full rubric stays in the RAP attestation, referenced via payloadURI/payloadHash.' },
  { surface: 'Raw evidence payloads (prompts, completions, transcripts)', behavior: 'blocked', reason: 'Evidence is exported by URI + hash only; credential/raw-payload material anywhere in the emitted bundle fails closed.' },
  { surface: 'ERC-8004 registry contract addresses / deployments', behavior: 'omitted', reason: 'No deployment claim is made on any chain; chain refs are fixture placeholders marked unverified.' },
  { surface: 'ERC-8004 trust import into RAP (identity, feedback, validation reads)', behavior: 'blocked', reason: 'One-way boundary: importing ERC-8004 trust into RAP routing/reputation requires a separate operator-approved issue.' },
];

/** Source shapes the eligibility gate understands. */
export type Erc8004ExportSource =
  | { kind: 'receipt-v1'; receipt: ReddiReceipt }
  | { kind: 'rail-neutral'; receipt: RailNeutralPaymentReceipt };

export type Erc8004SourceEligibility = {
  eligible: boolean;
  reasonCodes: Erc8004ExportReasonCode[];
  notes: string[];
};

/**
 * Exclusion gate (#562): decides whether a source record is allowed to reach
 * the ERC-8004 exporter AT ALL. Fail-closed rules:
 *
 * - rail-neutral `probe_only` receipts NEVER export (probe_only_receipt_excluded);
 * - rail-neutral `unsupported_receipt_v1_network` receipts never export;
 * - rail-neutral binding candidates must first bridge into `reddi.receipt.v1`
 *   via the rail-neutral proof chain (rail_neutral_bridge_required) — they are
 *   never exported directly;
 * - `reddi.receipt.v1` receipts must be valid, carry a payment proof ref
 *   (dry-run receipts without proof refs are excluded), and must not be in a
 *   failure-final attestation state (`failed` / `rejected`).
 */
export function evaluateErc8004SourceEligibility(source: Erc8004ExportSource): Erc8004SourceEligibility {
  if (source.kind === 'rail-neutral') {
    const supportState = source.receipt?.supportState;
    if (supportState === 'probe_only') {
      return {
        eligible: false,
        reasonCodes: ['probe_only_receipt_excluded'],
        notes: ['probe_only rail-neutral receipts are capped below receipt_binding_candidate and never export to ERC-8004 (#588 cap)'],
      };
    }
    if (supportState === 'receipt_binding_candidate') {
      return {
        eligible: false,
        reasonCodes: ['rail_neutral_bridge_required'],
        notes: ['rail-neutral binding candidates must bridge into reddi.receipt.v1 via the rail-neutral proof chain before ERC-8004 export'],
      };
    }
    return {
      eligible: false,
      reasonCodes: ['unsupported_network_asset'],
      notes: ['rail-neutral receipt network is outside the reddi.receipt.v1 network table; nothing exports'],
    };
  }

  const { reasonCodes, notes } = receiptExclusionReasons(source.receipt);
  return { eligible: reasonCodes.length === 0, reasonCodes, notes };
}

function receiptExclusionReasons(receipt: ReddiReceipt): { reasonCodes: Erc8004ExportReasonCode[]; notes: string[] } {
  const reasonCodes: Erc8004ExportReasonCode[] = [];
  const notes: string[] = [];

  const validation = validateReddiReceipt(receipt);
  if (!validation.ok) {
    let leaked = false;
    let unsupported = false;
    let proofMissing = false;
    for (const err of validation.errors) {
      if (err.code === 'credential_leakage_rejected') leaked = true;
      else if (err.code === 'unsupported_network_asset') unsupported = true;
      else if (err.code === 'payment_proof_missing') proofMissing = true;
    }
    if (leaked) reasonCodes.push('credential_leakage_rejected');
    if (unsupported) reasonCodes.push('unsupported_network_asset');
    if (proofMissing) {
      reasonCodes.push('payment_proof_missing_excluded');
      notes.push('receipt has no payment proof ref (dry-run / unproven receipt); non-final receipts never export');
    }
    if (!leaked && !unsupported && !proofMissing) reasonCodes.push('receipt_malformed');
    return { reasonCodes, notes };
  }

  if (receipt.attestationStatus === 'failed' || receipt.attestationStatus === 'rejected') {
    reasonCodes.push('non_final_receipt_excluded');
    notes.push(`receipt attestationStatus '${receipt.attestationStatus}' is a failure-final state; the receipt never exports to ERC-8004`);
  }

  return { reasonCodes, notes };
}

/**
 * Pure, offline projection of a RAP receipt (+ optional attestation, + optional
 * portable reputation credential) into ERC-8004 registry payloads. Never mints,
 * signs, calls RPC, or reveals raw evidence payloads. Fails closed on credential
 * leakage, unsupported rails, malformed input, non-final source states, invalid
 * chain hints, unverifiable reputation credentials, and any request to submit
 * on-chain.
 */
export function exportReceiptToErc8004(
  receipt: ReddiReceipt,
  attestation?: AttestationRecord,
  options: Erc8004ExportOptions = {},
): Erc8004ExportBundle {
  const reasonCodes: Erc8004ExportReasonCode[] = [];
  const notes: string[] = [];

  const solanaNetworkAsset = `${receipt?.payment?.network}:${String(receipt?.payment?.asset ?? '').trim().toUpperCase()}`;
  const evmChainHint = isNonEmptyString(options.targetChainHint) ? options.targetChainHint : null;
  const solanaAgentRef = buildSolanaAgentRef(receipt);
  const caipAgentRef = isNonEmptyString(options.caipAgentRef) ? options.caipAgentRef : null;

  const crossReference = {
    solanaAgentRef,
    solanaNetworkAsset,
    evmChainHint,
  };

  const blocked = (extraNotes: string[] = []): Erc8004ExportBundle => ({
    schemaVersion: ERC8004_EXPORT_SCHEMA_VERSION,
    draft: false,
    externalStandard: ERC8004_EXTERNAL_STANDARD,
    exportIntent: 'blocked',
    targetChainHint: evmChainHint ?? undefined,
    identity: null,
    reputation: null,
    validation: null,
    reasonCodes: dedupe(reasonCodes),
    crossReference,
    guardrails: guardrails(),
    notes: [...notes, ...extraNotes],
  });

  // FAIL-CLOSED: this module never performs an on-chain write. Any submit/broadcast/sign
  // request is rejected before any payload is emitted.
  if (options.submit === true || options.broadcast === true || options.sign === true) {
    reasonCodes.push('onchain_write_not_permitted');
    return blocked(['on-chain submission is not permitted by this exporter; payloads are export-only']);
  }

  // FAIL-CLOSED: chain hints must be CAIP-2 eip155:* shaped fixture placeholders.
  if (evmChainHint !== null && !CHAIN_HINT_PATTERN.test(evmChainHint)) {
    reasonCodes.push('unsupported_chain_hint');
    return blocked([`targetChainHint '${evmChainHint}' is not a CAIP-2 eip155:* chain ref; nothing exported`]);
  }

  // FAIL-CLOSED: a rail-neutral receipt passed here directly is routed through
  // the exclusion gate instead of being misread as a malformed receipt v1.
  if ((receipt as { schemaVersion?: unknown })?.schemaVersion === 'reddi.rail-neutral-payment-receipt.v1') {
    const eligibility = evaluateErc8004SourceEligibility({
      kind: 'rail-neutral',
      receipt: receipt as unknown as RailNeutralPaymentReceipt,
    });
    reasonCodes.push(...eligibility.reasonCodes);
    return blocked(eligibility.notes);
  }

  // Exclusion gate (#562): malformed, unproven (no payment proof), leaking, or
  // failure-final receipts never export.
  const exclusion = receiptExclusionReasons(receipt);
  if (exclusion.reasonCodes.length > 0) {
    reasonCodes.push(...exclusion.reasonCodes);
    notes.push(...exclusion.notes);
    return blocked(['receipt failed the ERC-8004 export exclusion gate; nothing exported']);
  }

  // Belt-and-suspenders network/asset allowlist check (independent of receipt validation).
  if (!SUPPORTED_NETWORK_ASSETS.has(solanaNetworkAsset)) {
    reasonCodes.push('unsupported_network_asset');
    return blocked([`network/asset ${solanaNetworkAsset} is not in the RAP supported set`]);
  }

  // Build the Identity payload (always available for a valid, non-excluded receipt).
  const identity: Erc8004IdentityPayload = {
    caipAgentRef,
    registrationFile: {
      name: receipt.specialist.id,
      endpoint: receipt.specialist.endpoint,
      solanaAgentRef: solanaAgentRef ?? undefined,
      protocol: { name: receipt.protocol.name, version: receipt.protocol.version },
    },
    metadata: buildIdentityMetadata(receipt, solanaAgentRef),
  };

  // Build the Reputation payload from the attestation, if present + valid + final.
  let reputation: Erc8004ReputationPayload | null = null;
  let validation: Erc8004ValidationPayload | null = null;

  if (attestation === undefined) {
    reasonCodes.push('attestation_missing');
    notes.push('no attestation supplied; exporting identity metadata only');
  } else if (receipt.attestationStatus !== 'attested') {
    // FAIL-CLOSED (#562): an attestation may only export when the receipt itself
    // records a final attested state — a pending/not_requested receipt cannot
    // back a reputation entry even if an attestation record is supplied.
    reasonCodes.push('attestation_state_excluded');
    notes.push(`receipt attestationStatus '${receipt.attestationStatus}' is not final; supplied attestation is excluded and identity metadata only is exported`);
  } else {
    const attestationValidation = validateAttestationRecord(attestation);
    if (!attestationValidation.ok) {
      if (attestationValidation.errors.some((err) => err.code === 'credential_leakage_rejected')) {
        reasonCodes.push('credential_leakage_rejected');
        return blocked(['attestation contains credential-shaped material; nothing exported']);
      }
      reasonCodes.push('attestation_malformed');
      notes.push('attestation failed reddi.attestation.v1 validation; exporting identity metadata only');
    } else if (attestationValidation.attestation.receiptId !== receipt.job.id) {
      // FAIL-CLOSED (#562): the attestation must reference THIS receipt.
      reasonCodes.push('attestation_receipt_mismatch');
      notes.push(`attestation.receiptId '${attestationValidation.attestation.receiptId}' does not reference receipt job '${receipt.job.id}'; exporting identity metadata only`);
    } else if (attestationValidation.attestation.verdict !== 'passed' || attestationValidation.attestation.workStatus !== 'completed') {
      // FAIL-CLOSED (#562): v1 exports only passed+completed attestations.
      // failed/disputed/refunded states never become ERC-8004 feedback entries.
      reasonCodes.push('attestation_state_excluded');
      notes.push(`attestation verdict '${attestationValidation.attestation.verdict}' / workStatus '${attestationValidation.attestation.workStatus}' is not passed+completed; excluded fail-closed (negative-feedback export is out of v1 scope)`);
    } else {
      const record = attestationValidation.attestation;
      const score = normalizedScore(record); // 0..100

      // Optional composition with a portable reddi.reputation-credential.v1 (#565).
      let credentialRef: Erc8004ReputationCredentialRef | undefined;
      if (options.reputationCredential !== undefined) {
        const composed = composeReputationCredentialRef(options.reputationCredential, receipt, record, reasonCodes, notes);
        if (composed === 'blocked') return blocked();
        credentialRef = composed;
      }

      reputation = {
        agentRef: caipAgentRef,
        value: String(Math.round(score * (10 ** REPUTATION_VALUE_DECIMALS))),
        valueDecimals: REPUTATION_VALUE_DECIMALS,
        tag1: record.verdict,
        tag2: record.rubric.dimensions[0]?.id ?? receipt.job.type ?? 'unspecified',
        endpointURI: receipt.specialist.endpoint,
        payloadURI: record.evidenceRef,
        payloadHash: record.evidenceHash,
        ...(credentialRef ? { credentialRef } : {}),
      };

      if (options.includeValidation === true) {
        validation = {
          agentRef: caipAgentRef,
          requestHash: receipt.requestHash,
          response: score,
          responseURI: receipt.evidenceRef,
          hash: receipt.responseHash,
          tag: record.verdict,
          experimental: true,
        };
        reasonCodes.push('validation_registry_experimental');
        notes.push('ERC-8004 Validation Registry is flagged experimental/unstable upstream; payload is illustrative only');
      }
    }
  }

  // A credential supplied without an exportable attestation cannot attach to anything.
  if (options.reputationCredential !== undefined && reputation === null) {
    notes.push('reputation credential supplied but no attestation-backed reputation payload was exportable; credentialRef requires an exportable attestation');
  }

  const bundle: Erc8004ExportBundle = {
    schemaVersion: ERC8004_EXPORT_SCHEMA_VERSION,
    draft: false,
    externalStandard: ERC8004_EXTERNAL_STANDARD,
    exportIntent: reputation ? 'exportable' : 'metadata_only',
    targetChainHint: evmChainHint ?? undefined,
    identity,
    reputation,
    validation,
    reasonCodes: reasonCodes.length > 0 ? dedupe(['erc8004_export_ok', ...reasonCodes]) : ['erc8004_export_ok'],
    crossReference,
    guardrails: guardrails(),
    notes,
  };

  // Final belt-and-suspenders: no emitted string may contain credential-shaped material,
  // and no raw evidence payload may be inlined (we only ever emit URIs + hashes).
  const leakPath = findCredentialMaterialInStrings(bundle);
  if (leakPath) {
    reasonCodes.length = 0;
    reasonCodes.push('credential_leakage_rejected');
    return blocked([`emitted payload contained credential-shaped material at ${leakPath}; nothing exported`]);
  }

  return bundle;
}

/**
 * Verify + project a portable reputation credential into a composition ref.
 * Returns 'blocked' after pushing the fail-closed reason code, or the ref.
 */
function composeReputationCredentialRef(
  candidate: unknown,
  receipt: ReddiReceipt,
  attestation: AttestationRecord,
  reasonCodes: Erc8004ExportReasonCode[],
  notes: string[],
): Erc8004ReputationCredentialRef | 'blocked' {
  const verified = verifyReputationCredential(candidate);
  if (!verified.ok) {
    reasonCodes.push('reputation_credential_invalid');
    notes.push('supplied reputation credential failed offline verification; nothing exported');
    return 'blocked';
  }

  const credential: ReputationCredential = verified.credential;
  if (credential.credential.subject.id !== receipt.specialist.id) {
    reasonCodes.push('reputation_credential_subject_mismatch');
    notes.push(`reputation credential subject '${credential.credential.subject.id}' does not match receipt specialist '${receipt.specialist.id}'; nothing exported`);
    return 'blocked';
  }

  const evidenceHashes = credential.credential.evidence.map((ref) => ref.evidenceHash);
  if (!evidenceHashes.includes(attestation.evidenceHash)) {
    reasonCodes.push('reputation_credential_evidence_mismatch');
    notes.push('reputation credential evidence hashes do not include the attestation evidence hash; nothing exported');
    return 'blocked';
  }

  notes.push('reputation payload composes with a verified portable reddi.reputation-credential.v1 via credentialRef (reference only; the credential travels separately)');
  return {
    schemaVersion: 'reddi.reputation-credential.v1',
    credentialId: credential.credential.id,
    subjectId: credential.credential.subject.id,
    subjectType: credential.credential.subject.type,
    issuedAt: credential.credential.issuedAt,
    score: credential.credential.reputation.score,
    evidenceHashes,
    proof: {
      type: credential.proof.type,
      canonicalization: credential.proof.canonicalization,
      publicKeyEncoding: credential.proof.publicKeyEncoding,
      publicKey: credential.proof.publicKey,
    },
  };
}

function guardrails(): Erc8004ExportBundle['guardrails'] {
  return {
    minted: false,
    onchainWrite: false,
    signerInvoked: false,
    rpcCall: false,
    evidencePayloadInlined: false,
    liveSignatureVerified: false,
    trustImported: false,
  };
}

/**
 * Illustrative Solana back-reference. NOT a validated CAIP-10 account id — it is a
 * conservative, human-readable pointer so an EVM reader can locate the Solana-native
 * agent. Uses the receipt payment network + specialist id.
 * (unverified — CAIP-10 account id shape.)
 */
function buildSolanaAgentRef(receipt: ReddiReceipt): string | null {
  const network = receipt?.payment?.network;
  const specialistId = receipt?.specialist?.id;
  if (!isNonEmptyString(network) || !isNonEmptyString(specialistId)) return null;
  return `${network}/${specialistId}`;
}

function buildIdentityMetadata(receipt: ReddiReceipt, solanaAgentRef: string | null): Array<{ key: string; value: string }> {
  const metadata: Array<{ key: string; value: string }> = [
    { key: 'reddi.protocol', value: `${receipt.protocol.name}@${receipt.protocol.version}` },
    { key: 'reddi.specialistId', value: receipt.specialist.id },
  ];
  if (isNonEmptyString(solanaAgentRef)) metadata.push({ key: 'reddi.solanaAgentRef', value: solanaAgentRef });
  if (isNonEmptyString(receipt.job.type)) metadata.push({ key: 'reddi.jobType', value: receipt.job.type });
  return metadata;
}

/** Normalized 0..100 score from an attestation (confidence is already an integer 0..100). */
function normalizedScore(attestation: AttestationRecord): number {
  const confidence = attestation.confidence;
  if (Number.isFinite(confidence)) return Math.max(0, Math.min(100, Math.round(confidence)));
  return 0;
}

function findCredentialMaterialInStrings(value: unknown, path = '$'): string | undefined {
  if (typeof value === 'string') return SENSITIVE_VALUE_PATTERN.test(value) ? path : undefined;
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCredentialMaterialInStrings(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (SENSITIVE_KEY_PATTERN.test(key)) return nextPath;
    const found = findCredentialMaterialInStrings(nested, nextPath);
    if (found) return found;
  }
  return undefined;
}

function dedupe(codes: Erc8004ExportReasonCode[]): Erc8004ExportReasonCode[] {
  return [...new Set(codes)];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
