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
export type ReddiReceiptV2Settlement = 'direct' | 'escrow' | 'metered-escrow';
/**
 * What a per-token call used and settled. Present exactly when `settlement`
 * is 'metered-escrow'. Token counts are the provider's report; `maxAmount` is
 * what the buyer authorised and locked, `amount` is the actual cost paid, and
 * `refunded` is the rest, returned to the buyer.
 */
export type ReddiReceiptV2Metered = {
    inputTokens: string;
    outputTokens: string;
    maxAmount: string;
    refunded: string;
    /**
     * For a provider priced by what it makes rather than by tokens (video, audio,
     * images): the unit it bills and how many it delivered. Both or neither.
     */
    unit?: ReddiReceiptV2Unit;
    units?: string;
};
/** Units a provider can bill by, besides tokens. */
export declare const REDDI_RECEIPT_V2_UNITS: readonly ["second", "image", "character", "page"];
export type ReddiReceiptV2Unit = (typeof REDDI_RECEIPT_V2_UNITS)[number];
/**
 * A file the provider delivered and hosts for the buyer to collect. `sha256`
 * ties the file to the receipt as `responseHash` ties a text answer: a buyer
 * who hashes the file it downloaded can check it is the one it paid for.
 * `expiresAt` is when the provider stops hosting it. Not on a session call.
 */
export type ReddiReceiptV2Delivery = {
    name: string;
    /** IANA media type, for example video/mp4. */
    mediaType: string;
    /** File size in bytes, as a decimal string. */
    bytes: string;
    /** SHA-256 of the file bytes, lowercase hex. */
    sha256: string;
    /** ISO 8601 UTC time the provider stops hosting the file. After `issuedAt`. */
    expiresAt: string;
};
export type ReddiReceiptV2Payment = {
    network: ReddiReceiptV2Network;
    /** Signature of the transaction that paid for this call (base58). */
    txSignature: string;
    currency: ReddiReceiptV2Currency;
    /** Token mint address (base58). Required for every currency except SOL, which has none. */
    mint?: string;
    /** What the buyer paid in total, in the currency's smallest unit, as a decimal string. For a metered call, the actual cost. */
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
    /** Token counts and the authorised maximum of a per-token call. */
    metered?: ReddiReceiptV2Metered;
};
/**
 * One call of a session: many calls paid from one metered escrow lock and
 * settled once. Each call's receipt carries the running totals and the hash of
 * the previous receipt, so the buyer holds a signed chain for every unit
 * charged. Before the session settles a receipt has a `session` block and no
 * `payment`: it is the provider's signed statement of what the lock owes, not
 * proof of a transfer. The closing receipt has both, and its payment amount is
 * the session's cumulative cost.
 */
export type ReddiReceiptV2Session = {
    /** The metered escrow paying for the session (base58). */
    escrow: string;
    /** The wallet that locked it (base58). */
    payer: string;
    network: ReddiReceiptV2Network;
    currency: ReddiReceiptV2Currency;
    /** Token mint address (base58). Required for every currency except SOL. */
    mint?: string;
    /** What the buyer locked, in smallest units. Cumulative cost never exceeds it. */
    maxAmount: string;
    /** 1 for the first call, then each call one more, with no gaps. */
    sequence: string;
    /** This call's token counts, as the provider reports them. A close request without a call states 0 and 0. */
    inputTokens: string;
    outputTokens: string;
    /** Totals over every call up to and including this one. */
    cumulativeInputTokens: string;
    cumulativeOutputTokens: string;
    /** What the totals cost at the provider's price, in smallest units, capped at `maxAmount`: what the settle will charge. */
    cumulativeCost: string;
    /** `hashReddiReceiptV2` of the previous call's receipt. Absent only on sequence 1. */
    previousReceiptHash?: string;
    /** True only on the receipt of the settle, which also carries `payment`. */
    closed: boolean;
};
/**
 * A call paid from a provider's slice of a pooled Budget. It travels with the
 * `session` block, whose `escrow` is the slice's reservation account and whose
 * totals are metered against the slice. It names the Budget and which opening
 * of it (`createdSlot`), since Budgets at one address can be opened again.
 * Like a session receipt before the settle, it states what the slice owes, not
 * a transfer: the Budget pays the slice on chain later (`BudgetPaid`).
 */
export type ReddiReceiptV2Budget = {
    /** The Budget account (base58). */
    address: string;
    /** The Budget's `created_slot`, as a decimal string. */
    createdSlot: string;
    /** The provider's reservation (slice) account of that Budget (base58). Equals `session.escrow`. */
    reservation: string;
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
    /** The transfer that paid. Absent only on a session receipt before the session settles. */
    payment?: ReddiReceiptV2Payment;
    /** Present on every call of a session. */
    session?: ReddiReceiptV2Session;
    /** Present on every call paid from a pooled Budget slice, always with `session`. */
    budget?: ReddiReceiptV2Budget;
    /** The file delivered, for a provider that returns one. */
    delivery?: ReddiReceiptV2Delivery;
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
export type ReddiReceiptV2ErrorCode = 'malformed_receipt' | 'unsupported_version' | 'malformed_proof' | 'signature_invalid' | 'provider_mismatch' | 'declared_model_mismatch' | 'request_hash_mismatch' | 'response_hash_mismatch' | 'payment_mismatch' | 'session_mismatch' | 'session_chain_broken' | 'delivery_mismatch' | 'budget_mismatch';
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
    /** Each field given must equal the signed session block. A receipt without one fails. */
    session?: Partial<ReddiReceiptV2Session>;
    /** Each field given must equal the signed delivery block, for example the SHA-256 of the file you downloaded. A receipt without one fails. */
    delivery?: Partial<ReddiReceiptV2Delivery>;
    /** Each field given must equal the signed budget block. A receipt without one fails. */
    budget?: Partial<ReddiReceiptV2Budget>;
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
/** SHA-256 of a receipt's canonical bytes, lowercase hex: what the next call of a session names as `previousReceiptHash`. */
export declare function hashReddiReceiptV2(receipt: ReddiReceiptV2): string;
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
/**
 * Checks a session's receipts as one chain, oldest first: each verifies on its
 * own (pass `expected` for what every receipt must state, for example the
 * provider and the escrow), they share provider, escrow, payer, network,
 * currency, mint and maximum, sequences run 1, 2, 3 with no gap, each names the
 * previous receipt's hash, the totals are the running sums of each call's
 * counts, the cost never goes down, and only the last may be closed. It does
 * not recompute cost from a price: compare `cumulativeCost` with your own
 * count of tokens at the price you were quoted.
 */
export declare function verifyReddiReceiptV2Session(chain: readonly unknown[], expected?: ReddiReceiptV2Expectation): {
    ok: true;
    receipts: ReddiReceiptV2[];
    closed: boolean;
} | {
    ok: false;
    errors: ReddiReceiptV2Error[];
};
