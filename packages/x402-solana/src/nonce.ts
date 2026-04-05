/**
 * In-memory nonce store for replay protection
 * In production, this should use a persistent store (Redis, DB) with TTL
 */
const seenNonces = new Set<string>();

/**
 * Check if nonce has been seen before, and store it if new
 * @param nonce The nonce to check
 * @returns true if nonce is new, false if duplicate
 */
export function checkAndStoreNonce(nonce: string): boolean {
  if (seenNonces.has(nonce)) {
    return false; // Duplicate detected
  }
  seenNonces.add(nonce);
  return true;
}

/**
 * Clear all stored nonces (for testing)
 */
export function clearNonces(): void {
  seenNonces.clear();
}

/**
 * Get count of stored nonces (for debugging)
 */
export function getNonceCount(): number {
  return seenNonces.size;
}
