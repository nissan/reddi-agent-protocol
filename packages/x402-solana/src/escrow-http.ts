import { createHash, randomBytes } from 'node:crypto';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, unpackAccount, unpackMint } from '@solana/spl-token';
import { buildLockTokenEscrowInstruction, decodeTokenEscrowAccount, tokenEscrowAddresses, TokenEscrowTerms } from './token-escrow';

/** RAP-specific escrow extension; not the interoperable x402 SVM exact scheme. */
export interface EscrowChallenge {
  scheme: 'rap-spl-escrow-v1';
  network: 'solana-local-validator' | 'solana-devnet';
  genesisHash: string;
  tokenProgram: string;
  decimals: number;
  endpoint: string;
  requestHash: string;
  programId: string;
  payer: string;
  payee: string;
  mint: string;
  source: string;
  recipient: string;
  amount: string;
  nonce: string;
  expiresAt: number;
}
export interface EscrowProof { nonce: string; lockSignature: string }
export interface EscrowReceipt extends EscrowProof {
  scheme: 'rap-spl-escrow-v1';
  status: 'locked';
  escrow: string;
  amount: string;
  mint: string;
  requestHash: string;
  slot: number;
}
export const escrowRequestHash = (body: string) => createHash('sha256').update(body).digest('hex');
export function escrowTerms(c: EscrowChallenge): TokenEscrowTerms {
  if (c.scheme !== 'rap-spl-escrow-v1' || !['solana-local-validator', 'solana-devnet'].includes(c.network)) throw new Error('unsupported escrow scheme/network');
  if (!/^[0-9a-f]{32}$/.test(c.nonce) || !/^[1-9][0-9]*$/.test(c.amount)) throw new Error('invalid escrow nonce/amount');
  if (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 255) throw new Error('invalid mint decimals');
  const t = { tokenProgram: new PublicKey(c.tokenProgram), programId: new PublicKey(c.programId), payer: new PublicKey(c.payer), payee: new PublicKey(c.payee),
    mint: new PublicKey(c.mint), source: new PublicKey(c.source), recipient: new PublicKey(c.recipient), amount: BigInt(c.amount), nonce: Buffer.from(c.nonce, 'hex') };
  buildLockTokenEscrowInstruction(t); // Validate u64 and native-mint boundary before signing.
  return t;
}
export function createEscrowChallenge(input: Omit<EscrowChallenge, 'scheme' | 'nonce'>): EscrowChallenge {
  const c: EscrowChallenge = { ...input, scheme: 'rap-spl-escrow-v1', nonce: randomBytes(16).toString('hex') };
  escrowTerms(c);
  if (!Number.isSafeInteger(c.expiresAt) || c.expiresAt <= Date.now() || !/^[a-f0-9]{64}$/.test(c.requestHash)) throw new Error('invalid challenge lifetime/request hash');
  return c;
}

