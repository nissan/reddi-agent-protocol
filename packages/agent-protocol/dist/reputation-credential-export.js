import { createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify, } from 'node:crypto';
export const REPUTATION_CREDENTIAL_SCHEMA_VERSION = 'reddi.reputation-credential.v1';
/**
 * Canonicalisation + proof identifiers. These are baked into the signed payload
 * so a third party can reproduce the exact bytes that were signed without any
 * hosted RAP service, chain, or RPC — the credential is fully self-contained.
 */
export const REPUTATION_CREDENTIAL_CANONICALIZATION = 'reddi-jcs-sort-keys.v1';
export const REPUTATION_CREDENTIAL_PROOF_TYPE = 'ed25519';
export const REPUTATION_CREDENTIAL_PUBLIC_KEY_ENCODING = 'spki-der-base64';
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey|X-Goog-Signature|X-Amz-Signature/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;
const RAW_PAYLOAD_KEY_PATTERN = /(^|[_-])(raw[_-]?prompt|prompt|completion|raw[_-]?output|output|transcript|result[_-]?summary|resultsummary)($|[_-])|resultSummary/i;
function error(code, path, message) {
    return { code, path, message };
}
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isHashRef(value) {
    return isNonEmptyString(value) && HASH_PATTERN.test(value);
}
/**
 * Deterministic, recursively key-sorted JSON serialisation. This is the exact
 * byte string that is signed and re-verified — no `Date.now()`, randomness, or
 * environment state enters it, so any third party can reproduce it offline.
 */
function sortValue(value) {
    if (Array.isArray(value))
        return value.map(sortValue);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortValue(value[key]);
        }
        return out;
    }
    return value;
}
export function canonicalizeReputationCredentialBody(body) {
    return JSON.stringify(sortValue(body));
}
function findRawPayload(value, path = '$') {
    if (!value || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const found = findRawPayload(value[index], `${path}[${index}]`);
            if (found)
                return found;
        }
        return undefined;
    }
    for (const [key, nested] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if (RAW_PAYLOAD_KEY_PATTERN.test(key))
            return nextPath;
        const found = findRawPayload(nested, nextPath);
        if (found)
            return found;
    }
    return undefined;
}
function findCredentialMaterial(value, path = '$') {
    if (typeof value === 'string')
        return SENSITIVE_VALUE_PATTERN.test(value) ? path : undefined;
    if (!value || typeof value !== 'object')
        return undefined;
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            const found = findCredentialMaterial(value[index], `${path}[${index}]`);
            if (found)
                return found;
        }
        return undefined;
    }
    for (const [key, nested] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if (SENSITIVE_KEY_PATTERN.test(key))
            return nextPath;
        const found = findCredentialMaterial(nested, nextPath);
        if (found)
            return found;
    }
    return undefined;
}
function buildEvidenceRefs(preview, attestations, errors) {
    if (!Array.isArray(attestations) || attestations.length === 0) {
        errors.push(error('missing_attestation', '$.attestations', 'at least one attestation record is required'));
        return [];
    }
    const refs = [];
    attestations.forEach((attestation, index) => {
        const path = `$.attestations[${index}]`;
        if (!isPlainObject(attestation)) {
            errors.push(error('malformed_credential', path, 'attestation must be an object'));
            return;
        }
        if (!isHashRef(attestation.evidenceHash)) {
            errors.push(error('missing_evidence_hash', `${path}.evidenceHash`, 'each attestation must reference a sha256 evidence hash'));
            return;
        }
        if (!isNonEmptyString(attestation.id) || !isNonEmptyString(attestation.receiptId) || !isNonEmptyString(attestation.evidenceId)) {
            errors.push(error('malformed_credential', path, 'attestation must include id, receiptId, and evidenceId'));
            return;
        }
        refs.push({
            attestationId: attestation.id,
            receiptId: attestation.receiptId,
            evidenceId: attestation.evidenceId,
            evidenceHash: attestation.evidenceHash,
            verdict: attestation.verdict,
            trustBoundary: attestation.trustBoundary,
            confidence: attestation.confidence,
        });
    });
    return refs;
}
/**
 * Build the unsigned, evidence-hash-bound credential body from an existing
 * off-chain reputation preview plus its backing attestation records. Fails
 * closed: a not-ready preview, a missing evidence hash, or any raw-payload /
 * credential leakage aborts the build.
 */
