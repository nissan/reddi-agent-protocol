/**
 * Proof that a paid call comes from the buyer that locked the escrow: every
 * call of a session, and a single metered call (action `single`, #866).
 *
 * The lock's escrow, payer and nonce are public once it confirms, so they
 * cannot show who is calling. The buyer makes a fresh ed25519 key for the
 * session and has its payer wallet sign, once, a delegation naming the
 * escrow, the provider, that key and an expiry (a plain-text message, so a
 * browser wallet can sign it with `signMessage`). Every call, close and read
 * then carries a signature by the session key over the action, the escrow,
 * the call number and the SHA-256 of the request body. The provider checks
 * both before it reserves a call, and the session keeps the first key it saw,
 * so a second delegation cannot take over a session already started.
 *
 * Both messages name the cluster by its genesis hash, so a signature made for
 * one network is refused on every other, even where the program id, escrow
 * address and provider are the same.
 *
 * Headers:
 * - `x402-session-delegation`: base64 of JSON `{network, escrow, provider, sessionKey, expiresAt, signature}`;
 *   `network` is the cluster's genesis hash;
 *   `expiresAt` is whole seconds since the epoch, `signature` base64 of the payer's signature over
 *   `sessionDelegationMessage(...)`.
 * - `x402-session-signature`: base64 of the session key's signature over `sessionRequestMessage(...)`.
 *
 * Verification uses Node's crypto; signing takes a callback, so the buyer can
 * sign with a wallet adapter, a Keypair or anything else.
 */
import { createHash } from 'crypto';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { HeaderReader } from './provider';
import { decodeBase64, ed25519Verify, publicKeyOf } from './ed25519';

export const SESSION_DELEGATION_HEADER = 'x402-session-delegation';
export const SESSION_SIGNATURE_HEADER = 'x402-session-signature';
/** The longest a delegation may run. A session settles before its refund window anyway. */
export const MAX_SESSION_DELEGATION_SECONDS = 7 * 24 * 60 * 60;
/**
 * How long a buyer client should let a delegation run unless it has a reason
 * to choose otherwise: a day, well short of the maximum, because anyone holding
 * the session key can sign for the payer until then. Keep the key in memory
 * only (never in localStorage or on disk), and sign a new delegation when it runs out.
 */
export const DEFAULT_DELEGATION_SECONDS = 24 * 60 * 60;

/** Buyer side: the `expiresAt` for a new delegation, `seconds` (default a day) from `nowMs`. */
export function delegationExpiresAt(nowMs: number = Date.now(), seconds: number = DEFAULT_DELEGATION_SECONDS): number {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > MAX_SESSION_DELEGATION_SECONDS) {
    throw new Error(`a delegation runs for 1 to ${MAX_SESSION_DELEGATION_SECONDS} seconds`);
  }
  return Math.floor(nowMs / 1000) + seconds;
}

/**
 * `call`: a session call. `call-close`: a session call that also asks the
 * provider to settle the session after answering it. `close`, `read`: session
 * requests without a call. `single`: a single metered call, sequence 0.
 */
export type SessionAction = 'call' | 'call-close' | 'close' | 'read' | 'single';

/** The action a session call is signed under: `call-close` when it asks to close the session. */
export function sessionCallAction(close: boolean): SessionAction {
  return close ? 'call-close' : 'call';
}

export interface SessionDelegation {
  /** The genesis hash of the cluster the escrow is on (`SOLANA_GENESIS_HASHES[network]`). */
  genesisHash: string;
  escrow: string;
  provider: string;
  sessionKey: string;
  /** Whole seconds since the epoch. */
  expiresAt: number;
}

export type SessionAuthFailure = {
  ok: false;
  reason: 'session_auth_required' | 'session_auth_invalid' | 'session_auth_expired';
  message: string;
};

/** The text the payer wallet signs to hand a session to `sessionKey`. */
export function sessionDelegationMessage(d: SessionDelegation): string {
  return [
    'Reddi Agent Protocol session',
    'I let this session key make paid calls on my escrow lock.',
    `network: ${d.genesisHash}`,
    `escrow: ${d.escrow}`,
    `provider: ${d.provider}`,
    `session key: ${d.sessionKey}`,
    `expires: ${new Date(d.expiresAt * 1000).toISOString()}`,
  ].join('\n');
}

