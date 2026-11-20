/**
 * Provider receipt extension (#739, #740).
 *
 * A separately signed block that rides next to a `reddi.receipt.v1` receipt and
 * leaves that contract untouched. The provider states which model it declares
 * it served, the hashes of the request and response, and the payment the call
 * was paid with, then signs those fields with its wallet key.
 *
 * What a valid signature shows: the holder of the provider key stated these
 * fields. It does not show which model actually ran. "Declared model" is a
 * declaration, not verified execution.
 *
 * Everything here is offline: no network, no clock unless a caller passes one,
 * and no private key is ever accepted. Signing goes through a caller-supplied
 * signer function.
 */
export declare const PROVIDER_RECEIPT_EXTENSION_VERSION: "reddi.receipt.provider-extension.v1";
export declare const PROVIDER_RECEIPT_PROOF_TYPE: "ed25519";
export type ProviderReceiptNetwork = 'solana-devnet' | 'solana-mainnet-beta';
export type ProviderReceiptExtension = {
    schemaVersion: typeof PROVIDER_RECEIPT_EXTENSION_VERSION;
    /** The provider's Solana wallet address (base58). The signature must verify against it. */
    providerId: string;
    /** The model the provider says it served. A declaration, not proof of execution. */
    declaredModel: string;
    /** SHA-256 of the request body bytes, lowercase hex. */
    requestHash: string;
    /** SHA-256 of the response body bytes, lowercase hex. */
    responseHash: string;
    payment: {
        network: ProviderReceiptNetwork;
        /** Signature of the transaction that paid for this call (base58). */
        txSignature: string;
    };
    /** ISO 8601 UTC time the provider issued this block. */
    issuedAt: string;
};
export type SignedProviderReceiptExtension = {
    extension: ProviderReceiptExtension;
    proof: {
        type: typeof PROVIDER_RECEIPT_PROOF_TYPE;
        /** Base64 of the 64-byte ed25519 signature over the canonical extension bytes. */
        signature: string;
    };
};
export type ProviderReceiptErrorCode = 'malformed_extension' | 'unsupported_version' | 'malformed_proof' | 'signature_invalid' | 'provider_mismatch' | 'declared_model_mismatch' | 'request_hash_mismatch' | 'response_hash_mismatch' | 'payment_mismatch';
export type ProviderReceiptError = {
    code: ProviderReceiptErrorCode;
    path: string;
    message: string;
};
export type ProviderReceiptVerification = {
    ok: true;
    extension: ProviderReceiptExtension;
} | {
    ok: false;
    errors: ProviderReceiptError[];
};
/** What the verifier itself knows about the call. Every field given must match the signed block. */
export type ProviderReceiptExpectation = {
    providerId?: string;
    declaredModel?: string;
    requestHash?: string;
    responseHash?: string;
    payment?: {
        network: ProviderReceiptNetwork;
        txSignature: string;
    };
};
/** Signs the canonical bytes with the provider's key and returns the 64-byte signature. The key never enters this module. */
export type ProviderReceiptSigner = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;
/** SHA-256 of a body, lowercase hex. Strings are hashed as UTF-8. */
export declare function hashProviderReceiptBody(body: string | Uint8Array): string;
export declare function validateProviderReceiptExtension(input: unknown): ProviderReceiptVerification;
/**
 * The exact bytes the provider signs: JSON with a fixed field order and no
 * whitespace. The version string is the first field, so a signature for this
 * block cannot be replayed as a signature for another kind of message.
 */
export declare function canonicalizeProviderReceiptExtension(extension: ProviderReceiptExtension): string;
/** Validates the block, asks the signer for a signature, and refuses to return one that does not verify. */
export declare function signProviderReceiptExtension(extension: ProviderReceiptExtension, signer: ProviderReceiptSigner): Promise<SignedProviderReceiptExtension>;
/**
 * Verifies a signed block offline. The signature must verify against the
 * `providerId` inside the block, and every field of `expected` that is given
 * must equal the signed value. Pass what you know yourself: the provider you
 * paid, the hashes of the bytes you sent and received, the transaction you paid
 * with. Without `expected`, a pass only says some key signed some statement.
 */
export declare function verifyProviderReceiptExtension(input: unknown, expected?: ProviderReceiptExpectation): ProviderReceiptVerification;
