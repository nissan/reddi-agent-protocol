import type { NonceReplayStore } from './types';

/**
 * In-memory nonce store for replay protection.
 * In production, callers should provide a persistent store (Redis/DB) with TTL.
 */
const seenNonces = new Set<string>();

export class MemoryNonceReplayStore implements NonceReplayStore {
  private readonly seen = new Set<string>();

  checkAndStore(nonce: string): boolean {
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    return true;
  }

  checkAndStoreAll(keys: string[]): boolean {
    assertDistinctKeys(keys);
    if (keys.some((key) => this.seen.has(key))) return false;
    for (const key of keys) this.seen.add(key);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * Check if nonce has been seen before, and store it if new.
 * @returns true if nonce is new, false if duplicate.
 */
export function checkAndStoreNonce(nonce: string): boolean {
  if (seenNonces.has(nonce)) return false;
  seenNonces.add(nonce);
  return true;
}

export const defaultNonceReplayStore: NonceReplayStore = {
  checkAndStore: checkAndStoreNonce,
  checkAndStoreAll(keys: string[]): boolean {
    assertDistinctKeys(keys);
    if (keys.some((key) => seenNonces.has(key))) return false;
    for (const key of keys) seenNonces.add(key);
    return true;
  },
};

function assertDistinctKeys(keys: string[]): void {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('at least one replay key is required');
  if (keys.some((key) => typeof key !== 'string' || key.length === 0)) throw new Error('replay key must be a non-empty string');
  if (new Set(keys).size !== keys.length) throw new Error('replay keys must be distinct');
}

/**
 * Records all keys for one payment. Uses the store's atomic `checkAndStoreAll`
 * when it has one; otherwise records them one by one, in order, which can leave
 * the earlier keys recorded if a later one is refused or fails.
 */
export async function checkAndStoreReplayKeys(store: NonceReplayStore, keys: string[]): Promise<boolean> {
  assertDistinctKeys(keys);
  if (store.checkAndStoreAll) return store.checkAndStoreAll(keys);
  for (const key of keys) {
    if (!(await store.checkAndStore(key))) return false;
  }
  return true;
}

/** Clear all stored nonces (for testing). */
export function clearNonces(): void {
  seenNonces.clear();
}

/** Get count of stored nonces (for debugging). */
export function getNonceCount(): number {
  return seenNonces.size;
}

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
export class DatabaseReplayStore implements NonceReplayStore {
  private readonly functionName: string;
  private readonly batchFunctionName: string;

  constructor(private readonly options: DatabaseReplayStoreOptions) {
    this.functionName = options.functionName ?? 'replay_check_and_store';
    this.batchFunctionName = options.batchFunctionName ?? 'replay_check_and_store_all';
  }

  async checkAndStoreAll(keys: string[]): Promise<boolean> {
    assertDistinctKeys(keys);
    const { data, error } = await this.options.rpc(this.batchFunctionName, { p_keys: keys });
    if (error) throw new Error('replay store is unavailable; payment cannot be accepted');
    if (typeof data !== 'boolean') throw new Error('replay store returned an unexpected answer; payment cannot be accepted');
    return data;
  }

  async checkAndStore(key: string): Promise<boolean> {
    if (typeof key !== 'string' || key.length === 0) throw new Error('replay key must be a non-empty string');
    const { data, error } = await this.options.rpc(this.functionName, { p_key: key });
    if (error) throw new Error('replay store is unavailable; payment cannot be accepted');
    if (typeof data !== 'boolean') throw new Error('replay store returned an unexpected answer; payment cannot be accepted');
    return data;
  }
}
