/**
 * Pooled budget: client side of the thirteen budget instructions of
 * `programs/pinocchio-escrow` (README "Pooled budget").
 * `programs/pinocchio-escrow/interface/vectors.json` is the interface;
 * `tests/budget.test.ts` holds every builder and decoder here to that file
 * byte for byte.
 *
 * Nothing here signs or sends. Browser-safe: no `node:crypto`.
 *
 * A person (the payer) locks one total in one token for an open period and
 * names a spender key that their agent holds instead of a wallet. While the
 * budget is open:
 *
 * - the agent's spender key and a provider together reserve a slice for that
 *   provider (`reserveInstruction`, both sign; the same call with a higher
 *   amount raises it);
 * - calls are metered off chain against the slice, and the provider posts
 *   what it is owed, at most its slice (`postFinalInstruction`; a re-post may
 *   only go down);
 * - the payer (or the spender, when the budget allows it) waives disputes on
 *   a posted slice (`waiveInstruction`) so it can be paid at once, or disputes
 *   it (`disputeInstruction`) for the judge.
 *
 * The payer or the spender closes the budget (`closeBudgetInstruction`), or
 * anyone once the open period has ended; what was never reserved goes back at
 * once. A slice is paid (`payoutInstruction`, by anyone) once waived, once its
 * dispute window ended undisputed (`disputeEnds`), or as a full refund once
 * the judge's window ended without a ruling (`judgeEnds`); the judge splits a
 * disputed one (`resolveInstruction`). The same payout call closes a slice
 * that was paid early, once its budget is closed or gone.
 *
 * Every instruction after the open names the budget by its `createdSlot`
 * (read it with `decodeBudget`) and is refused in the slot it was opened in.
 */
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction, type AccountMeta } from '@solana/web3.js';

/**
 * Anchor-style discriminators: the first 8 bytes of sha256("<kind>:<name>").
 * Fixed here so the module loads in a browser bundle; a test recomputes each.
 */
export const BUDGET_DISCRIMINATORS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'global:open_budget': [187, 44, 51, 199, 222, 25, 238, 87],
  'global:open_token_budget': [63, 156, 226, 194, 14, 151, 157, 93],
  'global:reserve': [92, 99, 244, 209, 28, 65, 213, 157],
  'global:set_payout_account': [242, 33, 233, 54, 165, 178, 249, 17],
  'global:post_final': [253, 253, 111, 45, 129, 92, 136, 65],
  'global:waive': [46, 174, 207, 55, 225, 210, 160, 200],
  'global:dispute': [216, 92, 128, 146, 202, 85, 135, 73],
  'global:close_budget': [205, 29, 212, 191, 194, 200, 168, 24],
  'global:close_token_budget': [169, 17, 44, 254, 33, 103, 4, 164],
  'global:payout_budget': [62, 61, 230, 254, 1, 68, 143, 254],
  'global:payout_token_budget': [157, 133, 28, 120, 154, 49, 32, 252],
  'global:resolve_budget': [121, 133, 16, 16, 247, 84, 16, 86],
  'global:resolve_token_budget': [212, 208, 203, 182, 51, 186, 157, 241],
  'account:Budget': [35, 151, 58, 65, 187, 148, 119, 218],
  'account:Reservation': [188, 235, 0, 111, 208, 253, 247, 212],
});

function disc(name: string): Buffer {
  const bytes = BUDGET_DISCRIMINATORS[name];
  if (!bytes) throw new Error(`unknown discriminator ${name}`);
  return Buffer.from(bytes);
}

