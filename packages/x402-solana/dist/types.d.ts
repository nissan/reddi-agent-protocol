/**
 * x402 payment request parsed from HTTP header
 */
export interface X402Request {
    amount: number;
    currency: string;
    paymentAddress: string;
    nonce: string;
}
/**
 * Payment receipt after successful SOL transfer
 */
export interface PaymentReceipt {
    txSignature: string;
    slot: number;
    lamports: number;
    nonce: string;
}
/**
 * x402 error codes
 */
export type X402Error = 'insufficient_funds' | 'duplicate_nonce' | 'invalid_request' | 'rpc_timeout' | 'unauthorized';