export function buildReputationCredentialBody(input) {
    const errors = [];
    if (!isNonEmptyString(input?.id)) {
        errors.push(error('malformed_credential', '$.id', 'credential id is required'));
    }
    if (!isNonEmptyString(input?.issuedAt) || Number.isNaN(Date.parse(input.issuedAt))) {
        errors.push(error('malformed_credential', '$.issuedAt', 'issuedAt must be an ISO timestamp'));
    }
    const preview = input?.preview;
    if (!isPlainObject(preview) || preview.schemaVersion !== 'reddi.offchain-reputation-preview.v1') {
        errors.push(error('malformed_credential', '$.preview', 'a reddi.offchain-reputation-preview.v1 preview is required'));
        return { ok: false, errors };
    }
    if (preview.status !== 'preview_ready') {
        errors.push(error('preview_not_ready', '$.preview.status', 'only a preview_ready preview can be exported as a credential'));
    }
    const previewEvent = preview.previewEvent;
    if (!isPlainObject(previewEvent)) {
        errors.push(error('preview_not_ready', '$.preview.previewEvent', 'preview must carry a reputation event to export a score'));
    }
    if (!isHashRef(preview.evidenceSummary?.evidenceHash)) {
        errors.push(error('missing_evidence_hash', '$.preview.evidenceSummary.evidenceHash', 'preview evidence summary must carry a sha256 evidence hash'));
    }
    const refs = buildEvidenceRefs(preview, input.attestations, errors);
    if (isHashRef(preview.evidenceSummary?.evidenceHash) && refs.length > 0) {
        const summaryHash = preview.evidenceSummary.evidenceHash;
        if (!refs.some((ref) => ref.evidenceHash === summaryHash)) {
            errors.push(error('evidence_hash_mismatch', '$.preview.evidenceSummary.evidenceHash', 'preview evidence hash must match one of the attestation evidence hashes'));
        }
    }
    const subject = input.subject ?? preview.subject;
    if (!isPlainObject(subject) || !isNonEmptyString(subject.id)) {
        errors.push(error('malformed_credential', '$.subject', 'subject id is required'));
    }
    else if (input.subject && preview.subject && input.subject.id !== preview.subject.id) {
        errors.push(error('subject_mismatch', '$.subject.id', 'explicit subject must match the preview subject'));
    }
    if (errors.length > 0)
        return { ok: false, errors };
    const body = {
        schemaVersion: REPUTATION_CREDENTIAL_SCHEMA_VERSION,
        id: input.id,
        subject: { id: subject.id, type: subject.type },
        issuedAt: input.issuedAt,
        reputation: {
            status: preview.status,
            routingImpact: String(previewEvent.routingImpact),
            score: Number(previewEvent.nextScore),
            attestationKind: preview.backing.attestationKind,
            buyerFacingClaimAllowed: false,
        },
        evidence: refs,
        provenance: {
            previewId: preview.id,
            previewSchemaVersion: preview.schemaVersion,
            bindingId: preview.evidenceSummary.bindingId,
            receiptId: preview.evidenceSummary.receiptId,
            sourceKind: String(preview.source?.kind ?? 'unknown'),
            sourceId: String(preview.source?.sourceId ?? 'unknown'),
        },
        guardrails: {
            chainAgnostic: true,
            onchainSettlement: false,
            walletSigning: false,
            rpcCall: false,
            hostedRegistryWrite: false,
            livePaymentExecuted: false,
            reputationMutated: false,
            rawEvidencePayloadEmbedded: false,
        },
    };
    // Defensive: the body must never carry raw evidence payloads or credential material.
    const rawPath = findRawPayload(body);
    if (rawPath) {
        errors.push(error('raw_payload_leakage_rejected', rawPath, 'credential body must reference evidence hashes only, never raw payloads'));
    }
    const credentialPath = findCredentialMaterial(body);
    if (credentialPath) {
        errors.push(error('credential_leakage_rejected', credentialPath, 'credential body must not contain credential-shaped material'));
    }
    if (errors.length > 0)
        return { ok: false, errors };
    return { ok: true, body };
}
export function generateEphemeralEd25519Signer() {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return { privateKey, publicKey };
}
export function encodeEd25519PublicKey(publicKey) {
    return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}
