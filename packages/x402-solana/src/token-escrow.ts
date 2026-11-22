import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from '@solana/spl-token';

/**
 * Anchor discriminators: the first 8 bytes of sha256("<kind>:<name>"). Fixed
 * here rather than hashed at runtime so this module also loads in a browser
 * bundle, where `node:crypto` is not available. A test recomputes each one.
 */
export const TOKEN_ESCROW_DISCRIMINATORS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'global:lock_token_escrow': [206, 229, 150, 243, 193, 67, 46, 76],
  'global:lock_metered_token_escrow': [255, 200, 147, 208, 111, 112, 137, 160],
  'global:cancel_token_escrow': [208, 16, 138, 187, 26, 94, 168, 29],
  'global:release_token_escrow': [29, 158, 153, 156, 235, 117, 59, 61],
  'global:settle_token_escrow': [219, 152, 168, 185, 213, 166, 162, 209],
  'account:TokenEscrowAccount': [95, 163, 251, 252, 52, 125, 37, 71],
});
const disc = (kind: string, name: string) => {
  const bytes = TOKEN_ESCROW_DISCRIMINATORS[`${kind}:${name}`];
  if (!bytes) throw new Error(`unknown discriminator ${kind}:${name}`);
  return Buffer.from(bytes);
};
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
  /**
   * Slots after the lock from which the payee may claim the whole amount.
   * Defaults to `DEFAULT_CLAIM_WINDOW_SLOTS` (about 10 minutes).
   */
  claimWindowSlots?: bigint;
  /**
   * Slots after the lock from which the payer may refund itself. Never before
   * the claim window. Defaults to `DEFAULT_CANCEL_WINDOW_SLOTS` (about 30 minutes).
   */
  cancelWindowSlots?: bigint;
}

/** Nominal slot time the program's windows are counted in. Real slot times drift, so a window is approximate in seconds. */
export const ESCROW_SLOT_MS = 400;
/** Windows used when a lock names none. Mirror `programs/pinocchio-escrow/program/src/consts.rs`. */
export const DEFAULT_CLAIM_WINDOW_SLOTS = 1_500n;
export const DEFAULT_CANCEL_WINDOW_SLOTS = 4_500n;
/** The longest refund window the program accepts: about 30 days. */
export const MAX_ESCROW_WINDOW_SLOTS = 6_480_000n;
/**
 * The least a seller should have left of a metered escrow's refund window
 * when it takes the call: about 10 minutes. The payer may refund once its
 * window has elapsed, so the seller must settle before then. Compare it with
 * `createdSlot + cancelWindowSlots - current slot`, not with the window named
 * at lock, which a buyer can let run down before calling.
 */
export const SELLER_MIN_CANCEL_WINDOW_SLOTS = 1_500n;

/** A duration in seconds as a whole number of slots, rounded up, at the nominal slot time. */
export function escrowWindowSlots(seconds: number): bigint {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('window must be a positive number of seconds');
  return BigInt(Math.ceil((seconds * 1000) / ESCROW_SLOT_MS));
}

/** The program's rule: claim window of at least one slot, no later than the refund window, refund window at most the maximum. */
export function escrowWindows(t: Pick<TokenEscrowTerms, 'claimWindowSlots' | 'cancelWindowSlots'>): { claimWindowSlots: bigint; cancelWindowSlots: bigint } {
  const claimWindowSlots = t.claimWindowSlots ?? DEFAULT_CLAIM_WINDOW_SLOTS;
  const cancelWindowSlots = t.cancelWindowSlots ?? DEFAULT_CANCEL_WINDOW_SLOTS;
  if (claimWindowSlots < 1n || claimWindowSlots > cancelWindowSlots || cancelWindowSlots > MAX_ESCROW_WINDOW_SLOTS) {
    throw new Error('claim window must be at least one slot, no later than the refund window, and the refund window at most 30 days');
  }
  return { claimWindowSlots, cancelWindowSlots };
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
  const { claimWindowSlots, cancelWindowSlots } = escrowWindows(t);
  const windows = Buffer.alloc(16); windows.writeBigUInt64LE(claimWindowSlots); windows.writeBigUInt64LE(cancelWindowSlots, 8);
  return new TransactionInstruction({ programId: t.programId,
    data: Buffer.concat([disc('global', t.metered ? 'lock_metered_token_escrow' : 'lock_token_escrow'), amount, Buffer.from(t.nonce), windows]),
    keys: [meta(escrow, true), meta(vault, true), meta(t.payer, true, true), meta(t.payee), meta(t.mint),
      meta(t.source, true), meta(t.recipient), meta(t.tokenProgram), meta(SystemProgram.programId)] });
}
export interface SettleTokenEscrowOptions {
  /**
   * Settle at this actual cost (at most the locked amount) instead of the
   * whole locked amount. Only the payee may, and only on a metered escrow.
   */
  actual?: bigint;
  /**
   * Pay the payee at this token account instead of the recipient recorded at
   * lock. Only when the payee itself is the authority (claim or settle), and it
   * must be a token account of the escrow mint that the payee owns. For a
   * recorded recipient that was since closed or frozen.
   */
  payTo?: PublicKey;
  /**
   * Pass the mint writable, so that transfer fees withheld on a Token-2022
   * vault are moved to the mint and the vault can close, returning its rent to
   * the payer. Leave it off otherwise: a writable mint makes every such
   * transaction contend for the same account. Applies to refunds too.
   */
  harvestWithheldFees?: boolean;
  /** Treasury token account. The program accepts only the treasury's associated token account for the mint. */
  treasuryToken?: PublicKey;
  /** Where the unused part returns: any token account of the mint the payer owns. Defaults to the recorded source. */
  refundTo?: PublicKey;
}

