/**
 * Server only. The dispute a payer's alert links to: a Solana Pay
 * transaction request that builds `dispute` for one posted slice, for the
 * payer's own wallet to sign. Only the Budget's payer is given one.
 */

import { PublicKey, Transaction } from "@solana/web3.js";
import { decodeBudget, decodeReservation, disputeEnds, disputeInstruction, reservationAddress } from "@redditech/x402-solana/budget";
import type { BudgetChainReader } from "./watch";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type DisputeBuild = { ok: true; transaction: string; message: string } | { ok: false; status: number; code: string; message: string };

export async function buildDisputeTransaction(input: {
  budget: string | null;
  payee: string | null;
  account: unknown;
  programId: PublicKey;
  chain: BudgetChainReader & { latestBlockhash(): Promise<string> };
}): Promise<DisputeBuild> {
  const fail = (status: number, code: string, message: string): DisputeBuild => ({ ok: false, status, code, message });
  if (!input.budget || !BASE58.test(input.budget) || !input.payee || !BASE58.test(input.payee)) return fail(400, "invalid_request", "The link names no Budget or provider.");
  if (typeof input.account !== "string" || !BASE58.test(input.account)) return fail(400, "invalid_request", "Send JSON with the wallet's account.");
  const budgetKey = new PublicKey(input.budget);
  const payee = new PublicKey(input.payee);
  const account = await input.chain.readAccount(budgetKey);
  if (!account || !account.owner.equals(input.programId)) return fail(404, "budget_not_found", "That Budget is not open on chain.");
  const budget = decodeBudget(account.data);
  if (budget.payer.toBase58() !== input.account) return fail(403, "not_the_payer", "Only the wallet that opened this Budget can dispute its slices.");
  if (!budget.judge) return fail(409, "no_judge", "This Budget has no judge, so its slices cannot be disputed.");
  const slice = await input.chain.readAccount(reservationAddress(budgetKey, payee, input.programId));
  if (!slice) return fail(404, "slice_not_found", "That provider has no slice of this Budget.");
  const reservation = decodeReservation(slice.data);
  if (reservation.budgetCreatedSlot !== budget.createdSlot) return fail(404, "slice_not_found", "That provider has no slice of this Budget.");
  if (reservation.state !== "posted") return fail(409, "not_posted", `This slice is ${reservation.state}: only a posted slice can be disputed.`);
  const ends = disputeEnds(budget, reservation);
  if (ends !== null && ends <= (await input.chain.slot())) return fail(409, "window_closed", "The dispute window for this slice has ended.");
  const tx = new Transaction({ feePayer: budget.payer, recentBlockhash: await input.chain.latestBlockhash() });
  tx.add(disputeInstruction({ programId: input.programId, budget: budgetKey, createdSlot: budget.createdSlot, payee, payer: budget.payer }));
  return {
    ok: true,
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    message: `Dispute ${reservation.finalAmount} posted by ${payee.toBase58().slice(0, 4)}…: the judge decides the split`,
  };
}