/** Open period and dispute window: about an hour to about 7 days. */
export const MIN_BUDGET_WINDOW_SLOTS = 9_000n;
export const MAX_BUDGET_WINDOW_SLOTS = 1_512_000n;
/** The judge's window: about 10 minutes to about 14 days. */
export const MIN_BUDGET_JUDGE_SLOTS = 1_500n;
export const MAX_BUDGET_JUDGE_SLOTS = 3_024_000n;
/** After each post the payer has at least this long to dispute: about an hour. */
export const MIN_REVIEW_SLOTS = 9_000n;
export const MAX_BUDGET_RESERVATIONS = 8;
export const BUDGET_ALLOWLIST_LEN = 4;
/** Budget flag: the spender may waive disputes for the payer (needs an allowlist). */
export const BUDGET_FLAG_SPENDER_WAIVES = 0x01;
/** Budget flag set by a close. */
export const BUDGET_FLAG_CLOSED = 0x02;
/** Budget flag set when someone other than the payer closed a budget without an allowlist: the dispute window then runs from the end of the open period at the earliest. */
export const BUDGET_FLAG_REVIEW_FROM_OPEN_END = 0x04;
/**
 * Budget flag: the spender is a P-256 key (a KMS key, a passkey). Its `spender` field is
 * `p256SpenderAddress(publicKey)`, and the spender approves each call with a signed
 * `budgetApprovalMessage` carried by `secp256r1ApprovalInstruction` just before it,
 * instead of signing the transaction (README "P-256 spender").
 */
export const BUDGET_FLAG_P256_SPENDER = 0x08;
export const BUDGET_ACCOUNT_LEN = 349;
export const RESERVATION_ACCOUNT_LEN = 147;
/** Caps the program applies to one budget, as for one escrow. */
export const MAX_SOL_BUDGET_LAMPORTS = 500_000_000n;
export const MAX_TOKEN_BUDGET_BASE_UNITS = 100_000_000n;

export const RESERVATION_STATES = ['open', 'posted', 'disputed', 'paid'] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

const ZERO = new PublicKey(new Uint8Array(32));

/** The budget of `payer` with this 16-byte nonce: `["budget", payer, nonce]`. */
export function budgetAddress(payer: PublicKey, nonce: Uint8Array, programId: PublicKey): PublicKey {
  if (nonce.length !== 16) throw new Error('nonce must be 16 bytes');
  return PublicKey.findProgramAddressSync([Buffer.from('budget'), payer.toBuffer(), Buffer.from(nonce)], programId)[0];
}

/** A token budget's vault, a token account owned by the budget: `["budget-vault", budget]`. */
export function budgetVaultAddress(budget: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('budget-vault'), budget.toBuffer()], programId)[0];
}

/** A provider's slice of a budget: `["reservation", budget, payee]`. */
export function reservationAddress(budget: PublicKey, payee: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('reservation'), budget.toBuffer(), payee.toBuffer()], programId)[0];
}

/** A registry record, `["agent", owner]` of the same program. */
function agentAddress(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('agent'), owner.toBuffer()], programId)[0];
}

/** The smallest slice of a budget of `total`: 1% of it, at least one base unit. */
export function minReservation(total: bigint): bigint {
  const floor = total / 100n;
  return floor === 0n ? 1n : floor;
}

/** Whether the program would take these windows. */
export function budgetWindowsValid(openSlots: bigint, disputeSlots: bigint, judgeSlots: bigint): boolean {
  return (
    openSlots >= MIN_BUDGET_WINDOW_SLOTS &&
    openSlots <= MAX_BUDGET_WINDOW_SLOTS &&
    disputeSlots >= MIN_BUDGET_WINDOW_SLOTS &&
    disputeSlots <= MAX_BUDGET_WINDOW_SLOTS &&
    judgeSlots >= MIN_BUDGET_JUDGE_SLOTS &&
    judgeSlots <= MAX_BUDGET_JUDGE_SLOTS
  );
}

function u64(value: bigint, what: string): Buffer {
  if (value < 0n || value > 0xffffffffffffffffn) throw new Error(`${what} must be a u64`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable });

/** The token side of a token budget's open. */
export interface BudgetTokenOpen {
  mint: PublicKey;
  /** The payer's token account the total comes from. */
  source: PublicKey;
  tokenProgram: PublicKey;
}