/**
 * `authority` signs and defaults to the payer. The destination is the recipient in the lock terms, unless the
 * payee is the authority and names another of its own token accounts (`options.payTo`).
 * Release: the program accepts the payer at any time, or the payee once the claim window has elapsed.
 * Settle (`options.actual`): only the payee, and only on a metered escrow; pass the payee as `authority`.
 * The payer never chooses a smaller amount: it releases in full, or refunds once the cancel window has elapsed.
 * Every payout sends the protocol fee (2.5% until 1 April 2027, then 5%) of the paid amount to the treasury and the rest of the vault back to the payer.
 * Refund: the program accepts the payee at any time (decline), or the payer once the cancel window has elapsed.
 *
 * This builds the exit's own data and accounts only. The program also requires the escrow's lock slot
 * (`createdSlot` of `decodeTokenEscrowAccount`) after the data, naming the escrow being ended, so send it through
 * `buildTokenEscrowExitInstruction` (or `withRatingAccount`), which adds that and, for a rated escrow, its rating account.
 */
export function buildSettleTokenEscrowInstruction(t: TokenEscrowTerms, refund = false, authority: PublicKey = t.payer, options: SettleTokenEscrowOptions = {}): TransactionInstruction {
  buildLockTokenEscrowInstruction(t);
  const { escrow, vault } = tokenEscrowAddresses(t);
  const harvest = options.harvestWithheldFees === true;
  if (refund) {
    if (options.actual !== undefined) throw new Error('a refund has no settled amount');
    if (options.payTo) throw new Error('a refund goes to the payer');
    return new TransactionInstruction({ programId: t.programId,
      data: disc('global', 'cancel_token_escrow'),
      keys: [meta(escrow, true), meta(vault, true), meta(authority, false, true), meta(t.payer, true), meta(t.mint, harvest),
        meta(t.source, true), meta(t.tokenProgram)] });
  }
  if (options.payTo && !authority.equals(t.payee)) throw new Error('only the payee chooses another payout account: pass the payee as the authority');
  let data = disc('global', 'release_token_escrow');
  if (options.actual !== undefined) {
    if (!authority.equals(t.payee)) throw new Error('only the payee settles: pass the payee as the authority');
    if (options.actual <= 0n || options.actual > t.amount) throw new Error('settled amount must be above zero and at most the locked amount');
    const actual = Buffer.alloc(8); actual.writeBigUInt64LE(options.actual);
    data = Buffer.concat([disc('global', 'settle_token_escrow'), actual]);
  }
  return new TransactionInstruction({ programId: t.programId, data,
    keys: [meta(escrow, true), meta(vault, true), meta(authority, false, true), meta(t.payer, true), meta(t.mint, harvest),
      meta(options.payTo ?? t.recipient, true), meta(options.treasuryToken ?? treasuryTokenAccount(t), true), meta(options.refundTo ?? t.source, true),
      meta(t.tokenProgram)] });
}
/** Size of a token escrow account locked before windows were stored on it (fixed 3-day refund, 7-day claim). */
const LEGACY_TOKEN_ESCROW_LEN = 203;
const TOKEN_ESCROW_LEN = 219;
/**
 * Reads a token escrow account. `claimWindowSlots` and `cancelWindowSlots` are
 * undefined on an account the earlier program wrote, which stored no windows.
 */
export function decodeTokenEscrowAccount(data: Buffer) {
  if ((data.length !== TOKEN_ESCROW_LEN && data.length !== LEGACY_TOKEN_ESCROW_LEN) || !data.subarray(0, 8).equals(disc('account', 'TokenEscrowAccount'))) throw new Error('invalid token escrow layout');
  const windows = data.length === TOKEN_ESCROW_LEN;
  return {
    claimWindowSlots: windows ? data.readBigUInt64LE(203) : undefined,
    cancelWindowSlots: windows ? data.readBigUInt64LE(211) : undefined,
    payer: new PublicKey(data.subarray(8, 40)), payee: new PublicKey(data.subarray(40, 72)),
    mint: new PublicKey(data.subarray(72, 104)), source: new PublicKey(data.subarray(104, 136)),
    recipient: new PublicKey(data.subarray(136, 168)), amount: data.readBigUInt64LE(168),
    nonce: data.subarray(176, 192), status: data[192], createdSlot: data.readBigUInt64LE(193), bump: data[201],
    // One flag byte: bit 0x01 metered, bit 0x02 rated. A rated metered escrow stores 3.
    metered: (data[202] & 0x01) !== 0,
    /** The buyer opted this job in to rating: every exit must pass the rating account (`withRatingAccount`). */
    rated: (data[202] & 0x02) !== 0,
  };
}
