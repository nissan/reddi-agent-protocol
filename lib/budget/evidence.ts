import "server-only";

/**
 * What the payer sees beside each posted share before deciding to dispute it (#1157): how many
 * calls their Budget signed to that provider, and what the provider's latest receipt says it
 * served and costs. When the Budget's judge is the RAP judge, it also says what that judge would
 * pay if the share were disputed now, by the same rule (`decideRuling`, rap-judge-rule/1).
 *
 * Counts and totals only: no request hashes or receipt bodies leave the server.
 */

import { PublicKey } from "@solana/web3.js";
import { reservationAddress } from "@redditech/x402-solana/budget";
import { decideRuling } from "@/lib/budget/judge/rule";
import type { JudgeNetwork } from "@/lib/budget/judge/receipts";
import type { JudgeStore } from "@/lib/budget/judge/store";
import type { BudgetView } from "@/lib/budget/page";

/** The newest receipts read for one share. The latest statement is among them. */
export const EVIDENCE_RECEIPTS_PER_SLICE = 50;

export type SliceEvidence = {
  /** Calls the Budget's spender signed to this provider on this opening of the Budget. */
  signedCalls: number;
  /** The provider's latest receipt that matches a signed call, or null when none does. */
  receipt: { served: number; cost: string } | null;
  /** What the RAP judge would pay the provider if this share were disputed now. Only for a Budget the RAP judge rules on. */
  judgeWouldPay?: string;
};

export type EvidenceDeps = {
  store: Pick<JudgeStore, "signedCalls" | "receipts">;
  programId: PublicKey;
  network: JudgeNetwork;
  /** The RAP judge's address, when one is set. */
  rapJudge: string | null;
};

/** Evidence for each posted or disputed share of `view`, by payee. A share whose evidence cannot be read is left out. */
export async function budgetEvidence(view: BudgetView, deps: EvidenceDeps): Promise<Record<string, SliceEvidence>> {
  const out: Record<string, SliceEvidence> = {};
  const ruledByRap = deps.rapJudge !== null && view.judge === deps.rapJudge;
  await Promise.all(
    view.slices
      .filter((s) => s.state === "posted" || s.state === "disputed")
      .map(async (s) => {
        const slice = { budget: view.address, createdSlot: view.createdSlot, payee: s.payee };
        try {
          const [signedCalls, receipts] = await Promise.all([deps.store.signedCalls(slice), deps.store.receipts(slice, EVIDENCE_RECEIPTS_PER_SLICE)]);
          const reservation = reservationAddress(new PublicKey(view.address), new PublicKey(s.payee), deps.programId).toBase58();
          const ruling = decideRuling({
            slice: { network: deps.network, budget: view.address, createdSlot: view.createdSlot, reservation, payee: s.payee, payer: view.payer },
            posted: BigInt(s.posted),
            signedCalls,
            receipts,
          });
          out[s.payee] = {
            signedCalls: signedCalls.count,
            receipt: ruling.receipt ? { served: ruling.receipt.served, cost: ruling.receipt.cumulativeCost.toString() } : null,
            ...(ruledByRap ? { judgeWouldPay: ruling.payout.toString() } : {}),
          };
        } catch {
          // Unreadable evidence is not shown; the share and its actions still are.
        }
      }),
  );
  return out;
}
