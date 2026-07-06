import { type ReddiReceipt } from './receipts.js';
import { type AttestationRecord } from './attestation-reputation.js';
import type { RailNeutralPaymentReceipt } from './rail-neutral-payment-receipts.js';
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
export declare const ERC8004_EXPORT_SCHEMA_VERSION: "reddi.erc8004-export.v1";
/**
 * Promoted by #562: the RAP-side mapping spec is no longer a draft. External
 * ERC-8004 field-shape uncertainty is tracked separately and honestly via
 * `externalStandard.fieldShapesVerified: false` on every bundle — promotion of
 * the RAP spec does NOT upgrade confidence in the external draft standard.
 */
export declare const ERC8004_EXPORT_IS_DRAFT: false;
/**
 * External-standard provenance block carried on every bundle. RAP claims no
 * deployment and asserts no verified ERC-8004 field shapes.
 */
export declare const ERC8004_EXTERNAL_STANDARD: {
    readonly name: "ERC-8004 (Trustless Agents)";
    readonly status: "external-draft-standard";
    readonly fieldShapesVerified: false;
    readonly deploymentClaim: false;
};
export type Erc8004ExternalStandard = typeof ERC8004_EXTERNAL_STANDARD;
/**
 * Chains where ERC-8004 registries are discussed/expected per the #562 issue
 * text. DOCUMENTATION ONLY — every entry is unverified, no deployment is
 * claimed or checked (this module never touches a chain or RPC), and the CAIP-2
 * refs are fixture placeholders. `caip2: null` where the chain id was not
 * confirmable offline.
 */
export declare const ERC8004_DOCUMENTED_CHAINS: ReadonlyArray<{
    name: string;
    /** CAIP-2 fixture placeholder, or null when unconfirmed. (unverified — ERC-8004 draft standard.) */
    caip2: string | null;
    source: 'issue #562 text';
    deploymentClaim: false;
    verified: false;
}>;
export type Erc8004ExportIntent = 'metadata_only' | 'exportable' | 'blocked';
export type Erc8004ExportReasonCode = 'erc8004_export_ok' | 'receipt_malformed' | 'attestation_missing' | 'attestation_malformed' | 'unsupported_network_asset' | 'credential_leakage_rejected' | 'onchain_write_not_permitted' | 'validation_registry_experimental' | 'non_final_receipt_excluded' | 'attestation_state_excluded' | 'attestation_receipt_mismatch' | 'payment_proof_missing_excluded' | 'probe_only_receipt_excluded' | 'rail_neutral_bridge_required' | 'unsupported_chain_hint' | 'reputation_credential_invalid' | 'reputation_credential_subject_mismatch' | 'reputation_credential_evidence_mismatch';
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
        protocol: {
            name: string;
            version: string;
        };
    };
    /**
     * Key/value metadata an operator would post via `setMetadata(agentId,key,value)`.
     * (unverified — ERC-8004 draft standard `setMetadata` signature + key vocabulary.)
     */
    metadata: Array<{
        key: string;
        value: string;
    }>;
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
export declare const ERC8004_EXPORT_FIELD_PROVENANCE: ReadonlyArray<{
    registry: 'identity' | 'reputation' | 'validation' | 'crossReference';
    field: string;
    source: string;
    confidence: 'rap-native' | 'erc8004-draft-interface';
    lossy?: string;
}>;
/**
 * ERC-8004 surface RAP cannot (or deliberately will not) populate — documented
 * fail-closed (#562). `behavior` is what this exporter does about each gap.
 */
export declare const ERC8004_UNSUPPORTED_FIELDS: ReadonlyArray<{
    surface: string;
    behavior: 'null' | 'omitted' | 'blocked' | 'excluded';
    reason: string;
}>;
/** Source shapes the eligibility gate understands. */
export type Erc8004ExportSource = {
    kind: 'receipt-v1';
    receipt: ReddiReceipt;
} | {
    kind: 'rail-neutral';
    receipt: RailNeutralPaymentReceipt;
};
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
export declare function evaluateErc8004SourceEligibility(source: Erc8004ExportSource): Erc8004SourceEligibility;
/**
 * Pure, offline projection of a RAP receipt (+ optional attestation, + optional
 * portable reputation credential) into ERC-8004 registry payloads. Never mints,
 * signs, calls RPC, or reveals raw evidence payloads. Fails closed on credential
 * leakage, unsupported rails, malformed input, non-final source states, invalid
 * chain hints, unverifiable reputation credentials, and any request to submit
 * on-chain.
 */
export declare function exportReceiptToErc8004(receipt: ReddiReceipt, attestation?: AttestationRecord, options?: Erc8004ExportOptions): Erc8004ExportBundle;
