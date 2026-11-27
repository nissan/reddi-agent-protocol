/**
 * Client safe. Checks a transaction the server built before the person's
 * wallet signs it (audit 2026-11-25, Low): the wallet pays its fee, it calls
 * only the Budget program (plus compute budget settings), and an open locks
 * exactly what the person asked for, for the providers they picked, at the
 * Budget address their own nonce gives. The program id and the USDC mint
 * are the build network's (`./network`), built into the page, not ones the
 * server names.
 *
 * It does not compare the per-provider cap, the slot windows or the spender:
 * activation reads the opened Budget and refuses it (`terms_mismatch`) unless
 * those match what the payer signed, and an unactivated Budget gets no relay
 * approval (the payer closes it at expiry).
 *
 * An action on an open Budget (approve, dispute, close, payout) is checked
 * exactly (audit 1079ce8 S2-claude-08, S7-claude-08): the page rebuilds the
 * one instruction the button means, for this Budget, this provider's slice
 * and this wallet, and the server's transaction must hold that instruction,
 * byte for byte and account for account, and nothing else but compute budget
 * settings. A waive sent for a dispute, another provider's slice, or another
 * instruction of the same program that lists the Budget is refused.
 */

import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  BUDGET_ALLOWLIST_LEN,
  BUDGET_DISCRIMINATORS,
  BUDGET_FLAG_SPENDER_WAIVES,
  budgetAddress,
  closeBudgetInstruction,
  disputeInstruction,
  payoutInstruction,
  waiveInstruction,
} from "@redditech/x402-solana/budget";
import { ESCROW_PROTOCOL_TREASURY } from "@redditech/x402-solana/token-escrow";
import { BUDGET_USDC_MINT, budgetNetwork, budgetProgramIdFor } from "./network";

const NETWORK = budgetNetwork();
export const BUDGET_PAGE_PROGRAM_ID = budgetProgramIdFor(NETWORK);

export type ExpectedOpen = {
  /** The nonce from the prepared terms (32 hex characters). */
  nonce: string;
  total: bigint;
  /** null for SOL. */
  mint: string | null;
  allowlist: string[];
  /** The judge the page showed, or null for none. */
  judge: string | null;
};

const ZERO = new PublicKey(new Uint8Array(32)).toBase58();

/** The most priority fee the page lets a Budget transaction ask the wallet for: 0.001 SOL. */
export const MAX_PRIORITY_FEE_LAMPORTS = BigInt(1_000_000);

/** Why the compute budget settings are not acceptable, or undefined: a unit limit and a unit price only, at a bounded priority fee. */
function computeBudgetProblem(tx: Transaction): string | undefined {
  let limit = BigInt(200_000);
  let price = BigInt(0);
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(ComputeBudgetProgram.programId)) continue;
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length === 5) limit = BigInt(data.readUInt32LE(1));
    else if (data[0] === 3 && data.length === 9) price = data.readBigUInt64LE(1);
    else return "it changes fee settings the page does not use";
  }
  if ((limit * price) / BigInt(1_000_000) > MAX_PRIORITY_FEE_LAMPORTS) return "it asks for a priority fee above 0.001 SOL";
  return undefined;
}

/** Undefined when the transaction is what the page expects, else why it is not. */
export function checkBudgetTransaction(
  transaction: string,
  expect: { wallet: string; budget: string; open?: ExpectedOpen; programId?: PublicKey },
): string | undefined {
  const programId = expect.programId ?? BUDGET_PAGE_PROGRAM_ID;
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(transaction, "base64"));
  } catch {
    return "the transaction could not be read";
  }
  if (tx.feePayer?.toBase58() !== expect.wallet) return "it is not paid for by your wallet";
  const fees = computeBudgetProblem(tx);
  if (fees) return fees;
  const calls = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  if (calls.length !== 1 || !calls[0].programId.equals(programId)) return "it calls something other than the Budget program";
  const ix = calls[0];
  if (!ix.keys.some((k) => k.pubkey.toBase58() === expect.budget)) return "it is for another Budget";
  if (!expect.open) return undefined;

  const o = expect.open;
  if (!/^[0-9a-f]{32}$/.test(o.nonce)) return "the Budget's terms are incomplete";
  const address = budgetAddress(new PublicKey(expect.wallet), Buffer.from(o.nonce, "hex"), programId).toBase58();
  if (address !== expect.budget || ix.keys[0]?.pubkey.toBase58() !== address) return "it opens another Budget";
  const data = Buffer.from(ix.data);
  const disc = BUDGET_DISCRIMINATORS[o.mint ? "global:open_token_budget" : "global:open_budget"];
  if (data.length !== 129 + 32 * BUDGET_ALLOWLIST_LEN || !disc.every((b, i) => data[i] === b)) return "it is not a Budget open";
  if (data.subarray(8, 24).toString("hex") !== o.nonce) return "it opens another Budget";
  if (data.readBigUInt64LE(112) !== o.total) return "it locks a different amount";
  if ((data[128] & BUDGET_FLAG_SPENDER_WAIVES) !== 0) return "it lets the agent approve what providers post";
  if (new PublicKey(data.subarray(56, 88)).toBase58() !== (o.judge ?? ZERO)) return "it names a judge the page did not show";
  const allowlist: string[] = [];
  for (let i = 0; i < BUDGET_ALLOWLIST_LEN; i++) {
    const entry = new PublicKey(data.subarray(129 + 32 * i, 161 + 32 * i)).toBase58();
    if (entry !== ZERO) allowlist.push(entry);
  }
  const wanted = [...o.allowlist].sort();
  if (allowlist.length !== wanted.length || [...allowlist].sort().some((a, i) => a !== wanted[i])) return "it names other providers";
  const payerIndex = o.mint ? 2 : 1;
  if (ix.keys[payerIndex]?.pubkey.toBase58() !== expect.wallet) return "it takes the money from another wallet";
  if (o.mint && o.mint !== BUDGET_USDC_MINT[NETWORK].toBase58()) return "it locks a token this page does not know";
  if (o.mint && ix.keys[3]?.pubkey.toBase58() !== o.mint) return "it locks another token";
  return undefined;
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const ata = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