/** Read-only verification against a trusted RPC. No caller-supplied state or token identity. */
export async function verifyEscrowLock(connection: Connection, c: EscrowChallenge, proof: EscrowProof): Promise<EscrowReceipt> {
  const t = escrowTerms(c);
  if (!Number.isSafeInteger(c.expiresAt) || Date.now() >= c.expiresAt || proof.nonce !== c.nonce || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(proof.lockSignature)) throw new Error('invalid or expired payment proof');
  if (await connection.getGenesisHash() !== c.genesisHash) throw new Error('wrong cluster');
  const tx = await connection.getTransaction(proof.lockSignature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  if (!tx || !tx.meta || tx.meta.err) throw new Error('lock transaction missing or failed');
  const ix = buildLockTokenEscrowInstruction(t);
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const found = tx.transaction.message.compiledInstructions.some(i => keys.get(i.programIdIndex)?.equals(t.programId)
    && Buffer.from(i.data).equals(ix.data) && i.accountKeyIndexes.length === ix.keys.length
    && i.accountKeyIndexes.every((k, n) => keys.get(k)?.equals(ix.keys[n].pubkey))
    && tx.transaction.message.isAccountSigner(i.accountKeyIndexes[2]));
  if (!found) throw new Error('signature does not prove this lock');
  const { escrow, vault, bump } = tokenEscrowAddresses(t);
  const state = await connection.getAccountInfo(escrow, { commitment: 'finalized', minContextSlot: tx.slot });
  if (!state || !state.owner.equals(t.programId)) throw new Error('escrow missing or wrong owner');
  const decoded = decodeTokenEscrowAccount(state.data);
  for (const field of ['payer', 'payee', 'mint', 'source', 'recipient'] as const) {
    if (!decoded[field].equals(t[field])) throw new Error(`wrong escrow ${field}`);
  }
  if (decoded.amount !== t.amount || !decoded.nonce.equals(Buffer.from(t.nonce)) || decoded.status !== 0 || decoded.bump !== bump || decoded.createdSlot !== BigInt(tx.slot)) throw new Error('escrow terms mismatch');
  const mintInfo = await connection.getAccountInfo(t.mint, { commitment: 'finalized', minContextSlot: tx.slot });
  if (!mintInfo || unpackMint(t.mint, mintInfo, t.tokenProgram).decimals !== c.decimals) throw new Error('mint decimals mismatch');
  const info = await connection.getAccountInfo(vault, { commitment: 'finalized', minContextSlot: tx.slot });
  if (!info) throw new Error('vault missing');
  const token = unpackAccount(vault, info, TOKEN_PROGRAM_ID);
  if (!token.owner.equals(escrow) || !token.mint.equals(t.mint) || token.amount < t.amount || !token.isInitialized || token.isFrozen) throw new Error('vault mismatch');
  return { ...proof, scheme: c.scheme, status: 'locked', escrow: escrow.toBase58(), amount: c.amount, mint: c.mint, requestHash: c.requestHash, slot: tx.slot };
}

/** Single-process replay protection. Use durable atomic storage for multiple sellers/workers. */
export class EscrowSeller {
  private pending = new Map<string, EscrowChallenge>();
  private busy = new Set<string>();
  constructor(private connection: Connection) {}
  issue(input: Omit<EscrowChallenge, 'scheme' | 'nonce'>): EscrowChallenge {
    for (const [nonce, c] of this.pending) if (c.expiresAt <= Date.now()) this.pending.delete(nonce);
    if (this.pending.size >= 1000) throw new Error('challenge capacity exceeded');
    const c = createEscrowChallenge(input); this.pending.set(c.nonce, c); return c;
  }
  async accept(endpoint: string, body: string, proof: EscrowProof): Promise<EscrowReceipt> {
    const c = this.pending.get(proof.nonce);
    if (!c || this.busy.has(c.nonce) || c.endpoint !== endpoint || c.requestHash !== escrowRequestHash(body)) throw new Error('unknown, replayed or mismatched challenge');
    this.busy.add(c.nonce);
    try {
      const receipt = await verifyEscrowLock(this.connection, c, proof);
      this.pending.delete(c.nonce);
      return receipt;
    } finally { this.busy.delete(c.nonce); }
  }
}

/** Recovery context survives a paid retry/transport failure; never auto-pay twice. */
export class EscrowPurchaseError extends Error {
  constructor(message: string, readonly challenge: EscrowChallenge, readonly proof: EscrowProof) { super(message); this.name = 'EscrowPurchaseError'; }
}

export interface EscrowHttpResponse { status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }
/** At most one approved lock and one retry; transport and signing remain caller-owned. */
export async function buyWithEscrow(input: {
  endpoint: string; body: string;
  request(proof?: EscrowProof): Promise<EscrowHttpResponse>;
  approve(c: EscrowChallenge): Promise<void>;
  lock(c: EscrowChallenge): Promise<string>;
}): Promise<{ result: unknown; receipt: EscrowReceipt }> {
  const first = await input.request();
  if (first.status !== 402) throw new Error('expected HTTP 402');
  const c: EscrowChallenge = JSON.parse(first.headers.get('x402-request') ?? 'null');
  if (!c || !Number.isSafeInteger(c.expiresAt) || c.endpoint !== input.endpoint || c.requestHash !== escrowRequestHash(input.body) || c.expiresAt <= Date.now()) throw new Error('challenge request mismatch');
  escrowTerms(c);
  await input.approve(c); // Caller must pin cluster/program/mint/payer/recipient and a raw-unit spend cap.
  const proof = { nonce: c.nonce, lockSignature: await input.lock(c) };
  try {
    const retry = await input.request(proof);
    if (retry.status !== 200) throw new Error(`paid retry failed: ${retry.status}; retain lock proof for recovery`);
    const receipt: EscrowReceipt = JSON.parse(retry.headers.get('x402-receipt') ?? 'null');
    if (!receipt || !Number.isSafeInteger(receipt.slot) || receipt.slot < 0 || receipt.scheme !== c.scheme || receipt.status !== 'locked' || receipt.nonce !== c.nonce
      || receipt.lockSignature !== proof.lockSignature || receipt.amount !== c.amount || receipt.mint !== c.mint
      || receipt.requestHash !== c.requestHash || receipt.escrow !== tokenEscrowAddresses(escrowTerms(c)).escrow.toBase58()) throw new Error('invalid seller receipt');
    return { result: await retry.json(), receipt };
  } catch (error) {
    throw new EscrowPurchaseError(error instanceof Error ? error.message : String(error), c, proof);
  }
}
