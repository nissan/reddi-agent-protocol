/**
 * Client safe. Checks a transaction the server built before the person's
 * wallet signs it (audit 2026-11-25, Low): the wallet pays its fee, it calls
 * only the Budget program (plus compute budget settings), and an open locks
 * exactly what the person asked for, for the providers they picked, at the
 * Budget address their own nonce gives. The program id is the devnet
 * profile's, built into the page, not one the server names.
 */

import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { BUDGET_ALLOWLIST_LEN, BUDGET_DISCRIMINATORS, BUDGET_FLAG_SPENDER_WAIVES, budgetAddress } from "@redditech/x402-solana/budget";
import devnetProfile from "@/config/networks/devnet.json";

export const BUDGET_PAGE_PROGRAM_ID = new PublicKey(devnetProfile.programs.escrowProgramId);

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
  if (o.mint && ix.keys[3]?.pubkey.toBase58() !== o.mint) return "it locks another token";
  return undefined;
}