/**
 * Sign a built credential body with an ed25519 keypair. When no signer is
 * supplied an ephemeral keypair is generated in-process — the private key is
 * discarded on return and never enters the credential. The public key and
 * signature are embedded so verification is fully offline.
 */
export function signReputationCredentialBody(body, signer = generateEphemeralEd25519Signer()) {
    const canonical = canonicalizeReputationCredentialBody(body);
    const signature = edSign(null, Buffer.from(canonical, 'utf8'), signer.privateKey);
    return {
        schemaVersion: REPUTATION_CREDENTIAL_SCHEMA_VERSION,
        credential: body,
        proof: {
            type: REPUTATION_CREDENTIAL_PROOF_TYPE,
            canonicalization: REPUTATION_CREDENTIAL_CANONICALIZATION,
            publicKeyEncoding: REPUTATION_CREDENTIAL_PUBLIC_KEY_ENCODING,
            publicKey: encodeEd25519PublicKey(signer.publicKey),
            signature: signature.toString('base64'),
        },
    };
}
/**
 * Build + sign in one step. Generates an ephemeral ed25519 keypair unless one
 * is provided. Chain-agnostic and no-settlement by construction.
 */
export function exportReputationCredential(input, signer = generateEphemeralEd25519Signer()) {
    const built = buildReputationCredentialBody(input);
    if (!built.ok)
        return built;
    return { ok: true, credential: signReputationCredentialBody(built.body, signer) };
}
function validateCredentialBodyShape(body, errors) {
    if (!isPlainObject(body)) {
        errors.push(error('malformed_credential', '$.credential', 'credential body must be a plain object'));
        return false;
    }
    if (body.schemaVersion !== REPUTATION_CREDENTIAL_SCHEMA_VERSION) {
        errors.push(error('unknown_version', '$.credential.schemaVersion', `expected ${REPUTATION_CREDENTIAL_SCHEMA_VERSION}`));
    }
    if (!isNonEmptyString(body.id))
        errors.push(error('malformed_credential', '$.credential.id', 'credential id is required'));
    if (!isNonEmptyString(body.issuedAt) || Number.isNaN(Date.parse(String(body.issuedAt)))) {
        errors.push(error('malformed_credential', '$.credential.issuedAt', 'issuedAt must be an ISO timestamp'));
    }
    const subject = body.subject;
    if (!isPlainObject(subject) || !isNonEmptyString(subject.id)) {
        errors.push(error('malformed_credential', '$.credential.subject', 'subject id is required'));
    }
    const evidence = body.evidence;
    if (!Array.isArray(evidence) || evidence.length === 0) {
        errors.push(error('missing_evidence_hash', '$.credential.evidence', 'credential must reference at least one evidence hash'));
    }
    else {
        evidence.forEach((ref, index) => {
            const refObj = ref;
            if (!isPlainObject(refObj) || !isHashRef(refObj.evidenceHash)) {
                errors.push(error('missing_evidence_hash', `$.credential.evidence[${index}].evidenceHash`, 'each evidence ref must carry a sha256 evidence hash'));
            }
        });
    }
    const reputation = body.reputation;
    if (!isPlainObject(reputation) || reputation.buyerFacingClaimAllowed !== false) {
        errors.push(error('malformed_credential', '$.credential.reputation', 'reputation block must be present with buyerFacingClaimAllowed=false'));
    }
    return errors.length === 0;
}
/**
 * Verify a portable reputation credential entirely offline:
 *   1. recompute the canonical serialisation of the credential body,
 *   2. verify the ed25519 signature with the embedded public key,
 *   3. fail closed on any tampering, missing field, unknown version,
 *      raw-payload / credential leakage, or unsupported proof.
 * No chain, RPC, RAP hosting, or settlement is consulted.
 */
