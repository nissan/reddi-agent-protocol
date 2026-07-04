import { validateReddiReceipt, } from './receipts.js';
import { validateAttestationRecord, } from './attestation-reputation.js';
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
export const ERC8004_EXPORT_SCHEMA_VERSION = 'reddi.erc8004-export.v1';
/** Top-level draft flag — signals the whole schema is unverified against the live standard. */
export const ERC8004_EXPORT_IS_DRAFT = true;
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
const REPUTATION_VALUE_DECIMALS = 2;
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|signature|sig|signed|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey|X-Goog-Signature|X-Amz-Signature/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;
/**
 * Pure, offline projection of a RAP receipt (+ optional attestation) into
 * ERC-8004 registry payloads. Never mints, signs, calls RPC, or reveals raw
 * evidence payloads. Fails closed on credential leakage, unsupported rails,
 * malformed input, and any request to submit on-chain.
 */
export function exportReceiptToErc8004(receipt, attestation, options = {}) {
    const reasonCodes = [];
    const notes = [];
    const solanaNetworkAsset = `${receipt?.payment?.network}:${String(receipt?.payment?.asset ?? '').trim().toUpperCase()}`;
    const evmChainHint = isNonEmptyString(options.targetChainHint) ? options.targetChainHint : null;
    const solanaAgentRef = buildSolanaAgentRef(receipt);
    const caipAgentRef = isNonEmptyString(options.caipAgentRef) ? options.caipAgentRef : null;
    const crossReference = {
        solanaAgentRef,
        solanaNetworkAsset,
        evmChainHint,
    };
    const blocked = (extraNotes = []) => ({
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
            if (err.code === 'credential_leakage_rejected')
                leaked = true;
            else if (err.code === 'unsupported_network_asset')
                unsupported = true;
        }
        if (leaked)
            reasonCodes.push('credential_leakage_rejected');
        if (unsupported)
            reasonCodes.push('unsupported_network_asset');
        if (!leaked && !unsupported)
            reasonCodes.push('receipt_malformed');
        return blocked(['receipt failed reddi.receipt.v1 validation; nothing exported']);
    }
    // Belt-and-suspenders network/asset allowlist check (independent of receipt validation).
    if (!SUPPORTED_NETWORK_ASSETS.has(solanaNetworkAsset)) {
        reasonCodes.push('unsupported_network_asset');
        return blocked([`network/asset ${solanaNetworkAsset} is not in the RAP supported set`]);
    }
    // Build the Identity payload (always available for a valid receipt).
    const identity = {
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
    let reputation = null;
    let validation = null;
    if (attestation === undefined) {
        reasonCodes.push('attestation_missing');
        notes.push('no attestation supplied; exporting identity metadata only');
    }
    else {
        const attestationValidation = validateAttestationRecord(attestation);
        if (!attestationValidation.ok) {
            if (attestationValidation.errors.some((err) => err.code === 'credential_leakage_rejected')) {
                reasonCodes.push('credential_leakage_rejected');
                return blocked(['attestation contains credential-shaped material; nothing exported']);
            }
            reasonCodes.push('attestation_malformed');
            notes.push('attestation failed reddi.attestation.v1 validation; exporting identity metadata only');
        }
        else {
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
    const bundle = {
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
function guardrails() {
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
function buildSolanaAgentRef(receipt) {
    const network = receipt?.payment?.network;
    const specialistId = receipt?.specialist?.id;
    if (!isNonEmptyString(network) || !isNonEmptyString(specialistId))
        return null;
    return `${network}/${specialistId}`;
}
function buildIdentityMetadata(receipt, solanaAgentRef) {
    const metadata = [
        { key: 'reddi.protocol', value: `${receipt.protocol.name}@${receipt.protocol.version}` },
        { key: 'reddi.specialistId', value: receipt.specialist.id },
    ];
    if (isNonEmptyString(solanaAgentRef))
        metadata.push({ key: 'reddi.solanaAgentRef', value: solanaAgentRef });
    if (isNonEmptyString(receipt.job.type))
        metadata.push({ key: 'reddi.jobType', value: receipt.job.type });
    return metadata;
}
/** Normalized 0..100 score from an attestation (confidence is already an integer 0..100). */
function normalizedScore(attestation) {
    const confidence = attestation.confidence;
    if (Number.isFinite(confidence))
        return Math.max(0, Math.min(100, Math.round(confidence)));
    return 0;
}
function findCredentialMaterialInStrings(value, path = '$') {
    if (typeof value === 'string')
        return SENSITIVE_VALUE_PATTERN.test(value) ? path : undefined;
    if (!value || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const found = findCredentialMaterialInStrings(value[index], `${path}[${index}]`);
            if (found)
                return found;
        }
        return undefined;
    }
    for (const [key, nested] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if (SENSITIVE_KEY_PATTERN.test(key))
            return nextPath;
        const found = findCredentialMaterialInStrings(nested, nextPath);
        if (found)
            return found;
    }
    return undefined;
}
function dedupe(codes) {
    return [...new Set(codes)];
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
