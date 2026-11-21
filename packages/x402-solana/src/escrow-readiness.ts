import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMintCloseAuthority,
  getPausableConfig,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from '@solana/spl-token';
import { ESCROW_PROTOCOL_TREASURY, TokenEscrowTerms, treasuryTokenAccount } from './token-escrow';

/**
 * Launch and payout checks for the V1 escrow program. These guard against
 * payouts that the program would accept but the runtime would refuse: a SOL
 * transfer that leaves the receiver below the rent-exempt minimum, and a token
 * payout to a treasury or refund token account that does not exist yet.
 */

/** Rent-exempt minimum of a plain system account (0 bytes of data). */
export const SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS = 890_880n;

/** The treasury holds at least this much SOL before the first SOL payout, so a small fee never fails on rent. */
export const TREASURY_MIN_LAMPORTS = 1_000_000n;

/**
 * True when sending `incomingLamports` to an account holding `currentLamports`
 * would leave it above zero but below the rent-exempt minimum, which the
 * runtime refuses (InsufficientFundsForRent). A zero transfer never fails.
 */
export function solPayoutWouldFail(currentLamports: bigint, incomingLamports: bigint, rentExemptLamports: bigint = SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS): boolean {
  if (incomingLamports <= 0n) return false;
  return currentLamports + incomingLamports < rentExemptLamports;
}

/**
 * The smallest payout a payee holding `currentLamports` can receive. Zero when
 * the payee is already rent-exempt.
 */
export function minimumSolPayout(currentLamports: bigint, rentExemptLamports: bigint = SYSTEM_ACCOUNT_RENT_EXEMPT_LAMPORTS): bigint {
  return currentLamports >= rentExemptLamports ? 0n : rentExemptLamports - currentLamports;
}

export interface SettlePreparation {
  /** Idempotent creates to put before the settle in the same transaction. */
  instructions: TransactionInstruction[];
  /** The payer's associated token account, to pass as `refundTo`. */
  refundTo: PublicKey;
  treasuryToken: PublicKey;
}

/**
 * Instructions that make sure a token payout's destinations exist: the
 * treasury's associated token account for the mint, and the payer's, which
 * receives the unused part. Both creates are idempotent, so they cost nothing
 * when the accounts are already there. `funder` pays rent for any account it
 * creates and must sign the transaction; for a settle that is the payee.
 */
export function prepareTokenPayout(
  t: Pick<TokenEscrowTerms, 'mint' | 'tokenProgram' | 'payer'>,
  funder: PublicKey,
  treasury: PublicKey = ESCROW_PROTOCOL_TREASURY,
): SettlePreparation {
  if (!t.tokenProgram.equals(TOKEN_PROGRAM_ID) && !t.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error('token program must be classic SPL Token or Token-2022');
  }
  const treasuryToken = treasuryTokenAccount(t, treasury);
  const refundTo = getAssociatedTokenAddressSync(t.mint, t.payer, true, t.tokenProgram);
  return {
    treasuryToken,
    refundTo,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(funder, treasuryToken, treasury, t.mint, t.tokenProgram),
      createAssociatedTokenAccountIdempotentInstruction(funder, refundTo, t.payer, t.mint, t.tokenProgram),
    ],
  };
}

export interface EscrowMint {
  symbol: string;
  mint: PublicKey;
  tokenProgram: PublicKey;
}

/** The mainnet allowlist of the V1 escrow program (programs/pinocchio-escrow/program/src/consts.rs). */
export const ESCROW_MAINNET_MINTS: readonly EscrowMint[] = Object.freeze([
  { symbol: 'USDC', mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), tokenProgram: TOKEN_PROGRAM_ID },
  { symbol: 'AUDD', mint: new PublicKey('AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw'), tokenProgram: TOKEN_PROGRAM_ID },
  { symbol: 'PYUSD', mint: new PublicKey('2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'), tokenProgram: TOKEN_2022_PROGRAM_ID },
  { symbol: 'USDG', mint: new PublicKey('2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH'), tokenProgram: TOKEN_2022_PROGRAM_ID },
]);

/** The devnet build's extra mint (devnet USDC). */
export const ESCROW_DEVNET_MINTS: readonly EscrowMint[] = Object.freeze([
  { symbol: 'USDC (devnet)', mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), tokenProgram: TOKEN_PROGRAM_ID },
]);

export interface ReadAccount {
  lamports: number | bigint;
  owner: PublicKey;
  data: Uint8Array;
}
export type AccountLookup = (address: PublicKey) => Promise<ReadAccount | null>;

export interface ReadinessItem {
  name: string;
  address: string;
  ok: boolean;
  detail: string;
}

