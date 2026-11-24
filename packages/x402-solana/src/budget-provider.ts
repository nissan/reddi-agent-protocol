/**
 * Pooled budget, provider side: what a provider checks before it joins a
 * budget and before it serves a call paid from one (see `./budget` for the
 * accounts and instructions).
 *
 * The flow, for a provider:
 *
 * 1. A call with no payment is answered 402 with a `PooledBudgetOffer`: the
 *    provider's mint, its price, the slice it wants reserved and the judges
 *    it accepts.
 * 2. The agent's spender key builds `reserve` for that slice, signs it as the
 *    second signer and sends the transaction in `x402-budget-reserve`. The
 *    provider reads the budget, checks it (`checkPooledBudgetForProvider`),
 *    checks the transaction is exactly that reserve and nothing else
 *    (`checkReserveTransaction`), then signs it as payee and fee payer and
 *    sends it. It pays the fee and the slice's rent, which come back when the
 *    slice closes.
 * 3. Every call names the budget instance and a call number in `x402-budget`
 *    and carries the spender's signature over the request in
 *    `x402-budget-signature` (`verifyPooledBudgetRequest`). The spender is a
 *    key the agent holds, so it signs each call itself: no session key.
 * 4. Calls are metered against the slice off chain. The provider posts what
 *    it is owed once, when the budget closes or the calls stop, and is paid
 *    after the dispute window (`disputeEnds`) or at once when the payer
 *    waives.
 *
 * V1 rule: a provider joins only a budget locked in the token it prices in.
 * Nothing here swaps.
 *
 * Nothing here signs for the provider or sends. Verification uses Node's
 * crypto through `./ed25519`.
 */
import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { decodeBase64, ed25519Verify } from './ed25519';
import { sessionBodyHash, type Signer } from './session-auth';
import { MAX_BUDGET_RESERVATIONS, minReservation, reservationAddress, reserveInstruction, type BudgetAccount } from './budget';

export const BUDGET_PAYMENT_HEADER = 'x402-budget';
export const BUDGET_SIGNATURE_HEADER = 'x402-budget-signature';
export const BUDGET_RESERVE_HEADER = 'x402-budget-reserve';

/** What a provider asks for in its 402 when it takes budgets. Amounts are base-unit strings. */
export interface PooledBudgetOffer {
  scheme: 'budget';
  /** The cluster's genesis hash. */
  network: string;
  programId: string;
  /** The provider's wallet: the payee and fee payer of `reserve`. */
  payee: string;
  /** Where the provider is paid: its wallet for SOL, its token account of `mint` for a token. */
  payoutAccount: string;
  /** Null for SOL. A budget in any other token cannot pay this provider. */
  mint: string | null;
  /** The slice the provider wants for a first reserve, and the least it takes. */
  reservation: string;
  minReservation: string;
  /** Judges the provider accepts on a budget. Empty: it takes only budgets with no judge. */
  acceptedJudges: string[];
  /** Slots the budget must still have open for the provider to join. */
  minOpenSlotsLeft: string;
}

export type PooledBudgetRefusal =
  | 'budget_currency_not_accepted'
  | 'budget_closed'
  | 'budget_closing'
  | 'budget_instance_mismatch'
  | 'budget_judge_not_accepted'
  | 'budget_not_allowlisted'
  | 'budget_cap_too_small'
  | 'budget_funds_too_low'
  | 'budget_full';

export type PooledBudgetCheck = { ok: true } | { ok: false; reason: PooledBudgetRefusal; message: string };

/**
 * Whether this provider may join `budget` with a slice of `slice` base units
 * now. Pure: the caller reads the budget at `confirmed` or better and the
 * current slot.
 */