export interface OpenBudgetInput {
  programId: PublicKey;
  payer: PublicKey;
  nonce: Uint8Array;
  spender: PublicKey;
  /** The judge (a registered, active attestation agent), or null for none: then an allowlist is required. */
  judge: PublicKey | null;
  openSlots: bigint;
  disputeSlots: bigint;
  judgeSlots: bigint;
  /** Lamports, or base units of the mint. */
  total: bigint;
  /**
   * Most one provider's slice may reach. Omitted: half the total, so one
   * provider (or a stolen spender key paying one) cannot take it all. 0 means
   * the total.
   */
  perProviderCap?: bigint;
  /** Up to 4 providers; when given, only they may join. */
  allowlist?: PublicKey[];
  /** Let the spender waive disputes (needs an allowlist). */
  spenderMayWaive?: boolean;
  /** `spender` is `p256SpenderAddress` of a P-256 key, which approves instead of signing. */
  p256Spender?: boolean;
  /** Omit for SOL. */
  token?: BudgetTokenOpen;
}

/** Half the total (0, meaning the total, when that rounds to nothing). */
export function defaultPerProviderCap(total: bigint): bigint {
  return total / 2n;
}

/**
 * `open_budget` or, with `token`, `open_token_budget`, by the payer. Checks
 * what the program checks about the terms, so a refused open fails here
 * first.
 */
export function openBudgetInstruction(input: OpenBudgetInput): TransactionInstruction {
  const allowlist = input.allowlist ?? [];
  const cap = input.perProviderCap ?? defaultPerProviderCap(input.total);
  if (allowlist.length > BUDGET_ALLOWLIST_LEN) throw new Error(`at most ${BUDGET_ALLOWLIST_LEN} allowlisted providers`);
  if (!budgetWindowsValid(input.openSlots, input.disputeSlots, input.judgeSlots)) throw new Error('budget windows out of range');
  if (input.total <= 0n) throw new Error('total must be positive');
  if (input.total > (input.token ? MAX_TOKEN_BUDGET_BASE_UNITS : MAX_SOL_BUDGET_LAMPORTS)) throw new Error('total above the per-budget cap');
  if (cap > input.total) throw new Error('perProviderCap above the total');
  if (!input.judge && allowlist.length === 0) throw new Error('a budget needs a judge or an allowlist');
  if (input.spenderMayWaive && allowlist.length === 0) throw new Error('the spender may waive only with an allowlist');
  if (input.judge && (input.judge.equals(input.payer) || input.judge.equals(input.spender))) throw new Error('the judge must not be the payer or the spender');
  const budget = budgetAddress(input.payer, input.nonce, input.programId);
  const entries = [...allowlist, ...Array(BUDGET_ALLOWLIST_LEN - allowlist.length).fill(ZERO)] as PublicKey[];
  const data = Buffer.concat([
    disc(input.token ? 'global:open_token_budget' : 'global:open_budget'),
    Buffer.from(input.nonce),
    input.spender.toBuffer(),
    (input.judge ?? ZERO).toBuffer(),
    u64(input.openSlots, 'openSlots'),
    u64(input.disputeSlots, 'disputeSlots'),
    u64(input.judgeSlots, 'judgeSlots'),
    u64(input.total, 'total'),
    u64(cap, 'perProviderCap'),
    Buffer.from([(input.spenderMayWaive ? BUDGET_FLAG_SPENDER_WAIVES : 0) | (input.p256Spender ? BUDGET_FLAG_P256_SPENDER : 0)]),
    ...entries.map((entry) => entry.toBuffer()),
  ]);
  const judge = input.judge ? [meta(agentAddress(input.judge, input.programId))] : [];
  const keys = input.token
    ? [
        meta(budget, true),
        meta(budgetVaultAddress(budget, input.programId), true),
        meta(input.payer, true, true),
        meta(input.token.mint),
        meta(input.token.source, true),
        meta(input.token.tokenProgram),
        meta(SystemProgram.programId),
        ...judge,
      ]
    : [meta(budget, true), meta(input.payer, true, true), meta(SystemProgram.programId), ...judge];
  return new TransactionInstruction({ programId: input.programId, data, keys });
}

interface OfBudget {
  programId: PublicKey;
  budget: PublicKey;
  /** The budget's `createdSlot`: names this budget instance. */
  createdSlot: bigint;
}

