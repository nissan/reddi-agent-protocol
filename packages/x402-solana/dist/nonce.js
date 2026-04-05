"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndStoreNonce = checkAndStoreNonce;
exports.clearNonces = clearNonces;
exports.getNonceCount = getNonceCount;
/**
 * In-memory nonce store for replay protection
 * In production, this should use a persistent store (Redis, DB) with TTL
 */
const seenNonces = new Set();
/**
 * Check if nonce has been seen before, and store it if new
 * @param nonce The nonce to check
 * @returns true if nonce is new, false if duplicate
 */
function checkAndStoreNonce(nonce) {
    if (seenNonces.has(nonce)) {
        return false; // Duplicate detected
    }
    seenNonces.add(nonce);
    return true;
}
/**
 * Clear all stored nonces (for testing)
 */
function clearNonces() {
    seenNonces.clear();
}
/**
 * Get count of stored nonces (for debugging)
 */
function getNonceCount() {
    return seenNonces.size;
}