export function checkPooledBudgetForProvider(input: {
  budget: BudgetAccount;
  /** The `createdSlot` the buyer named; the budget read must be that instance. */
  createdSlot: bigint;
  payee: PublicKey;
  /** The provider's mint, or null when it is paid in SOL. */
  mint: PublicKey | null;
  acceptedJudges: PublicKey[];
  /** The new total the slice would have (a raise names the higher total). */
  slice: bigint;
  /** What the slice holds now: 0 before the first reserve. */
  reservedNow?: bigint;
  /** Whether the provider already holds a slice here (a raise does not take a new slot). */
  hasReservation?: boolean;
  currentSlot: bigint;
  minOpenSlotsLeft: bigint;
}): PooledBudgetCheck {
  const b = input.budget;
  const refuse = (reason: PooledBudgetRefusal, message: string): PooledBudgetCheck => ({ ok: false, reason, message });
  if (b.createdSlot !== input.createdSlot) return refuse('budget_instance_mismatch', 'That budget was closed and opened again since the call was made. Name the budget as it is now.');
  const mintMatches = b.mint === null ? input.mint === null : input.mint !== null && b.mint.equals(input.mint);
  if (!mintMatches) return refuse('budget_currency_not_accepted', 'This budget is locked in a token this provider is not paid in. It cannot pay this provider.');
  if (b.closed) return refuse('budget_closed', 'This budget is closed and takes no new reservations.');
  if (input.currentSlot + input.minOpenSlotsLeft >= b.openEnds) return refuse('budget_closing', 'This budget closes too soon for this provider to join it.');
  if (b.judge !== null && !input.acceptedJudges.some((j) => j.equals(b.judge!))) return refuse('budget_judge_not_accepted', 'This provider does not accept the judge this budget names.');
  if (b.allowlist.length > 0 && !b.allowlist.some((p) => p.equals(input.payee))) return refuse('budget_not_allowlisted', 'This budget is limited to other providers.');
  const cap = b.perProviderCap === 0n ? b.total : b.perProviderCap;
  if (input.slice > cap) return refuse('budget_cap_too_small', 'This budget caps each provider below the slice this provider needs.');
  if (input.slice < minReservation(b.total)) return refuse('budget_cap_too_small', 'The slice is below the least this budget reserves.');
  const delta = input.slice - (input.reservedNow ?? 0n);
  if (delta > b.unreserved) return refuse('budget_funds_too_low', 'This budget has too little left unreserved for the slice.');
  if (!input.hasReservation && b.reservations >= MAX_BUDGET_RESERVATIONS) return refuse('budget_full', 'This budget already has as many providers as it can hold.');
  return { ok: true };
}

/** Highest compute-unit limit a reserve may ask the provider to pay for (a reserve measures about 24,000 units). */
export const MAX_RESERVE_COMPUTE_UNITS = 60_000;
/** Default highest compute-unit price, in micro-lamports, a provider pays on a reserve it co-signs. */
export const DEFAULT_MAX_RESERVE_MICRO_LAMPORTS_PER_CU = 10_000n;
/** Signature fee per signature, in lamports. */
const LAMPORTS_PER_SIGNATURE = 5_000n;
/** Compute units the runtime grants each non-compute-budget instruction when no limit is set. */
const DEFAULT_UNITS_PER_INSTRUCTION = 200_000n;

export type ReserveTransactionCheck =
  | { ok: true; amount: bigint; transaction: Transaction; /** The most this transaction can cost the provider in fees, in lamports. */ maxFeeLamports: bigint }
  | { ok: false; reason: 'invalid_reserve'; message: string };

/**
 * Checks a reserve the spender signed before the provider signs it: the fee
 * payer is the provider, its only instructions are compute-budget ones and
 * one `reserve` that is exactly the one this provider would build for this
 * budget, payee and payout account, with an amount from `minAmount` to
 * `maxAmount`, and the spender's signature over it is valid. Compute-budget
 * instructions are limited to at most one `SetComputeUnitLimit` (at most
 * `MAX_RESERVE_COMPUTE_UNITS`) and at most one `SetComputeUnitPrice` (at most
 * `maxMicroLamportsPerComputeUnit`), so the provider, as fee payer, cannot be
 * charged more than `maxFeeLamports`. A provider that signs only what passes
 * here pays fees and rent for nothing else.
 */
