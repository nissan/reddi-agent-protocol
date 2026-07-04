import {
  validateReddiReceipt,
  type ReddiReceipt,
} from './receipts.js';
import {
  validateAttestationRecord,
  type AttestationRecord,
} from './attestation-reputation.js';

/**
 * DRAFT v1 — one-way, offline export from a `reddi.receipt.v1` (+ optional
 * `reddi.attestation.v1`) into ERC-8004 "Trustless Agents" registry *payloads
 * an EVM operator COULD submit*.
 *
 * This module is PURE: no network, no signer, no minting, no EVM write, no
 * on-chain call, no live signature verification. It only projects local RAP
 * records into illustrative EVM-shaped payload objects plus CAIP cross-refs.
 *
 * IMPORTANT — DRAFT / UNVERIFIED: ERC-8004 is a Draft EIP whose registry ABI is
 * low/medium confidence in the source research (registry layout can drift, and
 * the Validation Registry is explicitly flagged "under active update" upstream).
 * EVERY ERC-8004 field name below is illustrative and tagged
 * `(DRAFT/unverified — ERC-8004, confirm field name/shape)`. Do NOT treat these
 * as authoritative registry field names, and do NOT rely on this mapping for a
 * real submission without reconciling against the live standard.
 */
export const ERC8004_EXPORT_SCHEMA_VERSION = 'reddi.erc8004-export.v1' as const;

/** Top-level draft flag — signals the whole schema is unverified against the live standard. */
export const ERC8004_EXPORT_IS_DRAFT = true as const;

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

/** Fixed-point decimals used for the illustrative Reputation `value`. 2 => 0.00..100.00. */
const REPUTATION_VALUE_DECIMALS = 2 as const;

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
  | 'validation_registry_experimental';

/**
 * Identity Registry projection. ERC-8004 Identity is ERC-721 based; the agent is
 * an NFT whose `tokenURI` points to a registration file. We NEVER mint — this is
 * only the registration-file + metadata content an operator would host/post.
 */
