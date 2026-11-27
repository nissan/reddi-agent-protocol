/**
 * Server only, run by the Budget signer. Release on completion for Budgets
 * without a judge (Nissan, 27 November 2026).
 *
 * A Budget opened without a judge cannot be disputed: the program refuses a
 * dispute, so the dispute window holds the provider's pay without protecting
 * the payer. Those Budgets open with flag 0x01 (the spender may waive; the
 * program allows it because they always have an allowlist), and as soon as a
 * provider posts what it is owed the watcher asks the signer to release it:
 *
 * 1. `approveAsSpender` with `{ release: "no_judge" }` checks everything it
 *    checks for an agent's waive (record is what the payer signed, no hold,
 *    no pause, a provider the payer named, the slice posted for exactly
 *    that amount, the use logged and counted) and also that the Budget on
 *    chain has no judge and lets the spender waive, and that the payer's
 *    signed terms say both;
 * 2. the signer fee-pays the waive with the ops key (`BUDGET_OPS_FEE_PAYER`)
 *    and, in the same transaction, the payout (permissionless), so the
 *    provider is paid and the rest of the slice goes back to the payer;
 * 3. if the payout cannot go in (a token account it needs is missing) or
 *    the combined transaction fails, the waive is sent alone: the provider's
 *    kit pays a waived slice out on its next pass.
 *
 * A release pays exactly what the end of the dispute window would (with no
 * judge nothing can change the posted amount but the provider lowering it),
 * so it shortens the wait and nothing else. The program is unchanged.
 */

import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { ESCROW_PROTOCOL_TREASURY, treasuryTokenAccount } from "@redditech/x402-solana";
import { decodeBudget, decodeReservation, payoutInstruction, reservationAddress } from "@redditech/x402-solana/budget";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { approveAsSpender, type CustodyDeps, type CustodyFailure } from "./custody";
import { readOpsFeePayer, type IncidentChain } from "./incident";

export type Released = { ok: true; signature: string; paidOut: boolean; note?: string };

const refuse = (code: string, message: string): CustodyFailure => ({ ok: false, code, message });

/** Whether a Budget on chain is released on completion: no judge, and the spender may waive. */
export function releasesOnCompletion(budget: { judge: PublicKey | null; spenderMayWaive: boolean }): boolean {
  return budget.judge === null && budget.spenderMayWaive;
}

/**
 * Releases the posted slice of `payee` in Budget record `id`. The amount is
 * read on chain here, not taken from the caller.
 */
export async function releaseSlice(
  input: { id: string; payee: string; programId: PublicKey; chain: IncidentChain; env: Record<string, string | undefined> },
  deps: CustodyDeps,
): Promise<Released | CustodyFailure> {
  const feePayer = readOpsFeePayer(input.env);
  if (!feePayer) return refuse("fee_payer_not_configured", "BUDGET_OPS_FEE_PAYER is not set: the signer cannot pay for a release.");
  const record = await deps.store.byId(input.id);
  if (!record || !record.budget || !record.createdSlot) return refuse("unknown_budget_key", "No open Budget record with that id.");
  let payee: PublicKey;
  try {
    payee = new PublicKey(input.payee);
  } catch {
    return refuse("invalid_payee", "The provider is not a Solana address.");
  }
  const budgetKey = new PublicKey(record.budget);
  let budget;
  let slice;
  try {
    const [b, r] = await Promise.all([input.chain.readAccount(budgetKey), input.chain.readAccount(reservationAddress(budgetKey, payee, input.programId))]);
    budget = b && b.owner.equals(input.programId) ? decodeBudget(b.data) : undefined;
    slice = r && r.owner.equals(input.programId) ? decodeReservation(r.data) : undefined;
  } catch {
    return refuse("chain_unavailable", "The signer could not read the Budget; try again.");
  }
  if (!budget || budget.createdSlot.toString() !== record.createdSlot) return refuse("budget_not_open", "This Budget is not on chain.");
  if (!releasesOnCompletion(budget)) return refuse("not_authorized", "This Budget has a judge or does not let the spender waive, so it is not released on completion.");
  if (!slice || slice.budgetCreatedSlot !== budget.createdSlot) return refuse("slice_not_found", "That provider has no slice of this Budget.");
  if (slice.state !== "posted" || slice.waived) return refuse("slice_not_posted", "Only a posted slice that was not released yet can be released.");
  // A post of nothing pays nothing: the slice goes back to the payer when the window ends, as before.
  if (slice.finalAmount === BigInt(0)) return refuse("nothing_posted", "The provider posted nothing, so there is nothing to release.");

  const approved = await approveAsSpender(
    { id: record.id, auth: { release: "no_judge" }, request: { purpose: "waive", payee: payee.toBase58(), amount: slice.finalAmount }, programId: input.programId, caller: "release:no_judge" },
    { ...deps, chain: input.chain },
  );
  if (!approved.ok) return approved;

  let payout: TransactionInstruction | undefined;
  let note: string | undefined;
  try {
    const mint = budget.mint;
    if (!mint) {
      payout = payoutInstruction({ programId: input.programId, budget: budgetKey, createdSlot: budget.createdSlot, payee, payer: budget.payer, treasury: ESCROW_PROTOCOL_TREASURY });
    } else {
      const mintAccount = await input.chain.readAccount(mint);
      if (!mintAccount) throw new Error("mint_not_found");
      const tokenProgram = mintAccount.owner;
      const refund = getAssociatedTokenAddressSync(mint, budget.payer, true, tokenProgram);
      const treasuryToken = treasuryTokenAccount({ mint, tokenProgram });
      const accounts = await Promise.all([slice.payoutAccount, treasuryToken, refund].map((a) => input.chain.readAccount(a)));
      // The signer does not pay rent for anyone's token account: a missing one leaves the payout to the provider's kit.
      if (accounts.every(Boolean)) {
        payout = payoutInstruction({ programId: input.programId, budget: budgetKey, createdSlot: budget.createdSlot, payee, payer: budget.payer, treasury: ESCROW_PROTOCOL_TREASURY, token: { mint, payoutAccount: slice.payoutAccount, treasuryToken, refund, tokenProgram } });
      } else {
        note = "token_account_missing";
      }
    }
  } catch {
    note = "payout_not_built";
  }

  const send = async (instructions: TransactionInstruction[]) => {
    const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: await input.chain.latestBlockhash() });
    tx.add(...instructions);
    tx.sign(feePayer);
    return input.chain.sendAndConfirm(tx);
  };
  if (payout) {
    try {
      return { ok: true, signature: await send([...approved.instructions, payout]), paidOut: true };
    } catch {
      note = "payout_failed";
    }
  }
  try {
    return { ok: true, signature: await send([...approved.instructions]), paidOut: false, ...(note ? { note } : {}) };
  } catch (error) {
    return refuse("send_failed", error instanceof Error ? error.message.slice(0, 200) : "The release could not be sent.");
  }
}
