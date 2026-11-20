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
};

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
}

/**
 * Durable replay store backed by an atomic database function, so a key is
 * accepted once across restarts and across every instance of the service.
 * Fails closed: a database error or an unexpected answer throws, and the payment
 * is not accepted.
 */
export class DatabaseReplayStore implements NonceReplayStore {
  private readonly functionName: string;

  constructor(private readonly options: DatabaseReplayStoreOptions) {
    this.functionName = options.functionName ?? 'replay_check_and_store';
  }

  async checkAndStore(key: string): Promise<boolean> {
    if (typeof key !== 'string' || key.length === 0) throw new Error('replay key must be a non-empty string');
    const { data, error } = await this.options.rpc(this.functionName, { p_key: key });
    if (error) throw new Error('replay store is unavailable; payment cannot be accepted');
    if (typeof data !== 'boolean') throw new Error('replay store returned an unexpected answer; payment cannot be accepted');
    return data;
  }
}
