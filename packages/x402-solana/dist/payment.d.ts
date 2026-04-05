import { X402Request, PaymentReceipt } from './types';
/**
 * Parse x402-request header into structured request
 * Expected format: JSON string with amount, currency, paymentAddress, nonce
 * @throws Error if header is invalid
 */
export declare function parseX402Header(header: string): X402Request;
/**
 * Send a payment via Solana SystemProgram.transfer
 * In Phase 1, this is a stub. Full implementation in Phase 2.
 * @param request The payment request
 * @returns Promise resolving to payment receipt
 */
export declare function sendPayment(request: X402Request): Promise<PaymentReceipt>;
/**
 * Validate payment address format (basic check)
 * Real validation would use @solana/web3.js PublicKey
 */
export declare function isValidPaymentAddress(address: string): boolean;