/**
 * `reserve`, signed by the spender and the payee (the payee pays the fee and
 * the reservation's rent). `amount` is the slice's new total: a raise sends
 * the higher total. `payoutAccount` is where the payee is paid: the payee
 * itself for SOL (the default), a token account of the budget's mint it owns
 * for tokens. If the payee still has a reservation paid early in an earlier
 * budget at the same address, put a `payoutInstruction` for it first in the
 * same transaction: it closes that reservation, which otherwise refuses the
 * reserve (6087).
 */
export function reserveInstruction(
  input: OfBudget & { spender: PublicKey | P256Approved; payee: PublicKey; amount: bigint; payoutAccount?: PublicKey },
): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([
      disc('global:reserve'),
      u64(input.createdSlot, 'createdSlot'),
      u64(input.amount, 'amount'),
      ...expiry(input.spender),
    ]),
    keys: [
      meta(input.budget, true),
      meta(reservationAddress(input.budget, input.payee, input.programId), true),
      authority(input.spender),
      meta(input.payee, true, true),
      meta(agentAddress(input.payee, input.programId)),
      meta(input.payoutAccount ?? input.payee),
      meta(SystemProgram.programId),
    ],
  });
}

/** `set_payout_account`, by the payee, while its slice is open or posted. */
export function setPayoutAccountInstruction(input: OfBudget & { payee: PublicKey; payoutAccount: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:set_payout_account'), u64(input.createdSlot, 'createdSlot')]),
    keys: [
      meta(input.budget),
      meta(reservationAddress(input.budget, input.payee, input.programId), true),
      meta(input.payee, false, true),
      meta(input.payoutAccount),
    ],
  });
}

/** `post_final`, by the payee: what it is owed, at most its slice; a re-post may only go down. */
export function postFinalInstruction(input: OfBudget & { payee: PublicKey; amount: bigint }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:post_final'), u64(input.createdSlot, 'createdSlot'), u64(input.amount, 'amount')]),
    keys: [meta(input.budget), meta(reservationAddress(input.budget, input.payee, input.programId), true), meta(input.payee, false, true)],
  });
}

function hold(name: string, input: OfBudget & { payee: PublicKey; signer: PublicKey | P256Approved }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc(name), u64(input.createdSlot, 'createdSlot'), ...expiry(input.signer)]),
    keys: [meta(input.budget), meta(reservationAddress(input.budget, input.payee, input.programId), true), authority(input.signer)],
  });
}

/**
 * `waive`, by the payer (or the spender on a budget that allows it), on a posted slice: it can be paid at once.
 * A P-256 spender passes `{ p256ExpiresSlot }` as `signer`.
 */
export function waiveInstruction(input: OfBudget & { payee: PublicKey; signer: PublicKey | P256Approved }): TransactionInstruction {
  return hold('global:waive', input);
}

/** `dispute`, by the payer, on a posted slice of a budget with a judge, before `disputeEnds`. */
export function disputeInstruction(input: OfBudget & { payee: PublicKey; payer: PublicKey }): TransactionInstruction {
  return hold('global:dispute', { ...input, signer: input.payer });
}

/** The token side of a token budget's close. */
export interface BudgetTokenClose {
  mint: PublicKey;
  /** A token account the payer owns. */
  refund: PublicKey;
  tokenProgram: PublicKey;
}

/**
 * `close_budget` or, with `token`, `close_token_budget`: by the payer or the
 * spender any time, by anyone after the open period. Pass `memoProgram` (the
 * SPL Memo program) when the refund account requires incoming memos. A P-256
 * spender passes `{ p256ExpiresSlot }` as `signer`.
 */
