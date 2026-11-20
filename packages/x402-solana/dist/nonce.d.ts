import type { NonceReplayStore } from './types';
export declare class MemoryNonceReplayStore implements NonceReplayStore {
    private readonly seen;
    checkAndStore(nonce: string): boolean;
    clear(): void;
    get size(): number;
}
/**
 * Check if nonce has been seen before, and store it if new.
 * @returns true if nonce is new, false if duplicate.
 */
export declare function checkAndStoreNonce(nonce: string): boolean;
export declare const defaultNonceReplayStore: NonceReplayStore;
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
    constructor(options: DatabaseReplayStoreOptions);
    checkAndStore(key: string): Promise<boolean>;
}
