import type { NonceReplayStore } from './types';
export declare class MemoryNonceReplayStore implements NonceReplayStore {
    private readonly seen;
    checkAndStore(nonce: string): boolean;
    checkAndStoreAll(keys: string[]): boolean;
    clear(): void;
    get size(): number;
}
/**
 * Check if nonce has been seen before, and store it if new.
 * @returns true if nonce is new, false if duplicate.
 */
export declare function checkAndStoreNonce(nonce: string): boolean;
export declare const defaultNonceReplayStore: NonceReplayStore;
/**
 * Records all keys for one payment. Uses the store's atomic `checkAndStoreAll`
 * when it has one; otherwise records them one by one, in order, which can leave
 * the earlier keys recorded if a later one is refused or fails.
 */
export declare function checkAndStoreReplayKeys(store: NonceReplayStore, keys: string[]): Promise<boolean>;
/** Clear all stored nonces (for testing). */
export declare function clearNonces(): void;
/** Get count of stored nonces (for debugging). */
export declare function getNonceCount(): number;
/** Result shape of a database remote procedure call, as returned by supabase-js `rpc`. */
export interface ReplayRpcResult {
    data: unknown;
    error: unknown;
}
export interface DatabaseReplayStoreOptions {
    /**
     * Calls a database function by name. With supabase-js, pass
     * `(fn, args) => client.rpc(fn, args)` using a server-side client.
     */
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<ReplayRpcResult>;
    /** Defaults to `replay_check_and_store`, which takes `p_key` and returns a boolean. */
    functionName?: string;
    /**
     * Defaults to `replay_check_and_store_all`, which takes `p_keys` (a text array),
     * inserts all of them or none, and returns a boolean.
     */
    batchFunctionName?: string;
}
/**
 * Durable replay store backed by an atomic database function, so a key is
 * accepted once across restarts and across every instance of the service.
 * Fails closed: a database error or an unexpected answer throws, and the payment
 * is not accepted.
 */
export declare class DatabaseReplayStore implements NonceReplayStore {
    private readonly options;
    private readonly functionName;
    private readonly batchFunctionName;
    constructor(options: DatabaseReplayStoreOptions);
    checkAndStoreAll(keys: string[]): Promise<boolean>;
    checkAndStore(key: string): Promise<boolean>;
}