export function closeBudgetInstruction(
  input: OfBudget & { signer: PublicKey | P256Approved; payer: PublicKey; token?: BudgetTokenClose; memoProgram?: PublicKey },
): TransactionInstruction {
  const created = Buffer.concat([u64(input.createdSlot, 'createdSlot'), ...expiry(input.signer)]);
  if (!input.token) {
    return new TransactionInstruction({
      programId: input.programId,
      data: Buffer.concat([disc('global:close_budget'), created]),
      keys: [meta(input.budget, true), authority(input.signer), meta(input.payer, true)],
    });
  }
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:close_token_budget'), created]),
    keys: [
      meta(input.budget, true),
      meta(budgetVaultAddress(input.budget, input.programId), true),
      authority(input.signer),
      meta(input.payer, true),
      meta(input.token.mint),
      meta(input.token.refund, true),
      meta(input.token.tokenProgram),
      ...(input.memoProgram ? [meta(input.memoProgram)] : []),
    ],
  });
}

/** The token side of a token budget's payout or resolve. */
export interface BudgetTokenPayout {
  mint: PublicKey;
  /**
   * The payout account recorded on the reservation, or the payee's
   * associated token account for the mint (accepted when the recorded one was
   * closed or frozen). Not read when the payee is paid nothing.
   */
  payoutAccount: PublicKey;
  /** The protocol treasury's token account for the mint. */
  treasuryToken: PublicKey;
  /** A token account the payer owns. */
  refund: PublicKey;
  tokenProgram: PublicKey;
}

export interface PayoutInput extends OfBudget {
  payee: PublicKey;
  payer: PublicKey;
  /** The protocol treasury (SOL). */
  treasury: PublicKey;
  token?: BudgetTokenPayout;
  memoProgram?: PublicKey;
}

function exitKeys(input: PayoutInput, judge?: PublicKey): AccountMeta[] {
  const reservation = reservationAddress(input.budget, input.payee, input.programId);
  const tail = [...(judge ? [meta(judge, false, true)] : []), ...(input.memoProgram ? [meta(input.memoProgram)] : [])];
  if (!input.token) {
    return [meta(input.budget, true), meta(reservation, true), meta(input.payee, true), meta(input.payer, true), meta(input.treasury, true), ...tail];
  }
  return [
    meta(input.budget, true),
    meta(budgetVaultAddress(input.budget, input.programId), true),
    meta(reservation, true),
    meta(input.payee, true),
    meta(input.payer, true),
    meta(input.token.mint),
    meta(input.token.payoutAccount, true),
    meta(input.token.treasuryToken, true),
    meta(input.token.refund, true),
    meta(input.token.tokenProgram),
    ...tail,
  ];
}

/**
 * `payout_budget` or, with `token`, `payout_token_budget`, by anyone: pays a
 * waived slice, one whose dispute window ended, or refunds one whose judge
 * did not rule in time; closes a slice paid early once its budget is closed
 * or gone. `treasury` is unused for a token budget but kept so one input
 * shape serves both.
 */
export function payoutInstruction(input: PayoutInput): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc(input.token ? 'global:payout_token_budget' : 'global:payout_budget'), u64(input.createdSlot, 'createdSlot')]),
    keys: exitKeys(input),
  });
}

/** `resolve_budget` or `resolve_token_budget`, by the judge: `payout` (at most the posted amount) to the payee before the fee. */
export function resolveInstruction(input: PayoutInput & { judge: PublicKey; payout: bigint }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([
      disc(input.token ? 'global:resolve_token_budget' : 'global:resolve_budget'),
      u64(input.createdSlot, 'createdSlot'),
      u64(input.payout, 'payout'),
    ]),
    keys: exitKeys(input, input.judge),
  });
}

export interface BudgetAccount {
  payer: PublicKey;
  spender: PublicKey;
  /** Null when the budget has no judge. */
  judge: PublicKey | null;
  /** Null for a SOL budget. */
  mint: PublicKey | null;
  nonce: Uint8Array;
  createdSlot: bigint;
  openSlots: bigint;
  disputeSlots: bigint;
  judgeSlots: bigint;
  total: bigint;
  unreserved: bigint;
  perProviderCap: bigint;
  /** The non-empty allowlist entries. */
  allowlist: PublicKey[];
  /** 0 until closed. */
  closedSlot: bigint;
  reservations: number;
  unsettled: number;
  spenderMayWaive: boolean;
  closed: boolean;
  /** Closed by someone other than the payer, without an allowlist: the dispute window runs from `openEnds` at the earliest. */
  reviewFromOpenEnd: boolean;
  /** The spender is a P-256 key that approves instead of signing (flag 0x08). */
  p256Spender: boolean;
  /** The first slot at which reservations are refused and anyone may close. */
  openEnds: bigint;
}