export function checkReserveTransaction(input: {
  transactionBase64: string;
  programId: PublicKey;
  budget: PublicKey;
  createdSlot: bigint;
  spender: PublicKey;
  payee: PublicKey;
  payoutAccount: PublicKey;
  minAmount: bigint;
  maxAmount: bigint;
  /** Highest compute-unit price the provider will pay; default `DEFAULT_MAX_RESERVE_MICRO_LAMPORTS_PER_CU`. */
  maxMicroLamportsPerComputeUnit?: bigint;
}): ReserveTransactionCheck {
  const refuse = (message: string): ReserveTransactionCheck => ({ ok: false, reason: 'invalid_reserve', message });
  const bytes = decodeBase64(input.transactionBase64);
  if (!bytes) return refuse('The reserve is not base64.');
  let tx: Transaction;
  try {
    tx = Transaction.from(bytes);
  } catch {
    return refuse('The reserve is not a legacy transaction.');
  }
  if (!tx.feePayer?.equals(input.payee)) return refuse('The reserve must name this provider as fee payer.');
  const reserves = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  if (reserves.length !== 1) return refuse('The reserve must hold one reserve instruction and nothing else.');
  const maxPrice = input.maxMicroLamportsPerComputeUnit ?? DEFAULT_MAX_RESERVE_MICRO_LAMPORTS_PER_CU;
  let unitLimit: bigint | null = null;
  let unitPrice: bigint | null = null;
  for (const budgetIx of tx.instructions.filter((i) => i.programId.equals(ComputeBudgetProgram.programId))) {
    const data = Buffer.from(budgetIx.data);
    if (budgetIx.keys.length !== 0) return refuse('A compute-budget instruction in the reserve names accounts.');
    if (data[0] === 2 && data.length === 5 && unitLimit === null) {
      unitLimit = BigInt(data.readUInt32LE(1));
      if (unitLimit > BigInt(MAX_RESERVE_COMPUTE_UNITS)) return refuse('The reserve asks for more compute than a reserve needs.');
    } else if (data[0] === 3 && data.length === 9 && unitPrice === null) {
      unitPrice = data.readBigUInt64LE(1);
      if (unitPrice > maxPrice) return refuse('The reserve sets a compute-unit price above what this provider pays.');
    } else {
      return refuse('The reserve may hold at most one compute-unit limit and one compute-unit price, and no other compute-budget instruction.');
    }
  }
  const units = unitLimit ?? DEFAULT_UNITS_PER_INSTRUCTION;
  const priorityLamports = ((unitPrice ?? 0n) * units + 999_999n) / 1_000_000n;
  const ix = reserves[0];
  if (ix.data.length !== 24) return refuse('That instruction is not a reserve.');
  const amount = ix.data.readBigUInt64LE(16);
  const expected = reserveInstruction({ programId: input.programId, budget: input.budget, createdSlot: input.createdSlot, spender: input.spender, payee: input.payee, amount, payoutAccount: input.payoutAccount });
  if (!sameInstruction(ix, expected)) return refuse('That reserve is not for this budget, provider and payout account.');
  if (amount < input.minAmount || amount > input.maxAmount) return refuse('The reserve amount is outside what this provider offered.');
  const signers = tx.signatures.map((s) => s.publicKey.toBase58()).sort();
  const wanted = [input.payee.toBase58(), input.spender.toBase58()].sort();
  if (signers.length !== 2 || signers[0] !== wanted[0] || signers[1] !== wanted[1]) return refuse('The reserve must be signed by the spender and this provider only.');
  const spenderSig = tx.signatures.find((s) => s.publicKey.equals(input.spender))?.signature;
  if (!spenderSig || !ed25519Verify(input.spender, tx.serializeMessage(), spenderSig)) return refuse('The spender has not signed this reserve.');
  return { ok: true, amount, transaction: tx, maxFeeLamports: LAMPORTS_PER_SIGNATURE * 2n + priorityLamports };
}

function sameInstruction(a: TransactionInstruction, b: TransactionInstruction): boolean {
  return a.programId.equals(b.programId) && Buffer.from(a.data).equals(Buffer.from(b.data)) && a.keys.length === b.keys.length
    && a.keys.every((k, i) => k.pubkey.equals(b.keys[i].pubkey) && k.isSigner === b.keys[i].isSigner && k.isWritable === b.keys[i].isWritable);
}

