/**
 * Reddi receipt v2 (#739, #740).
 *
 * `reddi.receipt.v2` is a receipt the provider issues and signs. It names the
 * provider, the model the provider declares it served, the hashes of the
 * request and response, and the transaction the call was paid with. The
 * provider signs those fields with its wallet key, so the receipt can be
 * checked offline against the provider's address.
 *
 * It is the receipt for every paid call in V1 (#776). It also states what was
 * paid: the currency and mint, the listed price, the protocol fee and where it
 * went, and whether the call was paid directly or through escrow. A v1
 * validator rejects a v2 receipt and this module rejects a v1 receipt.
 *
 * The payment fields are the provider's statement. A verifier that needs to
 * rely on them checks the named transaction on chain; this module does not.
 *
 * What a valid signature shows: the holder of the provider key stated these
 * fields. It does not show which model actually ran. "Declared model" is a
 * declaration, not verified execution.
 *
 * Everything here is offline: no network, no clock unless a caller passes one,
 * and no private key is ever accepted. Signing goes through a caller-supplied
 * signer function.
 */
export declare const REDDI_RECEIPT_V2_VERSION: "reddi.receipt.v2";
export declare const REDDI_RECEIPT_V2_PROOF_TYPE: "ed25519";
export type ReddiReceiptV2Network = 'solana-devnet' | 'solana-mainnet-beta';
export declare const REDDI_RECEIPT_V2_CURRENCIES: readonly ["SOL", "USDC", "PYUSD", "USDG", "AUDD"];
export type ReddiReceiptV2Currency = (typeof REDDI_RECEIPT_V2_CURRENCIES)[number];
export type ReddiReceiptV2Settlement = 'direct' | 'escrow';
export type ReddiReceiptV2Payment = {
    network: ReddiReceiptV2Network;
    /** Signature of the transaction that paid for this call (base58). */
    txSignature: string;
    currency: ReddiReceiptV2Currency;
    /** Token mint address (base58). Required for every currency except SOL, which has none. */
    mint?: string;
    /** Listed price the buyer paid in total, in the currency's smallest unit, as a decimal string. */
    amount: string;
    /**
     * Protocol fee taken out of `amount`, in the smallest unit. "0" when no fee
     * applied. `treasury` is the address that received it and is required when
     * the fee is above zero.
     */
    fee: {
        amount: string;
        treasury?: string;
    };
    /** Paying wallet (base58). Present only when the provider checked it against the transaction. */
    payer?: string;
    settlement: ReddiReceiptV2Settlement;
};
export type ReddiReceiptV2 = {
    schemaVersion: typeof REDDI_RECEIPT_V2_VERSION;
    /** The provider's Solana wallet address (base58). The signature must verify against it. */
    providerId: string;
    /** The model the provider says it served. A declaration, not proof of execution. */
    declaredModel: string;
    /** SHA-256 of the request body bytes, lowercase hex. */
    requestHash: string;
    /** SHA-256 of the response body bytes, lowercase hex. */
    responseHash: string;
    payment: ReddiReceiptV2Payment;
    /** The job this call was recorded as, when the provider knows it. */
    jobId?: string;
    /** ISO 8601 UTC time the provider issued this receipt. */
    issuedAt: string;
};
export type SignedReddiReceiptV2 = {
    receipt: ReddiReceiptV2;
    proof: {
        type: typeof REDDI_RECEIPT_V2_PROOF_TYPE;
        /** Base64 of the 64-byte ed25519 signature over the canonical receipt bytes. */
        signature: string;
    };
};
export type ReddiReceiptV2ErrorCode = 'malformed_receipt' | 'unsupported_version' | 'malformed_proof' | 'signature_invalid' | 'provider_mismatch' | 'declared_model_mismatch' | 'request_hash_mismatch' | 'response_hash_mismatch' | 'payment_mismatch';
export type ReddiReceiptV2Error = {
    code: ReddiReceiptV2ErrorCode;
    path: string;
    message: string;
};
export type ReddiReceiptV2Verification = {
    ok: true;
    receipt: ReddiReceiptV2;
} | {
    ok: false;
    errors: ReddiReceiptV2Error[];
};
/** What the verifier itself knows about the call. Every field given must match the signed receipt. */
export type ReddiReceiptV2Expectation = {
    providerId?: string;
    declaredModel?: string;
    requestHash?: string;
    responseHash?: string;
    /** `network` and `txSignature` always compare; each other field compares when given. */
    payment?: {
        network: ReddiReceiptV2Network;
        txSignature: string;
    } & Partial<Omit<ReddiReceiptV2Payment, 'network' | 'txSignature' | 'fee'>> & {
        fee?: {
            amount: string;
            treasury?: string;
        };
    };
};
/** Signs the canonical bytes with the provider's key and returns the 64-byte signature. The key never enters this module. */
export type ReddiReceiptV2Signer = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;
/** SHA-256 of a body, lowercase hex. Strings are hashed as UTF-8. */
export declare function hashReddiReceiptV2Body(body: string | Uint8Array): string;
export declare function validateReddiReceiptV2(input: unknown): ReddiReceiptV2Verification;
/**
 * The exact bytes the provider signs: JSON with a fixed field order and no
 * whitespace. The version string is the first field, so a signature for this
 * receipt cannot be replayed as a signature for another kind of message.
 */
export declare function canonicalizeReddiReceiptV2(receipt: ReddiReceiptV2): string;
/** Validates the receipt, asks the signer for a signature, and refuses to return one that does not verify. */
export declare function signReddiReceiptV2(receipt: ReddiReceiptV2, signer: ReddiReceiptV2Signer): Promise<SignedReddiReceiptV2>;
/**
 * Verifies a signed receipt offline. The signature must verify against the
 * `providerId` inside the receipt, and every field of `expected` that is given
 * must equal the signed value. Pass what you know yourself: the provider you
 * paid, the hashes of the bytes you sent and received, the transaction you paid
 * with. Without `expected`, a pass only says some key signed some statement.
 */
export declare function verifyReddiReceiptV2(input: unknown, expected?: ReddiReceiptV2Expectation): ReddiReceiptV2Verification;