export type Erc8004IdentityPayload = {
  /**
   * CAIP-style agent reference `{namespace}:{chainId}:{identityRegistry}/{tokenId}`,
   * or null if the agent is not yet registered on the EVM side.
   * (DRAFT/unverified — ERC-8004, confirm field name/shape.)
   */
  caipAgentRef: string | null;
  /** Content that would become the `tokenURI` target (the registration file). */
  registrationFile: {
    /** Display name — RAP specialist id. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
    name: string;
    /** Optional agent endpoint. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
    endpoint?: string;
    /**
     * Solana CAIP-10-style back-reference — standard-neutrality bridge so an EVM
     * reader can find the Solana-native agent. Illustrative, not a validated
     * CAIP-10 account id. (DRAFT/unverified — ERC-8004, confirm field name/shape.)
     */
    solanaAgentRef?: string;
    /** Originating protocol identity. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
    protocol: { name: string; version: string };
  };
  /**
   * Key/value metadata an operator would post via `setMetadata(agentId,key,value)`.
   * (DRAFT/unverified — ERC-8004, confirm `setMetadata` signature + key vocabulary.)
   */
  metadata: Array<{ key: string; value: string }>;
};

/**
 * Reputation Registry projection: maps one AttestationRecord -> the arguments of
 * one `giveFeedback(...)` call. Evidence is referenced by URI + hash ONLY — the
 * raw evidence payload is never inlined.
 */
export type Erc8004ReputationPayload = {
  /** Subject (specialist) agent ref. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  agentRef: string | null;
  /**
   * Signed fixed-point score as an integer decimal string (an int128 on-chain),
   * to be read together with `valueDecimals`. e.g. "9500" + decimals 2 => 95.00.
   * (DRAFT/unverified — ERC-8004, confirm `value` int128 encoding.)
   */
  value: string;
  /** uint8 fixed-point decimals for `value`. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  valueDecimals: number;
  /** Coarse tag — attestation verdict. (DRAFT/unverified — ERC-8004, confirm `tag1` semantics.) */
  tag1: string;
  /** Secondary tag — primary rubric dimension id or job type. (DRAFT/unverified — ERC-8004, confirm `tag2` semantics.) */
  tag2: string;
  /** Optional endpoint URI. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  endpointURI?: string;
  /** Evidence URI (public ref, NOT the private payload). (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  payloadURI: string;
  /** Evidence hash. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  payloadHash: string;
};

/**
 * OPTIONAL Validation Registry projection. Upstream flags the Validation Registry
 * as "under active update and discussion" — treat as experimental. Maps receipt
 * request/response/evidence into `validationResponse(...)`-style args.
 */
export type Erc8004ValidationPayload = {
  /** Subject agent ref. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  agentRef: string | null;
  /** = receipt.requestHash. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  requestHash: string;
  /** Normalized 0..100 response. (DRAFT/unverified — ERC-8004, confirm `response` encoding.) */
  response: number;
  /** = receipt.evidenceRef (public URI, not raw payload). (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  responseURI: string;
  /** = receipt.responseHash. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  hash: string;
  /** Freeform tag. (DRAFT/unverified — ERC-8004, confirm field name/shape.) */
  tag: string;
  /** Marks the Validation Registry mapping as experimental/unstable upstream. */
  experimental: true;
};

export type Erc8004ExportBundle = {
  schemaVersion: typeof ERC8004_EXPORT_SCHEMA_VERSION;
  /** Whole schema is a draft mapping against an unverified external standard. */
  draft: true;
  exportIntent: Erc8004ExportIntent;
  /**
   * Optional target chain hint, e.g. "eip155:8453" (Base). HINT ONLY — no call is
   * made and nothing is submitted. (DRAFT/unverified — ERC-8004, confirm chain refs.)
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
    /** Solana CAIP-10-style back-ref (illustrative). (DRAFT/unverified — CAIP-10, confirm account id shape.) */
    solanaAgentRef: string | null;
    /** Solana network/asset the receipt settled against (RAP-native, verified). */
    solanaNetworkAsset: string;
    /** EVM chain hint (illustrative target only). (DRAFT/unverified — ERC-8004, confirm chain refs.) */
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
  };
  notes: string[];
};

export type Erc8004ExportOptions = {
  /** Illustrative CAIP agent ref if the agent is already EVM-registered. */
  caipAgentRef?: string;
  /** Illustrative EVM chain hint, e.g. "eip155:8453". No call is made. */
  targetChainHint?: string;
  /** Include the experimental Validation Registry payload. Defaults to false. */
  includeValidation?: boolean;
  /**
   * FAIL-CLOSED: any attempt to request an actual on-chain submission/broadcast/sign
   * is rejected with `onchain_write_not_permitted`. This module never writes.
   */
  submit?: boolean;
  broadcast?: boolean;
  sign?: boolean;
};

/**
 * Pure, offline projection of a RAP receipt (+ optional attestation) into
 * ERC-8004 registry payloads. Never mints, signs, calls RPC, or reveals raw
 * evidence payloads. Fails closed on credential leakage, unsupported rails,
 * malformed input, and any request to submit on-chain.
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
    draft: true,
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

  const receiptValidation = validateReddiReceipt(receipt);
  if (!receiptValidation.ok) {
    let leaked = false;
    let unsupported = false;
    for (const err of receiptValidation.errors) {
      if (err.code === 'credential_leakage_rejected') leaked = true;
      else if (err.code === 'unsupported_network_asset') unsupported = true;
    }
    if (leaked) reasonCodes.push('credential_leakage_rejected');
    if (unsupported) reasonCodes.push('unsupported_network_asset');
    if (!leaked && !unsupported) reasonCodes.push('receipt_malformed');
    return blocked(['receipt failed reddi.receipt.v1 validation; nothing exported']);
  }

  // Belt-and-suspenders network/asset allowlist check (independent of receipt validation).
  if (!SUPPORTED_NETWORK_ASSETS.has(solanaNetworkAsset)) {
    reasonCodes.push('unsupported_network_asset');
    return blocked([`network/asset ${solanaNetworkAsset} is not in the RAP supported set`]);
  }

  // Build the Identity payload (always available for a valid receipt).
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

  // Build the Reputation payload from the attestation, if present + valid.
  let reputation: Erc8004ReputationPayload | null = null;
  let validation: Erc8004ValidationPayload | null = null;

  if (attestation === undefined) {
    reasonCodes.push('attestation_missing');
    notes.push('no attestation supplied; exporting identity metadata only');
  } else {
    const attestationValidation = validateAttestationRecord(attestation);
    if (!attestationValidation.ok) {
      if (attestationValidation.errors.some((err) => err.code === 'credential_leakage_rejected')) {
        reasonCodes.push('credential_leakage_rejected');
        return blocked(['attestation contains credential-shaped material; nothing exported']);
      }
      reasonCodes.push('attestation_malformed');
      notes.push('attestation failed reddi.attestation.v1 validation; exporting identity metadata only');
    } else {
      const record = attestationValidation.attestation;
      const score = normalizedScore(record); // 0..100
      reputation = {
        agentRef: caipAgentRef,
        value: String(Math.round(score * (10 ** REPUTATION_VALUE_DECIMALS))),
        valueDecimals: REPUTATION_VALUE_DECIMALS,
        tag1: record.verdict,
        tag2: record.rubric.dimensions[0]?.id ?? receipt.job.type ?? 'unspecified',
        endpointURI: receipt.specialist.endpoint,
        payloadURI: record.evidenceRef,
        payloadHash: record.evidenceHash,
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

  const bundle: Erc8004ExportBundle = {
    schemaVersion: ERC8004_EXPORT_SCHEMA_VERSION,
    draft: true,
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

function guardrails(): Erc8004ExportBundle['guardrails'] {
  return {
    minted: false,
    onchainWrite: false,
    signerInvoked: false,
    rpcCall: false,
    evidencePayloadInlined: false,
    liveSignatureVerified: false,
  };
}

/**
 * Illustrative Solana back-reference. NOT a validated CAIP-10 account id — it is a
 * conservative, human-readable pointer so an EVM reader can locate the Solana-native
 * agent. Uses the receipt payment network + specialist id.
 * (DRAFT/unverified — CAIP-10, confirm account id shape.)
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