/** The buyer side of step 2: a reserve signed by the spender, for the provider to check, sign and send. */
export async function spenderSignedReserve(input: {
  offer: PooledBudgetOffer;
  budget: PublicKey;
  createdSlot: bigint;
  spender: PublicKey;
  amount: bigint;
  recentBlockhash: string;
  signWithSpender: Signer;
}): Promise<string> {
  const payee = new PublicKey(input.offer.payee);
  const tx = new Transaction({ feePayer: payee, recentBlockhash: input.recentBlockhash });
  tx.add(reserveInstruction({ programId: new PublicKey(input.offer.programId), budget: input.budget, createdSlot: input.createdSlot, spender: input.spender, payee, amount: input.amount, payoutAccount: new PublicKey(input.offer.payoutAccount) }));
  const signature = await input.signWithSpender(tx.serializeMessage());
  tx.addSignature(input.spender, Buffer.from(signature));
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

export type BudgetAction = 'call' | 'close' | 'read';

/** What `x402-budget` carries: the budget instance and this provider's call number in it. */
export interface BudgetPaymentHeader {
  budget: string;
  createdSlot: string;
  sequence: number;
}

/**
 * The message the spender signs for one call: the cluster, the action, the
 * budget instance, this provider, the call number and the SHA-256 of the
 * body. Naming the provider stops a call signed for one provider being
 * replayed to another; the call number stops a replay to the same one.
 */
export function budgetRequestMessage(input: { genesisHash: string; action: BudgetAction; budget: string; createdSlot: bigint; provider: string; sequence: number; bodyHash: string }): string {
  return `reddi-budget/1 ${input.genesisHash} ${input.action} ${input.budget}@${input.createdSlot} ${input.provider} ${input.sequence} ${input.bodyHash}`;
}

/** The two headers a buyer sends with a budget-paid call. */
export async function budgetRequestHeaders(input: { genesisHash: string; action: BudgetAction; budget: PublicKey; createdSlot: bigint; provider: PublicKey; sequence: number; body?: Uint8Array | string }, signWithSpender: Signer): Promise<Record<string, string>> {
  const header: BudgetPaymentHeader = { budget: input.budget.toBase58(), createdSlot: input.createdSlot.toString(), sequence: input.sequence };
  const message = budgetRequestMessage({ genesisHash: input.genesisHash, action: input.action, budget: header.budget, createdSlot: input.createdSlot, provider: input.provider.toBase58(), sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
  const signature = await signWithSpender(new TextEncoder().encode(message));
  return { [BUDGET_PAYMENT_HEADER]: Buffer.from(JSON.stringify(header)).toString('base64'), [BUDGET_SIGNATURE_HEADER]: Buffer.from(signature).toString('base64') };
}

/** Reads `x402-budget`. Undefined when it is absent; an error when it is malformed. */
export function readBudgetPaymentHeader(value: string | undefined): { budget: PublicKey; createdSlot: bigint; sequence: number } | { error: string } | undefined {
  if (value === undefined) return undefined;
  try {
    const raw = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Partial<BudgetPaymentHeader>;
    if (typeof raw.budget !== 'string' || typeof raw.createdSlot !== 'string' || !/^\d{1,20}$/.test(raw.createdSlot)) return { error: 'x402-budget must name a budget and its createdSlot.' };
    if (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0) return { error: 'x402-budget must carry a call number.' };
    return { budget: new PublicKey(raw.budget), createdSlot: BigInt(raw.createdSlot), sequence: raw.sequence as number };
  } catch {
    return { error: 'x402-budget is not base64 JSON.' };
  }
}

/** Checks the spender's signature over one call. `spender` comes from the budget account read on chain, never from the request. */
export function verifyPooledBudgetRequest(input: { genesisHash: string; action: BudgetAction; budget: PublicKey; createdSlot: bigint; provider: PublicKey; sequence: number; body?: Uint8Array | string; spender: PublicKey; signatureHeader: string | undefined }): { ok: true } | { ok: false; reason: 'budget_signature_invalid'; message: string } {
  const signature = input.signatureHeader === undefined ? undefined : decodeBase64(input.signatureHeader);
  if (!signature || signature.length !== 64) return { ok: false, reason: 'budget_signature_invalid', message: 'A budget call needs the spender signature in x402-budget-signature.' };
  const message = budgetRequestMessage({ genesisHash: input.genesisHash, action: input.action, budget: input.budget.toBase58(), createdSlot: input.createdSlot, provider: input.provider.toBase58(), sequence: input.sequence, bodyHash: sessionBodyHash(input.body) });
  if (!ed25519Verify(input.spender, new TextEncoder().encode(message), signature)) return { ok: false, reason: 'budget_signature_invalid', message: 'The spender signature does not match this call.' };
  return { ok: true };
}

/** The reservation this provider holds in a budget. */
export function providerReservation(budget: PublicKey, payee: PublicKey, programId: PublicKey): PublicKey {
  return reservationAddress(budget, payee, programId);
}