/** Reads a budget account. Throws for bytes that are not one. */
export function decodeBudget(accountData: Uint8Array): BudgetAccount {
  const data = Buffer.from(accountData);
  if (data.length < BUDGET_ACCOUNT_LEN || !data.subarray(0, 8).equals(disc('account:Budget'))) throw new Error('invalid budget account');
  const key = (at: number) => new PublicKey(data.subarray(at, at + 32));
  const optional = (at: number) => (key(at).equals(ZERO) ? null : key(at));
  const allowlist: PublicKey[] = [];
  for (let i = 0; i < BUDGET_ALLOWLIST_LEN; i++) {
    const entry = key(208 + 32 * i);
    if (!entry.equals(ZERO)) allowlist.push(entry);
  }
  const createdSlot = data.readBigUInt64LE(152);
  const openSlots = data.readBigUInt64LE(160);
  return {
    payer: key(8),
    spender: key(40),
    judge: optional(72),
    mint: optional(104),
    nonce: Uint8Array.from(data.subarray(136, 152)),
    createdSlot,
    openSlots,
    disputeSlots: data.readBigUInt64LE(168),
    judgeSlots: data.readBigUInt64LE(176),
    total: data.readBigUInt64LE(184),
    unreserved: data.readBigUInt64LE(192),
    perProviderCap: data.readBigUInt64LE(200),
    allowlist,
    closedSlot: data.readBigUInt64LE(336),
    reservations: data[344],
    unsettled: data[345],
    spenderMayWaive: (data[346] & BUDGET_FLAG_SPENDER_WAIVES) !== 0,
    closed: (data[346] & BUDGET_FLAG_CLOSED) !== 0,
    reviewFromOpenEnd: (data[346] & BUDGET_FLAG_REVIEW_FROM_OPEN_END) !== 0,
    p256Spender: (data[346] & BUDGET_FLAG_P256_SPENDER) !== 0,
    openEnds: createdSlot + openSlots,
  };
}

export interface ReservationAccount {
  budget: PublicKey;
  /** The `createdSlot` of the budget instance it belongs to. */
  budgetCreatedSlot: bigint;
  payee: PublicKey;
  payoutAccount: PublicKey;
  reserved: bigint;
  finalAmount: bigint;
  postedSlot: bigint;
  disputedSlot: bigint;
  state: ReservationState;
  waived: boolean;
}

/** Reads a reservation account. Throws for bytes that are not one. */
export function decodeReservation(accountData: Uint8Array): ReservationAccount {
  const data = Buffer.from(accountData);
  if (data.length < RESERVATION_ACCOUNT_LEN || !data.subarray(0, 8).equals(disc('account:Reservation'))) throw new Error('invalid reservation account');
  const state = RESERVATION_STATES[data[144]];
  if (state === undefined) throw new Error('invalid reservation state');
  return {
    budget: new PublicKey(data.subarray(8, 40)),
    budgetCreatedSlot: data.readBigUInt64LE(40),
    payee: new PublicKey(data.subarray(48, 80)),
    payoutAccount: new PublicKey(data.subarray(80, 112)),
    reserved: data.readBigUInt64LE(112),
    finalAmount: data.readBigUInt64LE(120),
    postedSlot: data.readBigUInt64LE(128),
    disputedSlot: data.readBigUInt64LE(136),
    state,
    waived: data[145] !== 0,
  };
}

/**
 * The first slot at which the payer can no longer dispute `reservation`, and
 * at which an undisputed one may be paid: the budget's dispute window from
 * its close (from the end of the open period at the earliest when the
 * spender closed a budget without an allowlist), never earlier than `MIN_REVIEW_SLOTS` after the first
 * post. Null while the budget is open (the window has not started).
 */