/** What the page knows of the Budget an action is for, from its own view of it. */
export type ExpectedAction = {
  action: "approve" | "dispute" | "close" | "payout";
  budget: string;
  /** The Budget's `created_slot`: every exit names its opening. */
  createdSlot: string;
  payer: string;
  /** null for SOL. */
  mint: string | null;
  /** The provider whose slice it is; not for close. */
  payee?: string;
  /** The slice's recorded payout account, for a token payout. */
  payoutAccount?: string;
};

/** The one instruction the page expects for an action, built the way the server builds it (`buildBudgetAction`). */
export function expectedActionInstruction(expect: ExpectedAction, programId: PublicKey = BUDGET_PAGE_PROGRAM_ID): TransactionInstruction {
  const budget = new PublicKey(expect.budget);
  const payer = new PublicKey(expect.payer);
  const ofBudget = { programId, budget, createdSlot: BigInt(expect.createdSlot) };
  const mint = expect.mint ? new PublicKey(expect.mint) : null;
  if (expect.action === "close") {
    return closeBudgetInstruction({ ...ofBudget, signer: payer, payer, ...(mint ? { token: { mint, refund: ata(payer, mint), tokenProgram: TOKEN_PROGRAM } } : {}) });
  }
  if (!expect.payee) throw new Error("payee required");
  const payee = new PublicKey(expect.payee);
  if (expect.action === "approve") return waiveInstruction({ ...ofBudget, payee, signer: payer });
  if (expect.action === "dispute") return disputeInstruction({ ...ofBudget, payee, payer });
  if (mint && !expect.payoutAccount) throw new Error("payout account required");
  return payoutInstruction({
    ...ofBudget,
    payee,
    payer,
    treasury: ESCROW_PROTOCOL_TREASURY,
    ...(mint
      ? { token: { mint, payoutAccount: new PublicKey(expect.payoutAccount!), treasuryToken: ata(ESCROW_PROTOCOL_TREASURY, mint), refund: ata(payer, mint), tokenProgram: TOKEN_PROGRAM } }
      : {}),
  });
}

/**
 * The same program, data and accounts in order, with the flags a message
 * gives them: a message keeps one entry per account, so an account listed
 * twice (the payer as signer and as refund) carries both flags, and the fee
 * payer is always a writable signer.
 */
function sameInstruction(actual: TransactionInstruction, wanted: TransactionInstruction, feePayer: PublicKey): boolean {
  if (!actual.programId.equals(wanted.programId) || !Buffer.from(actual.data).equals(Buffer.from(wanted.data)) || actual.keys.length !== wanted.keys.length) return false;
  const flags = new Map<string, { signer: boolean; writable: boolean }>([[feePayer.toBase58(), { signer: true, writable: true }]]);
  for (const k of wanted.keys) {
    const f = flags.get(k.pubkey.toBase58()) ?? { signer: false, writable: false };
    flags.set(k.pubkey.toBase58(), { signer: f.signer || k.isSigner, writable: f.writable || k.isWritable });
  }
  return actual.keys.every((k, i) => {
    const f = flags.get(wanted.keys[i].pubkey.toBase58())!;
    return k.pubkey.equals(wanted.keys[i].pubkey) && k.isSigner === f.signer && k.isWritable === f.writable;
  });
}

/** Undefined when the transaction is exactly the action the page asked for, else why it is not. */
export function checkBudgetAction(transaction: string, expect: ExpectedAction & { wallet: string; programId?: PublicKey }): string | undefined {
  const programId = expect.programId ?? BUDGET_PAGE_PROGRAM_ID;
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(transaction, "base64"));
  } catch {
    return "the transaction could not be read";
  }
  if (tx.feePayer?.toBase58() !== expect.wallet) return "it is not paid for by your wallet";
  const fees = computeBudgetProblem(tx);
  if (fees) return fees;
  const calls = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  if (calls.length !== 1 || !calls[0].programId.equals(programId)) return "it calls something other than the Budget program";
  let wanted: TransactionInstruction;
  try {
    wanted = expectedActionInstruction(expect, programId);
  } catch {
    return "the page does not know enough about this Budget to check it";
  }
  if (!sameInstruction(calls[0], wanted, tx.feePayer!)) return `it is not the ${expect.action === "approve" ? "approval" : expect.action} you asked for`;
  return undefined;
}
