/**
 * x402 payment request parsed from HTTP header
 */
export interface X402Request {
  amount: number;        // lamports
  currency: string;      // "SOL"
  paymentAddress: string; // base58 Solana address
  nonce: string;         // UUID or random string for replay protection
}

/**
 * Payment receipt after successful SOL transfer
 */
export interface PaymentReceipt {
  txSignature: string;   // Solana transaction signature
  slot: number;          // Solana slot when confirmed
  lamports: number;      // Amount transferred (should match request)
  nonce: string;         // Echo back for correlation
}

/**
 * x402 error codes
 */
export type X402Error = 
  | 'insufficient_funds'
  | 'duplicate_nonce'
  | 'invalid_request'
  | 'rpc_timeout'
  | 'unauthorized';
