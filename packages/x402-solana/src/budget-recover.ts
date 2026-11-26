/**
 * What a payer needs to look after a pooled budget without any app (#1209):
 * read it from the chain, close it, and collect what is owed back, from the
 * budget's address alone; and the message a payer signs to have a relay's
 * signer stop signing for a budget whose agent key leaked.
 *
 * Everything here reads public chain data and builds instructions. Nothing
 * here holds a key or sends a transaction: the caller signs and sends
 * (`./cli` does both for a keypair file the payer names).
 */

import { PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  BUDGET_DISCRIMINATORS,
  RESERVATION_ACCOUNT_LEN,
  closeBudgetInstruction,
  decodeBudget,
  decodeReservation,
  disputeEnds,
  judgeEnds,
  payoutInstruction,
  type BudgetAccount,
  type ReservationAccount,
} from './budget';
import { ESCROW_PROTOCOL_TREASURY } from './token-escrow';

/** The V1 program, at the same address on devnet and mainnet. */
export const BUDGET_PROGRAM_ID = new PublicKey('DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export type BudgetRecoverNetwork = 'solana-devnet' | 'solana-mainnet-beta';

/** Each network's genesis hash, to tell an RPC on the wrong cluster. */
export const BUDGET_GENESIS_HASH: Readonly<Record<BudgetRecoverNetwork, string>> = Object.freeze({
  'solana-devnet': 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  'solana-mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
});

/** How old (or how far ahead) a freeze request may be when the signer gets it, in seconds. */
export const BUDGET_FREEZE_MAX_AGE_SECONDS = 600;
export const BUDGET_FREEZE_MAX_AHEAD_SECONDS = 120;

export interface BudgetFreezeRequest {
  network: BudgetRecoverNetwork;
  /** The budget's address (base58). */
  budget: string;
  /** The payer's wallet (base58): the one that signs. */
  payer: string;
  /** Unix seconds. */
  issuedAt: number;
}

/**
 * The text a payer's wallet signs (Ed25519, as `signMessage` does) to have
 * the relay's signer stop signing for one budget. It can only freeze: a
 * frozen budget gets no further call or reserve approval, and can still be
 * closed. Signing it again later is harmless.
 */
export function budgetFreezeMessage(request: BudgetFreezeRequest): Uint8Array {
  return new TextEncoder().encode(
    [
      'Reddi Agent Protocol: freeze my Budget',
      'The RAP relay must sign nothing more for this Budget, except its close.',
      `network: ${request.network}`,
      `payer: ${request.payer}`,
      `budget: ${request.budget}`,
      `issued at: ${request.issuedAt}`,
    ].join('\n'),
  );
}

/** What the recovery steps read from the chain. */
export interface BudgetRecoverReader {
  readAccount(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  /** Every reservation account of `budget` under the program. */
  reservations(budget: PublicKey): Promise<{ address: PublicKey; data: Uint8Array }[]>;
  slot(): Promise<bigint>;
}

type ConnectionLike = {
  getAccountInfo(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  getProgramAccounts(programId: PublicKey, config: { filters: unknown[] }): Promise<readonly { pubkey: PublicKey; account: { data: Uint8Array } }[]>;
  getSlot(): Promise<number>;
};

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** A reader over a web3.js `Connection` (or anything shaped like one). */
export function budgetRecoverReader(connection: ConnectionLike, programId: PublicKey = BUDGET_PROGRAM_ID): BudgetRecoverReader {
  return {
    async readAccount(address) {
      const info = await connection.getAccountInfo(address);
      return info ? { owner: info.owner, data: Uint8Array.from(info.data) } : null;
    },
    async reservations(budget) {
      const found = await connection.getProgramAccounts(programId, {
        filters: [
          { dataSize: RESERVATION_ACCOUNT_LEN },
          { memcmp: { offset: 0, bytes: base58(Uint8Array.from(BUDGET_DISCRIMINATORS['account:Reservation'])) } },
          { memcmp: { offset: 8, bytes: budget.toBase58() } },
        ],
      });
      return found.map((x) => ({ address: x.pubkey, data: Uint8Array.from(x.account.data) }));
    },
    async slot() {
      return BigInt(await connection.getSlot());
    },
  };
}

/** One provider's slice, and whether anyone can settle it now. */
export interface BudgetSliceStatus {
  address: PublicKey;
  reservation: ReservationAccount;
  /** A payout sent now would be accepted. */
  payable: boolean;
  /** The first slot a payout is accepted, when that is known and not yet reached. */
  payableAtSlot: bigint | null;
  /** In plain words: what a payout does, or what it waits for. */
  note: string;
}

export type BudgetStatus =
  | { found: false; budget: PublicKey; reason: 'no_account' | 'not_a_budget' }
  | {
      found: true;
      budget: PublicKey;
      programId: PublicKey;
      account: BudgetAccount;
      slot: bigint;
      /** The token program of a token budget's mint. Null for SOL. */
      tokenProgram: PublicKey | null;
      slices: BudgetSliceStatus[];
      /** Not closed yet: the payer can close now, anyone can once `account.openEnds` is reached. */
      open: boolean;
      anyoneMayClose: boolean;
    };

function sliceStatus(budget: BudgetAccount, address: PublicKey, reservation: ReservationAccount, slot: bigint): BudgetSliceStatus {
  const at = (payableAtSlot: bigint, note: string, waiting: string): BudgetSliceStatus =>
    slot >= payableAtSlot ? { address, reservation, payable: true, payableAtSlot: null, note } : { address, reservation, payable: false, payableAtSlot, note: waiting };
  if (reservation.state === 'paid') {
    return budget.closed
      ? { address, reservation, payable: true, payableAtSlot: null, note: 'Already paid; a payout only closes its account.' }
      : { address, reservation, payable: false, payableAtSlot: null, note: 'Already paid; its account closes after the budget does.' };
  }
  if (reservation.state === 'posted' && reservation.waived) {
    return { address, reservation, payable: true, payableAtSlot: null, note: 'Waived: pays the provider what it posted and returns the rest of the slice.' };
  }
  if (reservation.state === 'disputed') {
    return at(judgeEnds(budget, reservation)!, 'The judge did not rule in time: the whole slice returns to the payer.', 'Disputed: waiting for the judge, or for the judge window to end.');
  }
  if (!budget.closed) {
    return { address, reservation, payable: false, payableAtSlot: null, note: 'Close the budget first: the dispute window starts at the close.' };
  }
  const posted = reservation.state === 'posted';
  return at(
    disputeEnds(budget, reservation)!,
    posted ? 'The dispute window ended: pays the provider what it posted and returns the rest of the slice.' : 'Nothing was posted: the whole slice returns to the payer.',
    posted ? 'Posted: payable when the dispute window ends (dispute it before then if it is wrong).' : 'Nothing posted yet: returns to the payer when the dispute window ends.',
  );
}

/** Reads a budget and its slices from its address alone. */
export async function readBudgetStatus(reader: BudgetRecoverReader, budget: PublicKey, programId: PublicKey = BUDGET_PROGRAM_ID): Promise<BudgetStatus> {
  const info = await reader.readAccount(budget);
  if (!info) return { found: false, budget, reason: 'no_account' };
  let account: BudgetAccount;
  try {
    if (!info.owner.equals(programId)) throw new Error('not owned by the program');
    account = decodeBudget(info.data);
  } catch {
    return { found: false, budget, reason: 'not_a_budget' };
  }
  let tokenProgram: PublicKey | null = null;
  if (account.mint) {
    const mint = await reader.readAccount(account.mint);
    if (!mint || !(mint.owner.equals(TOKEN_PROGRAM_ID) || mint.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error("the budget's mint is not a token mint on this cluster");
    tokenProgram = mint.owner;
  }
  const slot = await reader.slot();
  const slices: BudgetSliceStatus[] = [];
  for (const found of await reader.reservations(budget)) {
    let reservation: ReservationAccount;
    try {
      reservation = decodeReservation(found.data);
    } catch {
      continue;
    }
    // A slice of an earlier budget at the same address is not this budget's.
    if (!reservation.budget.equals(budget) || reservation.budgetCreatedSlot !== account.createdSlot) continue;
    slices.push(sliceStatus(account, found.address, reservation, slot));
  }
  slices.sort((a, b) => a.address.toBase58().localeCompare(b.address.toBase58()));
  return { found: true, budget, programId, account, slot, tokenProgram, slices, open: !account.closed, anyoneMayClose: !account.closed && slot >= account.openEnds };
}

type Found = Extract<BudgetStatus, { found: true }>;

function payerTokenAccount(status: Found): PublicKey {
  return getAssociatedTokenAddressSync(status.account.mint!, status.account.payer, true, status.tokenProgram!);
}

const memo = (status: Found) => (status.tokenProgram?.equals(TOKEN_2022_PROGRAM_ID) ? { memoProgram: MEMO_PROGRAM_ID } : {});

/**
 * The instructions that close a budget: what was never reserved goes back to
 * the payer at once. `signer` is who signs and pays the fee: the payer at any
 * time, anyone once the open period has ended. For a token budget the
 * payer's associated token account is created first if it is missing.
 */
export function closeBudgetInstructions(status: Found, signer: PublicKey): TransactionInstruction[] {
  if (!status.open) throw new Error('budget_already_closed');
  if (!signer.equals(status.account.payer) && !status.anyoneMayClose) throw new Error('only_the_payer_may_close_before_the_open_period_ends');
  const base = { programId: status.programId, budget: status.budget, createdSlot: status.account.createdSlot, signer, payer: status.account.payer };
  if (!status.account.mint) return [closeBudgetInstruction(base)];
  const refund = payerTokenAccount(status);
  return [
    createAssociatedTokenAccountIdempotentInstruction(signer, refund, status.account.payer, status.account.mint, status.tokenProgram!),
    closeBudgetInstruction({ ...base, token: { mint: status.account.mint, refund, tokenProgram: status.tokenProgram! }, ...memo(status) }),
  ];
}

/**
 * One group of instructions per slice a payout would settle now (anyone may
 * send them; `feePayer` pays the fee and any missing token account). Send
 * each group as its own transaction. The money can only go to the provider's
 * recorded account, the treasury and the payer.
 */
export function payoutBudgetInstructions(status: Found, feePayer: PublicKey, treasury: PublicKey = ESCROW_PROTOCOL_TREASURY): { slice: BudgetSliceStatus; instructions: TransactionInstruction[] }[] {
  return status.slices
    .filter((slice) => slice.payable)
    .map((slice) => {
      const base = { programId: status.programId, budget: status.budget, createdSlot: status.account.createdSlot, payee: slice.reservation.payee, payer: status.account.payer, treasury };
      if (!status.account.mint) return { slice, instructions: [payoutInstruction(base)] };
      const mint = status.account.mint;
      const tokenProgram = status.tokenProgram!;
      const refund = payerTokenAccount(status);
      const treasuryToken = getAssociatedTokenAddressSync(mint, treasury, true, tokenProgram);
      return {
        slice,
        instructions: [
          createAssociatedTokenAccountIdempotentInstruction(feePayer, refund, status.account.payer, mint, tokenProgram),
          payoutInstruction({ ...base, token: { mint, payoutAccount: slice.reservation.payoutAccount, treasuryToken, refund, tokenProgram }, ...memo(status) }),
        ],
      };
    });
}
