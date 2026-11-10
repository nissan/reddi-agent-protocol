import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';

const disc = (kind: string, name: string) => createHash('sha256').update(`${kind}:${name}`).digest().subarray(0, 8);
export interface TokenEscrowTerms {
  programId: PublicKey;
  tokenProgram?: PublicKey;
  payer: PublicKey;
  payee: PublicKey;
  mint: PublicKey;
  source: PublicKey;
  recipient: PublicKey;
  amount: bigint;
  nonce: Uint8Array;
}
export function tokenEscrowAddresses(t: Pick<TokenEscrowTerms, 'programId' | 'payer' | 'nonce'>) {
  if (t.nonce.length !== 16) throw new Error('nonce must be 16 bytes');
  const [escrow, bump] = PublicKey.findProgramAddressSync([Buffer.from('token-escrow'), t.payer.toBuffer(), t.nonce], t.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('token-vault'), escrow.toBuffer()], t.programId);
  return { escrow, vault, bump };
}
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
export function buildLockTokenEscrowInstruction(t: TokenEscrowTerms): TransactionInstruction {
  if (t.tokenProgram && !t.tokenProgram.equals(TOKEN_PROGRAM_ID)) throw new Error('classic SPL Token only');
  if (t.amount <= 0n || t.amount > 0xffffffffffffffffn) throw new Error('amount must be a positive u64');
  if (t.mint.equals(NATIVE_MINT)) throw new Error('native mint unsupported');
  const { escrow, vault } = tokenEscrowAddresses(t);
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(t.amount);
  return new TransactionInstruction({ programId: t.programId,
    data: Buffer.concat([disc('global', 'lock_token_escrow'), amount, Buffer.from(t.nonce)]),
    keys: [meta(escrow, true), meta(vault, true), meta(t.payer, true, true), meta(t.payee), meta(t.mint),
      meta(t.source, true), meta(t.recipient), meta(TOKEN_PROGRAM_ID), meta(SystemProgram.programId)] });
}
/** Destination is always taken from the original lock terms. Only payer can settle. */
export function buildSettleTokenEscrowInstruction(t: TokenEscrowTerms, refund = false): TransactionInstruction {
  buildLockTokenEscrowInstruction(t);
  const { escrow, vault } = tokenEscrowAddresses(t);
  return new TransactionInstruction({ programId: t.programId,
    data: disc('global', refund ? 'cancel_token_escrow' : 'release_token_escrow'),
    keys: [meta(escrow, true), meta(vault, true), meta(t.payer, true, true), meta(t.mint),
      meta(refund ? t.source : t.recipient, true), meta(TOKEN_PROGRAM_ID)] });
}
export function decodeTokenEscrowAccount(data: Buffer) {
  if (data.length !== 202 || !data.subarray(0, 8).equals(disc('account', 'TokenEscrowAccount'))) throw new Error('invalid token escrow layout');
  return {
    payer: new PublicKey(data.subarray(8, 40)), payee: new PublicKey(data.subarray(40, 72)),
    mint: new PublicKey(data.subarray(72, 104)), source: new PublicKey(data.subarray(104, 136)),
    recipient: new PublicKey(data.subarray(136, 168)), amount: data.readBigUInt64LE(168),
    nonce: data.subarray(176, 192), status: data[192], createdSlot: data.readBigUInt64LE(193), bump: data[201],
  };
}