/** SHA-256 of a request body, hex. An empty body hashes as zero bytes. */
export function sessionBodyHash(body: Uint8Array | string = ''): string {
  return createHash('sha256').update(typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body)).digest('hex');
}

/** The bytes the session key signs for one request. `sequence` is the call number for `call` and `call-close`, and 0 for `close`, `read` and `single`. */
export function sessionRequestMessage(input: { genesisHash: string; action: SessionAction; escrow: string; sequence: number; bodyHash: string }): string {
  return ['reddi-session/2', input.genesisHash, input.action, input.escrow, String(input.sequence), input.bodyHash].join('\n');
}

export type Signer = (message: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** Buyer side: the delegation header value, signed by the payer wallet. Use `delegationExpiresAt()` for `expiresAt`. */
export async function sessionDelegationHeaderValue(d: SessionDelegation, signWithPayer: Signer): Promise<string> {
  const signature = await signWithPayer(new TextEncoder().encode(sessionDelegationMessage(d)));
  const { genesisHash, ...rest } = d;
  return Buffer.from(JSON.stringify({ network: genesisHash, ...rest, signature: Buffer.from(signature).toString('base64') }), 'utf8').toString('base64');
}

/** Buyer side: the signature header value for one request, signed by the session key. */
export async function sessionSignatureHeaderValue(input: { genesisHash: string; action: SessionAction; escrow: string; sequence: number; body?: Uint8Array | string }, signWithSessionKey: Signer): Promise<string> {
  const message = sessionRequestMessage({ genesisHash: input.genesisHash, action: input.action, escrow: input.escrow, sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
  return Buffer.from(await signWithSessionKey(new TextEncoder().encode(message))).toString('base64');
}

/**
 * Provider side: checks that a session request is signed by a key the payer
 * handed this session to. Returns the session key on success. `payer` and
 * `escrow` come from the payment header (the lock check then confirms them on
 * chain); `provider` is this provider's payee wallet; `genesisHash` is the
 * genesis hash of the cluster this provider checked it is on; `body` is the raw
 * request body exactly as received.
 */
export function verifySessionRequest(input: SessionRequestInput): { ok: true; sessionKey: string; expiresAt: number } | SessionAuthFailure {
  const parsed = parseSessionRequest(input);
  if (!parsed.ok) return parsed;
  if (parsed.proof.kind !== 'signature') {
    return { ok: false, reason: 'session_auth_invalid', message: 'This delegation is proved by a lock transaction memo, which this check cannot read. Use verifySessionRequestWithTransactions.' };
  }
  if (!ed25519Verify(input.payer, new TextEncoder().encode(sessionDelegationMessage(parsed.delegation)), parsed.proof.signature)) {
    return { ok: false, reason: 'session_auth_invalid', message: "The session delegation is not signed by the escrow's payer." };
  }
  return { ok: true, sessionKey: parsed.delegation.sessionKey, expiresAt: parsed.delegation.expiresAt };
}

export interface SessionRequestInput {
  headers: HeaderReader;
  genesisHash: string;
  action: SessionAction;
  escrow: PublicKey;
  payer: PublicKey;
  provider: PublicKey;
  sequence: number;
  body?: Uint8Array | string;
  nowMs: number;
}

type DelegationProof = { kind: 'signature'; signature: Uint8Array } | { kind: 'lock-memo'; lockSignature: string };

/**
 * Everything but the payer's consent: the delegation's shape, network,
 * escrow, provider and expiry, and the session key's signature over this request.
 */
function parseSessionRequest(input: SessionRequestInput): { ok: true; delegation: SessionDelegation; proof: DelegationProof } | SessionAuthFailure {
  const delegationValue = input.headers.get(SESSION_DELEGATION_HEADER);
  const signatureValue = input.headers.get(SESSION_SIGNATURE_HEADER);
  if (!delegationValue || !signatureValue) {
    return { ok: false, reason: 'session_auth_required', message: `Paid requests must carry ${SESSION_DELEGATION_HEADER} (the payer wallet's delegation to a session key) and ${SESSION_SIGNATURE_HEADER} (that key's signature over this request).` };
  }
  const invalid = (message: string): SessionAuthFailure => ({ ok: false, reason: 'session_auth_invalid', message });
  const raw = decodeBase64(delegationValue);
  if (!raw) return invalid('The session delegation is not base64.');
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('The session delegation is not an object.');
    parsed = value as Record<string, unknown>;
  } catch {
    return invalid('The session delegation is not JSON.');
  }
  if (typeof parsed.network !== 'string' || parsed.network.length === 0) return invalid('The session delegation names no network. Sign a new one with this client version.');
  if (parsed.network !== input.genesisHash) return invalid('The session delegation was signed for another network.');
  const escrow = publicKeyOf(parsed.escrow);
  const provider = publicKeyOf(parsed.provider);
  const sessionKey = publicKeyOf(parsed.sessionKey);
  const expiresAt = parsed.expiresAt;
  let proof: DelegationProof | undefined;
  if (parsed.signature !== undefined && parsed.lockSignature !== undefined) return invalid('A session delegation carries a signature or a lockSignature, not both.');
  if (typeof parsed.signature === 'string') {
    const signature = decodeBase64(parsed.signature);
    if (signature) proof = { kind: 'signature', signature };
  } else if (typeof parsed.lockSignature === 'string' && TX_SIGNATURE.test(parsed.lockSignature)) {
    proof = { kind: 'lock-memo', lockSignature: parsed.lockSignature };
  }
  if (!escrow || !provider || !sessionKey || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || !proof) {
    return invalid('The session delegation needs escrow, provider, sessionKey, a whole-second expiresAt and a signature (or the lockSignature of a lock that carries its memo).');
  }
  if (!escrow.equals(input.escrow)) return invalid('The session delegation names another escrow.');
  if (!provider.equals(input.provider)) return invalid('The session delegation names another provider.');
  const nowSeconds = Math.floor(input.nowMs / 1000);
  if (expiresAt <= nowSeconds) return { ok: false, reason: 'session_auth_expired', message: 'The session delegation has expired. Sign a new one with the payer wallet.' };
  if (expiresAt > nowSeconds + MAX_SESSION_DELEGATION_SECONDS) return invalid(`A session delegation may run for at most ${MAX_SESSION_DELEGATION_SECONDS} seconds.`);
  const delegation: SessionDelegation = { genesisHash: input.genesisHash, escrow: escrow.toBase58(), provider: provider.toBase58(), sessionKey: sessionKey.toBase58(), expiresAt };
  const requestSignature = decodeBase64(signatureValue);
  const message = sessionRequestMessage({ genesisHash: input.genesisHash, action: input.action, escrow: delegation.escrow, sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
  if (!requestSignature || !ed25519Verify(sessionKey, new TextEncoder().encode(message), requestSignature)) {
    return invalid('The request is not signed by the session key, or was changed after signing.');
  }
  return { ok: true, delegation, proof };
}

/**
 * Buyer side, single metered call: both headers for one call on the lock
 * `escrow`. With no `sessionKey`, the payer signs the request too (fine for a
 * server-held keypair; a browser wallet would then sign twice, so pass a
 * fresh key there and keep it for the call).
 */
export async function paidCallAuthHeaders(input: {
  /** The genesis hash of the cluster the escrow is on. */
  genesisHash: string;
  escrow: string;
  provider: string;
  body: Uint8Array | string;
  payer: string;
  signWithPayer: Signer;
  sessionKey?: { publicKey: string; sign: Signer };
  expiresAt?: number;
  nowMs?: number;
}): Promise<Record<string, string>> {
  const key = input.sessionKey ?? { publicKey: input.payer, sign: input.signWithPayer };
  const expiresAt = input.expiresAt ?? Math.floor((input.nowMs ?? Date.now()) / 1000) + 600;
  return {
    [SESSION_DELEGATION_HEADER]: await sessionDelegationHeaderValue({ genesisHash: input.genesisHash, escrow: input.escrow, provider: input.provider, sessionKey: key.publicKey, expiresAt }, input.signWithPayer),
    [SESSION_SIGNATURE_HEADER]: await sessionSignatureHeaderValue({ genesisHash: input.genesisHash, action: 'single', escrow: input.escrow, sequence: 0, body: input.body }, key.sign),
  };
}

/** Provider side, single metered call: `verifySessionRequest` with action `single` and sequence 0. */
export function verifyPaidCallRequest(input: Omit<Parameters<typeof verifySessionRequest>[0], 'action' | 'sequence'>): ReturnType<typeof verifySessionRequest> {
  return verifySessionRequest({ ...input, action: 'single', sequence: 0 });
}

/*
 * Transaction-bound delegation (#925, Solana Pay transaction requests).
 *
 * A Solana Pay transaction request lets a phone wallet sign a transaction our
 * server builds, but it cannot sign a separate message. So the lock
 * transaction itself carries the delegation: a Memo program instruction whose
 * text is `reddi-session/2 delegate <sha256 hex of sessionDelegationMessage(d)>`
 * (the message names the network's genesis hash, so the memo binds it too)
 * and which names the payer as a required signer. The payer's signature on
 * that transaction is then its consent to exactly that escrow, provider,
 * session key and expiry, as a `signMessage` signature would be. The header
 * carries `lockSignature` (the transaction signature) in place of `signature`.
 *
 * The provider checks: the transaction confirmed without error, the payer
 * signed it, it holds that memo instruction with the payer among the memo's
 * signers, and it touches the escrow account (so the memo travels with this
 * lock and no other).
 */

/** The SPL Memo program (v2), which fails unless every account it names has signed. */
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const SESSION_DELEGATION_MEMO_PREFIX = 'reddi-session/2 delegate ';
const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/** The memo text that binds a delegation to the transaction that carries it. */
export function sessionDelegationMemo(d: SessionDelegation): string {
  return SESSION_DELEGATION_MEMO_PREFIX + createHash('sha256').update(sessionDelegationMessage(d), 'utf8').digest('hex');
}

/** Buyer side: the memo instruction to add to the lock transaction, signed by the payer. */
export function sessionDelegationMemoInstruction(d: SessionDelegation, payer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from(sessionDelegationMemo(d), 'utf8'),
  });
}

/** Buyer side: the delegation header for a delegation proved by the confirmed lock transaction `lockSignature`. */
export function lockBoundDelegationHeaderValue(d: SessionDelegation, lockSignature: string): string {
  if (!TX_SIGNATURE.test(lockSignature)) throw new Error('lockSignature must be a base58 transaction signature');
  const { genesisHash, ...rest } = d;
  return Buffer.from(JSON.stringify({ network: genesisHash, ...rest, lockSignature }), 'utf8').toString('base64');
}

/** What the provider needs to know about a confirmed transaction. */
export interface ConfirmedTransactionFacts {
  /** True when the transaction failed. */
  failed: boolean;
  /** Base58 addresses that signed the transaction. */
  signers: string[];
  /** Base58 addresses of every account the transaction names, including loaded lookup-table addresses. */
  accounts: string[];
  /** Each Memo program instruction: its UTF-8 text and the base58 accounts it names. */
  memos: { text: string; accounts: string[] }[];
}

/** Reads a confirmed transaction by signature, or null when the cluster does not have it (yet). Throws when the chain cannot be read. */
export type TransactionFactsReader = (signature: string) => Promise<ConfirmedTransactionFacts | null>;

/** A `TransactionFactsReader` over `Connection.getTransaction` at `confirmed`. */
export function transactionFactsReader(connection: { getTransaction: (signature: string, options: { commitment: 'confirmed' | 'finalized'; maxSupportedTransactionVersion: number }) => Promise<unknown> }, commitment: 'confirmed' | 'finalized' = 'confirmed'): TransactionFactsReader {
  return async (signature) => {
    const tx = (await connection.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 })) as {
      meta: { err: unknown; loadedAddresses?: { writable: PublicKey[]; readonly: PublicKey[] } } | null;
      transaction: { message: { header: { numRequiredSignatures: number }; staticAccountKeys?: PublicKey[]; accountKeys?: PublicKey[]; compiledInstructions?: { programIdIndex: number; accountKeyIndexes: number[]; data: Uint8Array }[]; instructions?: { programIdIndex: number; accounts: number[]; data: string }[] } };
    } | null;
    if (!tx) return null;
    const message = tx.transaction.message;
    const statics = (message.staticAccountKeys ?? message.accountKeys ?? []).map((k) => k.toBase58());
    const loaded = tx.meta?.loadedAddresses ? [...tx.meta.loadedAddresses.writable, ...tx.meta.loadedAddresses.readonly].map((k) => k.toBase58()) : [];
    const accounts = [...statics, ...loaded];
    const compiled = message.compiledInstructions
      ?? (message.instructions ?? []).map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: ix.accounts, data: bs58Decode(ix.data) }));
    const memos = compiled
      .filter((ix) => accounts[ix.programIdIndex] === MEMO_PROGRAM_ID.toBase58())
      .map((ix) => ({ text: Buffer.from(ix.data).toString('utf8'), accounts: ix.accountKeyIndexes.map((i) => accounts[i] ?? '') }));
    return { failed: tx.meta === null || tx.meta.err !== null, signers: statics.slice(0, message.header.numRequiredSignatures), accounts, memos };
  };
}

