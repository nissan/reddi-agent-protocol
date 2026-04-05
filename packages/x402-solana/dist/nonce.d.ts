/**
 * Check if nonce has been seen before, and store it if new
 * @param nonce The nonce to check
 * @returns true if nonce is new, false if duplicate
 */
export declare function checkAndStoreNonce(nonce: string): boolean;
/**
 * Clear all stored nonces (for testing)
 */
export declare function clearNonces(): void;
/**
 * Get count of stored nonces (for debugging)
 */
export declare function getNonceCount(): number;
