/**
 * Proof that a direct per-call payment is being presented by the wallet that
 * paid it.
 *
 * A confirmed transfer is public: its signature, payer and amount can be read
 * by anyone. Without a proof, someone who sees a buyer's payment could present
 * it first and be served, and the buyer would then be refused as a duplicate.
 * So the request that presents a direct receipt carries a signature over the
 * network, the transaction signature, the payee and the SHA-256 of the request
 * body, made by the wallet that signed the transfer, or by a key that wallet
 * handed this provider for a while (so a browser wallet signs once, not on
 * every call).
 *
 * Headers:
 * - `x402-payment-proof`: base64 of the signature over `directPaymentProofMessage(...)`.
 * - `x402-payment-delegation` (optional): base64 of JSON `{provider, sessionKey, expiresAt, signature}`,
 *   `signature` base64 of the payer's signature over `directPaymentDelegationMessage(...)`.
 *   With it, the proof is signed by `sessionKey`; without it, by the payer.
 *
 * Verification uses Node's crypto; signing takes a callback, so the buyer can
 * sign with a wallet adapter, a Keypair or anything else.
 */
import type { Keypair } from '@solana/web3.js';
import type { HeaderReader } from './provider';
import { type Signer } from './session-auth';
import type { PayerProofCheck, ProvenDirectPayment, SolanaPaymentNetwork } from './types';
export declare const PAYMENT_PROOF_HEADER = "x402-payment-proof";
export declare const PAYMENT_DELEGATION_HEADER = "x402-payment-delegation";
export interface DirectPaymentDelegation {
    /** The provider's payee wallet. */
    provider: string;
    sessionKey: string;
    /** Whole seconds since the epoch, at most `MAX_SESSION_DELEGATION_SECONDS` ahead. */
    expiresAt: number;
}
export type DirectPaymentProofFailure = {
    ok: false;
    reason: 'payer_proof_required' | 'payer_proof_invalid' | 'payer_proof_expired';
    message: string;
};
/** The text the payer wallet signs to let `sessionKey` prove its direct payments to `provider`. */
export declare function directPaymentDelegationMessage(d: DirectPaymentDelegation): string;
/** The bytes signed for one request that presents a direct payment. */
export declare function directPaymentProofMessage(input: {
    network: SolanaPaymentNetwork;
    txSignature: string;
    payTo: string;
    bodyHash: string;
}): string;
/** Buyer side: a signer for a server-held Keypair (a browser wallet passes its own `signMessage`). */
export declare function keypairSigner(keypair: Keypair): Signer;
/** Buyer side: the delegation header value, signed once by the payer wallet. Keep it with the session key and reuse it until it expires. */
export declare function directPaymentDelegationHeaderValue(d: DirectPaymentDelegation, signWithPayer: Signer): Promise<string>;
/**
 * Buyer side: the headers for one request that presents a direct payment.
 * `sign` is the payer wallet, or the session key named in `delegation`.
 * `body` must be the exact bytes sent.
 */
export declare function directPaymentProofHeaders(input: {
    network: SolanaPaymentNetwork;
    txSignature: string;
    payTo: string;
    body: Uint8Array | string;
    sign: Signer;
    delegation?: string;
}): Promise<Record<string, string>>;
/**
 * Provider side: checks that the request was signed by the wallet that made
 * the payment (`paid.payer`, which the receipt verifier has already tied to
 * the transaction), or by a key it delegated to this provider. `body` is the
 * raw request body exactly as received.
 */
export declare function verifyDirectPaymentProof(input: {
    headers: HeaderReader;
    paid: ProvenDirectPayment;
    body?: Uint8Array | string;
    nowMs: number;
}): {
    ok: true;
    signer: string;
} | DirectPaymentProofFailure;
/**
 * Provider side: the check to pass to `SolanaReceiptVerifier.verifyReceipt`
 * for one request. `body` is the raw request body exactly as received.
 */
export declare function directPaymentProofCheck(input: {
    headers: HeaderReader;
    body?: Uint8Array | string;
    nowMs?: number;
}): PayerProofCheck;