export function disputeEnds(budget: BudgetAccount, reservation: ReservationAccount): bigint | null {
  if (!budget.closed) return null;
  const from = budget.reviewFromOpenEnd && budget.openEnds > budget.closedSlot ? budget.openEnds : budget.closedSlot;
  const window = from + budget.disputeSlots;
  const review = reservation.postedSlot + MIN_REVIEW_SLOTS;
  return review > window ? review : window;
}

/** The first slot at which a disputed reservation refunds in full without the judge. Null unless disputed. */
export function judgeEnds(budget: BudgetAccount, reservation: ReservationAccount): bigint | null {
  if (reservation.state !== 'disputed') return null;
  return reservation.disputedSlot + budget.judgeSlots;
}

// ── P-256 spender approvals (flag 0x08) ─────────────────────────────────────

/** The secp256r1 signature verification precompile. */
export const SECP256R1_PROGRAM_ID = new PublicKey('Secp256r1SigVerify1111111111111111111111111');
/** First bytes of every approval, with its version. */
export const BUDGET_APPROVAL_DOMAIN = 'RAP-BUDGET-SPENDER-V1';
export const BUDGET_APPROVAL_LEN = 175;
/** What an approval allows. */
export const BUDGET_APPROVAL_ACTIONS = { reserve: 1, waive: 2, close: 3 } as const;
export type BudgetApprovalAction = keyof typeof BUDGET_APPROVAL_ACTIONS;
/** The cluster byte: a mainnet build of the program takes 0, a devnet build 1. */
export type BudgetApprovalCluster = 'mainnet' | 'devnet';

/**
 * A P-256 spender's side of a call: in place of the spender (reserve) or signer (waive, close) key,
 * the call then takes the Instructions sysvar and carries `p256ExpiresSlot`, the last slot its
 * approval may be used in. Send it right after `secp256r1ApprovalInstruction` for the same approval.
 */
export interface P256Approved {
  p256ExpiresSlot: bigint;
}

function isP256(authority: PublicKey | P256Approved): authority is P256Approved {
  // Structural, not instanceof: a caller may hold a PublicKey from another copy of web3.js.
  return typeof authority === 'object' && authority !== null && 'p256ExpiresSlot' in authority;
}

function authority(who: PublicKey | P256Approved): AccountMeta {
  return isP256(who) ? meta(SYSVAR_INSTRUCTIONS_PUBKEY) : meta(who, false, true);
}

function expiry(who: PublicKey | P256Approved): Buffer[] {
  return isP256(who) ? [u64(who.p256ExpiresSlot, 'p256ExpiresSlot')] : [];
}

/** The 33-byte compressed form of a P-256 public key (accepts 33-byte compressed or 65-byte uncompressed). */
export function compressP256PublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length === 33 && (publicKey[0] === 2 || publicKey[0] === 3)) return Uint8Array.from(publicKey);
  if (publicKey.length === 65 && publicKey[0] === 4) {
    const out = new Uint8Array(33);
    out[0] = (publicKey[64] & 1) === 0 ? 2 : 3;
    out.set(publicKey.subarray(1, 33), 1);
    return out;
  }
  throw new Error('a P-256 public key is 33 bytes compressed or 65 bytes uncompressed');
}

/** What a budget stores as a P-256 spender: sha256 of the 33-byte compressed key. Uses WebCrypto. */
export async function p256SpenderAddress(publicKey: Uint8Array): Promise<PublicKey> {
  const compressed = compressP256PublicKey(publicKey);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(compressed));
  return new PublicKey(new Uint8Array(digest));
}

export interface BudgetApproval extends OfBudget {
  action: BudgetApprovalAction;
  /** reserve: the payee; waive: the payee whose reservation is waived; close: none. */
  payee?: PublicKey;
  /** reserve: the payout account (the payee itself for SOL, the default). */
  payoutAccount?: PublicKey;
  /** reserve: the slice's new total. */
  amount?: bigint;
  expiresSlot: bigint;
  cluster: BudgetApprovalCluster;
}