export function verifyReputationCredential(credential) {
    const errors = [];
    if (!isPlainObject(credential)) {
        return { ok: false, errors: [error('malformed_credential', '$', 'credential must be a plain object')] };
    }
    if (credential.schemaVersion !== REPUTATION_CREDENTIAL_SCHEMA_VERSION) {
        errors.push(error('unknown_version', '$.schemaVersion', `expected ${REPUTATION_CREDENTIAL_SCHEMA_VERSION}`));
    }
    const body = credential.credential;
    const bodyOk = validateCredentialBodyShape(body, errors);
    const proof = credential.proof;
    if (!isPlainObject(proof)) {
        errors.push(error('missing_proof', '$.proof', 'signature proof is required'));
    }
    else {
        if (proof.type !== REPUTATION_CREDENTIAL_PROOF_TYPE) {
            errors.push(error('unsupported_proof_type', '$.proof.type', `expected ${REPUTATION_CREDENTIAL_PROOF_TYPE}`));
        }
        if (proof.canonicalization !== REPUTATION_CREDENTIAL_CANONICALIZATION) {
            errors.push(error('unsupported_proof_type', '$.proof.canonicalization', `expected ${REPUTATION_CREDENTIAL_CANONICALIZATION}`));
        }
        if (proof.publicKeyEncoding !== REPUTATION_CREDENTIAL_PUBLIC_KEY_ENCODING) {
            errors.push(error('unsupported_proof_type', '$.proof.publicKeyEncoding', `expected ${REPUTATION_CREDENTIAL_PUBLIC_KEY_ENCODING}`));
        }
        if (!isNonEmptyString(proof.publicKey)) {
            errors.push(error('missing_proof', '$.proof.publicKey', 'public key is required'));
        }
        if (!isNonEmptyString(proof.signature)) {
            errors.push(error('missing_proof', '$.proof.signature', 'signature is required'));
        }
    }
    // Leakage guard runs over the whole credential regardless of proof outcome.
    const rawPath = findRawPayload(credential);
    if (rawPath) {
        errors.push(error('raw_payload_leakage_rejected', rawPath, 'credential must reference evidence hashes only, never raw payloads'));
    }
    const credentialPath = findCredentialMaterial(body);
    if (credentialPath) {
        errors.push(error('credential_leakage_rejected', credentialPath, 'credential must not contain credential-shaped material'));
    }
    if (errors.length > 0)
        return { ok: false, errors };
    // At this point the body shape is valid and proof fields are present.
    const validBody = body;
    const proofObj = proof;
    let signatureValid = false;
    try {
        const canonical = canonicalizeReputationCredentialBody(validBody);
        const publicKey = createPublicKey({
            key: Buffer.from(proofObj.publicKey, 'base64'),
            type: 'spki',
            format: 'der',
        });
        signatureValid = edVerify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(proofObj.signature, 'base64'));
    }
    catch {
        signatureValid = false;
    }
    if (!signatureValid) {
        return { ok: false, errors: [error('signature_invalid', '$.proof.signature', 'ed25519 signature does not verify against the canonical credential body')] };
    }
    void bodyOk;
    return { ok: true, credential: { schemaVersion: REPUTATION_CREDENTIAL_SCHEMA_VERSION, credential: validBody, proof: proofObj } };
}
