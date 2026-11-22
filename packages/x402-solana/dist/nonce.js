"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseReplayStore = exports.defaultNonceReplayStore = exports.MemoryNonceReplayStore = void 0;
exports.checkAndStoreNonce = checkAndStoreNonce;
exports.checkAndStoreReplayKeys = checkAndStoreReplayKeys;
exports.clearNonces = clearNonces;
exports.getNonceCount = getNonceCount;
/**
 * In-memory nonce store for replay protection.
 * In production, callers should provide a persistent store (Redis/DB) with TTL.
 */
const seenNonces = new Set();
class MemoryNonceReplayStore {
    constructor() {
        this.seen = new Set();
    }
    checkAndStore(nonce) {
        if (this.seen.has(nonce))
            return false;
        this.seen.add(nonce);
        return true;
    }
    checkAndStoreAll(keys) {
        assertDistinctKeys(keys);
        if (keys.some((key) => this.seen.has(key)))
            return false;
        for (const key of keys)
            this.seen.add(key);
        return true;
    }
    clear() {
        this.seen.clear();
    }
    get size() {
        return this.seen.size;
    }
}
exports.MemoryNonceReplayStore = MemoryNonceReplayStore;
/**
 * Check if nonce has been seen before, and store it if new.
 * @returns true if nonce is new, false if duplicate.
 */
function checkAndStoreNonce(nonce) {
    if (seenNonces.has(nonce))
        return false;
    seenNonces.add(nonce);
    return true;
}
exports.defaultNonceReplayStore = {
    checkAndStore: checkAndStoreNonce,
    checkAndStoreAll(keys) {
        assertDistinctKeys(keys);
        if (keys.some((key) => seenNonces.has(key)))
            return false;
        for (const key of keys)
            seenNonces.add(key);
        return true;
    },
};
function assertDistinctKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0)
        throw new Error('at least one replay key is required');
    if (keys.some((key) => typeof key !== 'string' || key.length === 0))
        throw new Error('replay key must be a non-empty string');
    if (new Set(keys).size !== keys.length)
        throw new Error('replay keys must be distinct');
}
/**
 * Records all keys for one payment. Uses the store's atomic `checkAndStoreAll`
 * when it has one; otherwise records them one by one, in order, which can leave
 * the earlier keys recorded if a later one is refused or fails.
 */
async function checkAndStoreReplayKeys(store, keys) {
    assertDistinctKeys(keys);
    if (store.checkAndStoreAll)
        return store.checkAndStoreAll(keys);
    for (const key of keys) {
        if (!(await store.checkAndStore(key)))
            return false;
    }
    return true;
}
/** Clear all stored nonces (for testing). */
function clearNonces() {
    seenNonces.clear();
}
/** Get count of stored nonces (for debugging). */
function getNonceCount() {
    return seenNonces.size;
}
/**
 * Durable replay store backed by an atomic database function, so a key is
 * accepted once across restarts and across every instance of the service.
 * Fails closed: a database error or an unexpected answer throws, and the payment
 * is not accepted.
 */
class DatabaseReplayStore {
    constructor(options) {
        this.options = options;
        this.functionName = options.functionName ?? 'replay_check_and_store';
        this.batchFunctionName = options.batchFunctionName ?? 'replay_check_and_store_all';
    }
    async checkAndStoreAll(keys) {
        assertDistinctKeys(keys);
        const { data, error } = await this.options.rpc(this.batchFunctionName, { p_keys: keys });
        if (error)
            throw new Error('replay store is unavailable; payment cannot be accepted');
        if (typeof data !== 'boolean')
            throw new Error('replay store returned an unexpected answer; payment cannot be accepted');
        return data;
    }
    async checkAndStore(key) {
        if (typeof key !== 'string' || key.length === 0)
            throw new Error('replay key must be a non-empty string');
        const { data, error } = await this.options.rpc(this.functionName, { p_key: key });
        if (error)
            throw new Error('replay store is unavailable; payment cannot be accepted');
        if (typeof data !== 'boolean')
            throw new Error('replay store returned an unexpected answer; payment cannot be accepted');
        return data;
    }
}
exports.DatabaseReplayStore = DatabaseReplayStore;