/** The exact 175 bytes a P-256 spender signs (ES256) for one call; the program rebuilds and compares them. */
export function budgetApprovalMessage(approval: BudgetApproval): Buffer {
  let target = ZERO;
  let payout = ZERO;
  let amount = 0n;
  if (approval.action === 'reserve') {
    if (!approval.payee || approval.amount === undefined) throw new Error('a reserve approval names the payee and amount');
    target = approval.payee;
    payout = approval.payoutAccount ?? approval.payee;
    amount = approval.amount;
  } else if (approval.action === 'waive') {
    if (!approval.payee) throw new Error('a waive approval names the payee');
    target = reservationAddress(approval.budget, approval.payee, approval.programId);
  }
  const message = Buffer.concat([
    Buffer.from(BUDGET_APPROVAL_DOMAIN, 'ascii'),
    Buffer.from([approval.cluster === 'devnet' ? 1 : 0]),
    approval.programId.toBuffer(),
    approval.budget.toBuffer(),
    u64(approval.createdSlot, 'createdSlot'),
    Buffer.from([BUDGET_APPROVAL_ACTIONS[approval.action]]),
    target.toBuffer(),
    payout.toBuffer(),
    u64(amount, 'amount'),
    u64(approval.expiresSlot, 'expiresSlot'),
  ]);
  if (message.length !== BUDGET_APPROVAL_LEN) throw new Error('approval message length');
  return message;
}

const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function bigFrom(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

/**
 * An ECDSA P-256 signature as the precompile takes it: 64 bytes r || s with a low s.
 * Accepts raw r || s (JWS / WebCrypto) or DER (most KMS APIs).
 */
export function compactLowSP256Signature(signature: Uint8Array): Uint8Array {
  let r: bigint;
  let s: bigint;
  if (signature.length === 64) {
    r = bigFrom(signature.subarray(0, 32));
    s = bigFrom(signature.subarray(32));
  } else {
    // DER: 0x30 len 0x02 rlen r 0x02 slen s
    const der = signature;
    if (der[0] !== 0x30 || der[1] !== der.length - 2 || der[2] !== 0x02) throw new Error('not an ECDSA signature');
    const rLen = der[3];
    if (der[4 + rLen] !== 0x02) throw new Error('not an ECDSA signature');
    const sLen = der[5 + rLen];
    if (6 + rLen + sLen !== der.length) throw new Error('not an ECDSA signature');
    r = bigFrom(der.subarray(4, 4 + rLen));
    s = bigFrom(der.subarray(6 + rLen, 6 + rLen + sLen));
  }
  if (r <= 0n || r >= P256_ORDER || s <= 0n || s >= P256_ORDER) throw new Error('signature out of range');
  if (s > P256_ORDER / 2n) s = P256_ORDER - s;
  const out = new Uint8Array(64);
  out.set(bytes32(r), 0);
  out.set(bytes32(s), 32);
  return out;
}

/**
 * The secp256r1 precompile instruction carrying one approval: one signature, with the key, signature
 * and message all in this instruction (indexes u16::MAX), as the program requires. Put it right before
 * the call it approves.
 */
export function secp256r1ApprovalInstruction(input: {
  publicKey: Uint8Array;
  signature: Uint8Array;
  message: Uint8Array;
}): TransactionInstruction {
  const key = compressP256PublicKey(input.publicKey);
  const signature = compactLowSP256Signature(input.signature);
  const keyAt = 16;
  const signatureAt = keyAt + 33;
  const messageAt = signatureAt + 64;
  if (input.message.length > 0xffff - messageAt) throw new Error('message too long');
  const header = Buffer.alloc(16);
  header[0] = 1;
  const fields = [signatureAt, 0xffff, keyAt, 0xffff, messageAt, input.message.length, 0xffff];
  fields.forEach((value, i) => header.writeUInt16LE(value, 2 + 2 * i));
  return new TransactionInstruction({
    programId: SECP256R1_PROGRAM_ID,
    keys: [],
    data: Buffer.concat([header, Buffer.from(key), Buffer.from(signature), Buffer.from(input.message)]),
  });
}
