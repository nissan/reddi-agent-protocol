/**
 * Express middleware for x402 payment processing
 * Intercepts requests with x402-request header, validates, and sends payment
 */
export declare function createX402Middleware(): (req: any, res: any, next: any) => Promise<any>;
/**
 * Helper: Create x402-request header from components
 */
export declare function createX402Header(amount: number, paymentAddress: string, nonce: string, currency?: string): string;