/**
 * Read-only check that the treasury can receive every payout: enough SOL for a
 * small fee to land, and a token account owned by the treasury for each mint,
 * under the mint's token program. Nothing is sent.
 */
export async function checkTreasuryReadiness(
  lookup: AccountLookup,
  mints: readonly EscrowMint[] = ESCROW_MAINNET_MINTS,
  treasury: PublicKey = ESCROW_PROTOCOL_TREASURY,
): Promise<{ ok: boolean; items: ReadinessItem[] }> {
  const items: ReadinessItem[] = [];
  const sol = await lookup(treasury);
  const lamports = BigInt(sol?.lamports ?? 0);
  items.push({
    name: 'Treasury SOL balance',
    address: treasury.toBase58(),
    ok: lamports >= TREASURY_MIN_LAMPORTS,
    detail: `${lamports} lamports held, at least ${TREASURY_MIN_LAMPORTS} needed`,
  });
  for (const m of mints) {
    const ata = getAssociatedTokenAddressSync(m.mint, treasury, true, m.tokenProgram);
    const account = await lookup(ata);
    let ok = false;
    let detail: string;
    if (!account) {
      detail = 'missing: create the associated token account before the first payout in this mint';
    } else if (!account.owner.equals(m.tokenProgram)) {
      detail = `owned by ${account.owner.toBase58()}, expected ${m.tokenProgram.toBase58()}`;
    } else if (account.data.length < 72) {
      detail = 'not a token account';
    } else {
      const mint = new PublicKey(account.data.subarray(0, 32));
      const owner = new PublicKey(account.data.subarray(32, 64));
      if (!mint.equals(m.mint)) detail = `holds mint ${mint.toBase58()}`;
      else if (!owner.equals(treasury)) detail = `owned by ${owner.toBase58()}, not the treasury`;
      else { ok = true; detail = 'exists'; }
    }
    items.push({ name: `Treasury ${m.symbol} token account`, address: ata.toBase58(), ok, detail });
  }
  return { ok: items.every((i) => i.ok), items };
}

/**
 * What an issuer can change on a Token-2022 mint that would affect escrows in
 * it: the extensions present, the transfer hook program, the transfer fee, the
 * permanent delegate and the freeze, close and pause authorities. Supply and
 * metadata text are left out because they change in normal use.
 */
export interface Token2022MintPosture {
  extensionTypes: number[];
  transferHookProgram: string | null;
  transferFee: { olderBps: number; newerBps: number; newerEpoch: string; newerMaximumFee: string } | null;
  permanentDelegate: string | null;
  freezeAuthority: string | null;
  mintCloseAuthority: string | null;
  pausable: { authority: string | null; paused: boolean } | null;
}

const addressOrNull = (key: PublicKey | null | undefined): string | null => (key && !key.equals(PublicKey.default) ? key.toBase58() : null);

/** Reads the posture from a Token-2022 mint account's raw data. */
export function token2022MintPosture(data: Uint8Array, address: PublicKey = PublicKey.default): Token2022MintPosture {
  const mint = unpackMint(address, { data: Buffer.from(data), owner: TOKEN_2022_PROGRAM_ID, lamports: 0, executable: false }, TOKEN_2022_PROGRAM_ID);
  const fee = getTransferFeeConfig(mint);
  const pausable = getPausableConfig(mint);
  return {
    extensionTypes: getExtensionTypes(mint.tlvData).map(Number).sort((a, b) => a - b),
    transferHookProgram: addressOrNull(getTransferHook(mint)?.programId),
    transferFee: fee
      ? {
          olderBps: fee.olderTransferFee.transferFeeBasisPoints,
          newerBps: fee.newerTransferFee.transferFeeBasisPoints,
          newerEpoch: fee.newerTransferFee.epoch.toString(),
          newerMaximumFee: fee.newerTransferFee.maximumFee.toString(),
        }
      : null,
    permanentDelegate: addressOrNull(getPermanentDelegate(mint)?.delegate),
    freezeAuthority: addressOrNull(mint.freezeAuthority),
    mintCloseAuthority: addressOrNull(getMintCloseAuthority(mint)?.closeAuthority),
    pausable: pausable ? { authority: addressOrNull(pausable.authority), paused: Boolean(pausable.paused) } : null,
  };
}

/** Each field that differs from the recorded posture, as "field: before -> after". Empty when nothing changed. */
export function mintPostureChanges(recorded: Token2022MintPosture, current: Token2022MintPosture): string[] {
  const changes: string[] = [];
  for (const key of Object.keys(recorded) as (keyof Token2022MintPosture)[]) {
    const before = JSON.stringify(recorded[key]);
    const after = JSON.stringify(current[key]);
    if (before !== after) changes.push(`${key}: ${before} -> ${after}`);
  }
  return changes;
}
