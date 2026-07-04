import { type ReddiReceipt } from './receipts.js';
import { type AttestationRecord } from './attestation-reputation.js';
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
export declare const ERC8004_EXPORT_SCHEMA_VERSION: "reddi.erc8004-export.v1";
/** Top-level draft flag — signals the whole schema is unverified against the live standard. */
export declare const ERC8004_EXPORT_IS_DRAFT: true;
export type Erc8004ExportIntent = 'metadata_only' | 'exportable' | 'blocked';
export type Erc8004ExportReasonCode = 'erc8004_export_ok' | 'receipt_malformed' | 'attestation_missing' | 'attestation_malformed' | 'unsupported_network_asset' | 'credential_leakage_rejected' | 'onchain_write_not_permitted' | 'validation_registry_experimental';
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
        protocol: {
            name: string;
            version: string;
        };
    };
    /**
     * Key/value metadata an operator would post via `setMetadata(agentId,key,value)`.
     * (DRAFT/unverified — ERC-8004, confirm `setMetadata` signature + key vocabulary.)
     */
    metadata: Array<{
        key: string;
        value: string;
    }>;
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
export declare function exportReceiptToErc8004(receipt: ReddiReceipt, attestation?: AttestationRecord, options?: Erc8004ExportOptions): Erc8004ExportBundle;
