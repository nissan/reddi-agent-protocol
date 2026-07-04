import { type KeyObject } from 'node:crypto';
import type { AttestationRecord } from './attestation-reputation.js';
import type { OffchainReputationPreview } from './offchain-reputation-preview.js';
export declare const REPUTATION_CREDENTIAL_SCHEMA_VERSION: "reddi.reputation-credential.v1";
/**
 * Canonicalisation + proof identifiers. These are baked into the signed payload
 * so a third party can reproduce the exact bytes that were signed without any
 * hosted RAP service, chain, or RPC — the credential is fully self-contained.
 */
export declare const REPUTATION_CREDENTIAL_CANONICALIZATION: "reddi-jcs-sort-keys.v1";
export declare const REPUTATION_CREDENTIAL_PROOF_TYPE: "ed25519";
export declare const REPUTATION_CREDENTIAL_PUBLIC_KEY_ENCODING: "spki-der-base64";
export type ReputationCredentialSubjectType = 'specialist' | 'provider' | 'listing';
/**
 * A hash-only reference to a single piece of attested evidence. Raw evidence
 * payloads (prompts, completions, transcripts) are NEVER carried here — only the
 * sha256 evidence hash plus non-sensitive attestation metadata.
 */
export type ReputationCredentialEvidenceRef = {
    attestationId: string;
    receiptId: string;
    evidenceId: string;
    evidenceHash: string;
    verdict: AttestationRecord['verdict'];
    trustBoundary: AttestationRecord['trustBoundary'];
    confidence: number;
};
export type ReputationCredentialBody = {
    schemaVersion: typeof REPUTATION_CREDENTIAL_SCHEMA_VERSION;
    id: string;
    subject: {
        id: string;
        type: ReputationCredentialSubjectType;
    };
    issuedAt: string;
    reputation: {
        status: OffchainReputationPreview['status'];
        routingImpact: string;
        score: number;
        attestationKind: OffchainReputationPreview['backing']['attestationKind'];
        buyerFacingClaimAllowed: false;
    };
    evidence: ReputationCredentialEvidenceRef[];
    provenance: {
        previewId: string;
        previewSchemaVersion: OffchainReputationPreview['schemaVersion'];
        bindingId: string;
        receiptId: string;
        sourceKind: string;
        sourceId: string;
    };
    guardrails: {
        chainAgnostic: true;
        onchainSettlement: false;
        walletSigning: false;
        rpcCall: false;
        hostedRegistryWrite: false;
        livePaymentExecuted: false;
        reputationMutated: false;
        rawEvidencePayloadEmbedded: false;
    };
};
export type ReputationCredentialProof = {
    type: typeof REPUTATION_CREDENTIAL_PROOF_TYPE;
    canonicalization: typeof REPUTATION_CREDENTIAL_CANONICALIZATION;
    publicKeyEncoding: typeof REPUTATION_CREDENTIAL_PUBLIC_KEY_ENCODING;
    publicKey: string;
    signature: string;
};
export type ReputationCredential = {
    schemaVersion: typeof REPUTATION_CREDENTIAL_SCHEMA_VERSION;
    credential: ReputationCredentialBody;
    proof: ReputationCredentialProof;
};
export type ReputationCredentialInput = {
    id: string;
    preview: OffchainReputationPreview;
    attestations: AttestationRecord[];
    issuedAt: string;
    subject?: {
        id: string;
        type: ReputationCredentialSubjectType;
    };
};
export type ReputationCredentialSigner = {
    privateKey: KeyObject;
    publicKey: KeyObject;
};
export type ReputationCredentialErrorCode = 'malformed_credential' | 'unknown_version' | 'preview_not_ready' | 'missing_attestation' | 'missing_evidence_hash' | 'evidence_hash_mismatch' | 'subject_mismatch' | 'raw_payload_leakage_rejected' | 'credential_leakage_rejected' | 'missing_proof' | 'unsupported_proof_type' | 'signature_invalid';
export type ReputationCredentialError = {
    code: ReputationCredentialErrorCode;
    path: string;
    message: string;
};
export type ReputationCredentialBuildResult = {
    ok: true;
    body: ReputationCredentialBody;
} | {
    ok: false;
    errors: ReputationCredentialError[];
};
export type ReputationCredentialExportResult = {
    ok: true;
    credential: ReputationCredential;
} | {
    ok: false;
    errors: ReputationCredentialError[];
};
export type ReputationCredentialVerifyResult = {
    ok: true;
    credential: ReputationCredential;
} | {
    ok: false;
    errors: ReputationCredentialError[];
};
export declare function canonicalizeReputationCredentialBody(body: ReputationCredentialBody): string;
/**
 * Build the unsigned, evidence-hash-bound credential body from an existing
 * off-chain reputation preview plus its backing attestation records. Fails
 * closed: a not-ready preview, a missing evidence hash, or any raw-payload /
 * credential leakage aborts the build.
 */
export declare function buildReputationCredentialBody(input: ReputationCredentialInput): ReputationCredentialBuildResult;
export declare function generateEphemeralEd25519Signer(): ReputationCredentialSigner;
export declare function encodeEd25519PublicKey(publicKey: KeyObject): string;
/**
 * Sign a built credential body with an ed25519 keypair. When no signer is
 * supplied an ephemeral keypair is generated in-process — the private key is
 * discarded on return and never enters the credential. The public key and
 * signature are embedded so verification is fully offline.
 */
export declare function signReputationCredentialBody(body: ReputationCredentialBody, signer?: ReputationCredentialSigner): ReputationCredential;
/**
 * Build + sign in one step. Generates an ephemeral ed25519 keypair unless one
 * is provided. Chain-agnostic and no-settlement by construction.
 */
export declare function exportReputationCredential(input: ReputationCredentialInput, signer?: ReputationCredentialSigner): ReputationCredentialExportResult;
/**
 * Verify a portable reputation credential entirely offline:
 *   1. recompute the canonical serialisation of the credential body,
 *   2. verify the ed25519 signature with the embedded public key,
 *   3. fail closed on any tampering, missing field, unknown version,
 *      raw-payload / credential leakage, or unsupported proof.
 * No chain, RPC, RAP hosting, or settlement is consulted.
 */
export declare function verifyReputationCredential(credential: unknown): ReputationCredentialVerifyResult;
