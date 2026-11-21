import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMemoTransfer,
  getMintCloseAuthority,
  getPausableConfig,
  getPermanentDelegate,
  getTransferFeeConfig,
  getTransferHook,
  unpackAccount,
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
  /** Creates to put before the settle in the same transaction. Empty unless a create was asked for. */
  instructions: TransactionInstruction[];
  /** Where the unused part returns: the account named in the options, or the payer's associated token account. */
  refundTo: PublicKey;
  treasuryToken: PublicKey;
}

export interface TokenPayoutOptions {
  /** Return the unused part to this token account of the payer instead of its associated token account. */
  refundTo?: PublicKey;
  /**
   * Create the treasury's associated token account if it is missing, at the
   * funder's cost. Off by default: readiness is checked before a currency
   * opens, and a settle should not carry the create every time.
   */
  createTreasuryAccount?: boolean;
  /**
   * Create the payer's associated token account if it is missing, at the
   * funder's cost (its rent, about 0.002 SOL, is not returned to the funder).
   * Off by default: this is a subsidy, and the caller decides when to pay it.
   */
  createRefundAccount?: boolean;
}

/**
 * The accounts a token payout names next to the escrow's own: the treasury's
 * associated token account for the mint, and the account the unused part
 * returns to. Nothing is created unless the options ask for it; a create is
 * idempotent, `funder` pays its rent and must sign the transaction.
 */
export function prepareTokenPayout(
  t: Pick<TokenEscrowTerms, 'mint' | 'tokenProgram' | 'payer'>,
  funder: PublicKey,
  treasury: PublicKey = ESCROW_PROTOCOL_TREASURY,
  options: TokenPayoutOptions = {},
): SettlePreparation {
  if (!t.tokenProgram.equals(TOKEN_PROGRAM_ID) && !t.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error('token program must be classic SPL Token or Token-2022');
  }
  const treasuryToken = treasuryTokenAccount(t, treasury);
  const payerToken = getAssociatedTokenAddressSync(t.mint, t.payer, true, t.tokenProgram);
  if (options.createRefundAccount && options.refundTo && !options.refundTo.equals(payerToken)) {
    throw new Error("only the payer's associated token account can be created here");
  }
  const instructions: TransactionInstruction[] = [];
  if (options.createTreasuryAccount) instructions.push(createAssociatedTokenAccountIdempotentInstruction(funder, treasuryToken, treasury, t.mint, t.tokenProgram));
  if (options.createRefundAccount) instructions.push(createAssociatedTokenAccountIdempotentInstruction(funder, payerToken, t.payer, t.mint, t.tokenProgram));
  return { treasuryToken, refundTo: options.refundTo ?? payerToken, instructions };
}

export type TokenAccountProblem = 'missing' | 'wrong_program' | 'not_token_account' | 'uninitialised' | 'frozen' | 'wrong_mint' | 'wrong_owner' | 'memo_required';
export type TokenAccountCheck = { ok: true; amount: bigint } | { ok: false; problem: TokenAccountProblem; detail: string };

/**
 * Whether a token account can receive a transfer of `mint` right now: it
 * exists under the mint's token program, is initialised and not frozen, holds
 * the mint, belongs to `owner` when one is named, and does not require a memo
 * on incoming transfers (the escrow program sends none). Reads the whole
 * account, not only its first fields.
 */
export function checkTokenAccount(
  address: PublicKey,
  account: Pick<ReadAccount, 'owner' | 'data'> | null,
  expected: { mint: PublicKey; tokenProgram: PublicKey; owner?: PublicKey },
): TokenAccountCheck {
  if (!account) return { ok: false, problem: 'missing', detail: 'missing' };
  if (!account.owner.equals(expected.tokenProgram)) {
    return { ok: false, problem: 'wrong_program', detail: `owned by ${account.owner.toBase58()}, expected ${expected.tokenProgram.toBase58()}` };
  }
  let token: ReturnType<typeof unpackAccount>;
  try {
    token = unpackAccount(address, { data: Buffer.from(account.data), owner: account.owner, lamports: 0, executable: false }, expected.tokenProgram);
  } catch {
    return { ok: false, problem: 'not_token_account', detail: 'not a token account' };
  }
  if (!token.isInitialized) return { ok: false, problem: 'uninitialised', detail: 'not initialised' };
  if (!token.mint.equals(expected.mint)) return { ok: false, problem: 'wrong_mint', detail: `holds mint ${token.mint.toBase58()}` };
  if (expected.owner && !token.owner.equals(expected.owner)) return { ok: false, problem: 'wrong_owner', detail: `owned by ${token.owner.toBase58()}` };
  if (token.isFrozen) return { ok: false, problem: 'frozen', detail: 'frozen by the issuer' };
  if (getMemoTransfer(token)?.requireIncomingTransferMemos) return { ok: false, problem: 'memo_required', detail: 'requires a memo on incoming transfers' };
  return { ok: true, amount: token.amount };
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
 * small fee to land, and for each mint a token account under the mint's token
 * program that the treasury owns, initialised, not frozen and not requiring a
 * memo. Nothing is sent.
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
    const check = checkTokenAccount(ata, account, { mint: m.mint, tokenProgram: m.tokenProgram, owner: treasury });
    const ok = check.ok;
    const detail = check.ok
      ? 'exists, initialised and not frozen'
      : check.problem === 'missing'
        ? 'missing: create the associated token account before the first payout in this mint'
        : check.problem === 'wrong_owner'
          ? `${check.detail}, not the treasury`
          : check.detail;
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
