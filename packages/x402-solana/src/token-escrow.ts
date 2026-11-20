import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from '@solana/spl-token';

const disc = (kind: string, name: string) => createHash('sha256').update(`${kind}:${name}`).digest().subarray(0, 8);
export interface TokenEscrowTerms {
  programId: PublicKey;
  tokenProgram: PublicKey;
  payer: PublicKey;
  payee: PublicKey;
  mint: PublicKey;
  source: PublicKey;
  recipient: PublicKey;
  amount: bigint;
  nonce: Uint8Array;
  /**
   * Metered (per-token) escrow: `amount` is the buyer's authorised maximum and
   * the payee may settle the actual cost, up to it, at any time.
   */
  metered?: boolean;
}

/** Protocol fee treasury fixed in the escrow program: the Squads vault. */
export const ESCROW_PROTOCOL_TREASURY = new PublicKey('5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe');

/** The treasury's associated token account for the escrow mint, which receives token fees. */
export function treasuryTokenAccount(t: Pick<TokenEscrowTerms, 'mint' | 'tokenProgram'>, treasury: PublicKey = ESCROW_PROTOCOL_TREASURY): PublicKey {
  return getAssociatedTokenAddressSync(t.mint, treasury, true, t.tokenProgram);
}
export function tokenEscrowAddresses(t: Pick<TokenEscrowTerms, 'programId' | 'payer' | 'nonce'>) {
  if (t.nonce.length !== 16) throw new Error('nonce must be 16 bytes');
  const [escrow, bump] = PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), t.payer.toBuffer(), t.nonce], t.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], t.programId);
  return { escrow, vault, bump };
}
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
export function buildLockTokenEscrowInstruction(t: TokenEscrowTerms): TransactionInstruction {
  // The on-chain allowlist decides which mint goes with which program; this only rejects any third program.
  if (!t.tokenProgram.equals(TOKEN_PROGRAM_ID) && !t.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw new Error('token program must be classic SPL Token or Token-2022');
  if (t.amount <= 0n || t.amount > 0xffffffffffffffffn) throw new Error('amount must be a positive u64');
  if (t.mint.equals(NATIVE_MINT)) throw new Error('native mint unsupported');
  const { escrow, vault } = tokenEscrowAddresses(t);
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(t.amount);
  return new TransactionInstruction({ programId: t.programId,
    data: Buffer.concat([disc('global', t.metered ? 'lock_metered_token_escrow' : 'lock_token_escrow'), amount, Buffer.from(t.nonce)]),
    keys: [meta(escrow, true), meta(vault, true), meta(t.payer, true, true), meta(t.payee), meta(t.mint),
      meta(t.source, true), meta(t.recipient), meta(t.tokenProgram), meta(SystemProgram.programId)] });
}
export interface SettleTokenEscrowOptions {
  /**
   * Settle at this actual cost (at most the locked amount) instead of the
   * whole locked amount. The payee may do this at any time on a metered escrow;
   * the payer may on any escrow.
   */
  actual?: bigint;
  /** Treasury token account. Defaults to the treasury's associated token account for the mint. */
  treasuryToken?: PublicKey;
  /** Where the unused part returns. Must be the recorded source unless the payer signs. */
  refundTo?: PublicKey;
}

/**
 * Destination is always taken from the original lock terms. `authority` signs and defaults to the payer.
 * Release: the program accepts the payer at any time, or the payee once the claim window has elapsed.
 * Settle (`options.actual`): the payee on a metered escrow, or the payer, at any time.
 * Every payout sends 2.5% of the paid amount to the treasury and the rest of the vault back to the payer.
 * Refund: the program accepts the payee at any time (decline), or the payer once the cancel window has elapsed.
 */
export function buildSettleTokenEscrowInstruction(t: TokenEscrowTerms, refund = false, authority: PublicKey = t.payer, options: SettleTokenEscrowOptions = {}): TransactionInstruction {
  buildLockTokenEscrowInstruction(t);
  const { escrow, vault } = tokenEscrowAddresses(t);
  if (refund) {
    if (options.actual !== undefined) throw new Error('a refund has no settled amount');
    return new TransactionInstruction({ programId: t.programId,
      data: disc('global', 'cancel_token_escrow'),
      keys: [meta(escrow, true), meta(vault, true), meta(authority, false, true), meta(t.payer, true), meta(t.mint),
        meta(t.source, true), meta(t.tokenProgram)] });
  }
  let data = disc('global', 'release_token_escrow');
  if (options.actual !== undefined) {
    if (options.actual <= 0n || options.actual > t.amount) throw new Error('settled amount must be above zero and at most the locked amount');
    const actual = Buffer.alloc(8); actual.writeBigUInt64LE(options.actual);
    data = Buffer.concat([disc('global', 'settle_token_escrow'), actual]);
  }
  return new TransactionInstruction({ programId: t.programId, data,
    keys: [meta(escrow, true), meta(vault, true), meta(authority, false, true), meta(t.payer, true), meta(t.mint),
      meta(t.recipient, true), meta(options.treasuryToken ?? treasuryTokenAccount(t), true), meta(options.refundTo ?? t.source, true),
      meta(t.tokenProgram)] });
}
export function decodeTokenEscrowAccount(data: Buffer) {
  if (data.length !== 203 || !data.subarray(0, 8).equals(disc('account', 'TokenEscrowAccount'))) throw new Error('invalid token escrow layout');
  return {
    payer: new PublicKey(data.subarray(8, 40)), payee: new PublicKey(data.subarray(40, 72)),
    mint: new PublicKey(data.subarray(72, 104)), source: new PublicKey(data.subarray(104, 136)),
    recipient: new PublicKey(data.subarray(136, 168)), amount: data.readBigUInt64LE(168),
    nonce: data.subarray(176, 192), status: data[192], createdSlot: data.readBigUInt64LE(193), bump: data[201],
    metered: data[202] === 1,
  };
}