function bs58Decode(value: string): Uint8Array {
  // Legacy messages carry instruction data as base58; PublicKey's decoder is not exported, so decode by hand.
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const c of value) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) return new Uint8Array();
    n = n * BigInt(58) + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > BigInt(0)) {
    bytes.unshift(Number(n % BigInt(256)));
    n /= BigInt(256);
  }
  for (const c of value) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * Provider side: `verifySessionRequest`, and also a delegation proved by the
 * memo in its lock transaction. Without `readTransaction` a lock-bound
 * delegation is refused. Run it after the lock check, so the escrow named
 * here is known to be this payer's lock.
 */
export async function verifySessionRequestWithTransactions(input: SessionRequestInput & { readTransaction?: TransactionFactsReader }): Promise<{ ok: true; sessionKey: string; expiresAt: number } | SessionAuthFailure | { ok: false; reason: 'payment_check_unavailable'; message: string }> {
  const parsed = parseSessionRequest(input);
  if (!parsed.ok) return parsed;
  if (parsed.proof.kind === 'signature') return verifySessionRequest(input);
  const invalid = (message: string): SessionAuthFailure => ({ ok: false, reason: 'session_auth_invalid', message });
  if (!input.readTransaction) return invalid('This provider does not take delegations proved by a lock transaction. Sign the delegation with the payer wallet.');
  let facts: ConfirmedTransactionFacts | null;
  try {
    facts = await input.readTransaction(parsed.proof.lockSignature);
  } catch {
    return { ok: false, reason: 'payment_check_unavailable', message: 'The chain could not be read. Nothing was accepted; present the same request again.' };
  }
  if (!facts) return invalid('The lock transaction named by the delegation is not confirmed yet.');
  if (facts.failed) return invalid('The lock transaction named by the delegation failed.');
  const payer = input.payer.toBase58();
  if (!facts.signers.includes(payer)) return invalid("The lock transaction was not signed by the escrow's payer.");
  if (!facts.accounts.includes(input.escrow.toBase58())) return invalid('The lock transaction does not touch this escrow.');
  const memo = sessionDelegationMemo(parsed.delegation);
  if (!facts.memos.some((m) => m.text === memo && m.accounts.includes(payer))) {
    return invalid('The lock transaction carries no memo for this delegation signed by the payer.');
  }
  return { ok: true, sessionKey: parsed.delegation.sessionKey, expiresAt: parsed.delegation.expiresAt };
}

/** Provider side, single metered call: `verifySessionRequestWithTransactions` with action `single` and sequence 0. */
export function verifyPaidCallRequestWithTransactions(input: Omit<Parameters<typeof verifySessionRequestWithTransactions>[0], 'action' | 'sequence'>): ReturnType<typeof verifySessionRequestWithTransactions> {
  return verifySessionRequestWithTransactions({ ...input, action: 'single', sequence: 0 });
}
