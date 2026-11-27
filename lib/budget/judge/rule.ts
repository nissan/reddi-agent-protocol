/**
 * The RAP judge's decision rule, version 1 (owner decision, 26 November
 * 2026: "Evidence rule, you can override").
 *
 * The question the judge answers for a disputed Budget slice: did the
 * provider serve the calls it charged for? Answer quality is not judged in V1.
 *
 * Take the provider's latest valid receipt for the slice (`./receipts`). It
 * counts only if the calls it says were served are no more than the calls the
 * Budget's spender signed for this provider, and the request it answered is
 * one of the bodies the spender signed. Then the provider gets the smaller of
 * what it posted and what the receipt says the slice owes; the payer gets the
 * rest back. With no receipt that counts, the provider gets 0: the same as
 * when nobody rules before the judge's window ends.
 *
 * Pure: same evidence, same ruling, whoever disputed and however often.
 */

import { createHash } from "crypto";
import { readSliceReceipt, type SliceExpectation, type SliceReceipt } from "./receipts";

export const JUDGE_RULE_VERSION = "rap-judge-rule/1";

/** The calls the Budget's spender signed for this provider on this opening of the Budget. */
export type SignedCalls = { count: number; bodyHashes: ReadonlySet<string> };

export type RuleInput = {
  slice: SliceExpectation;
  /** What the provider posted (the slice's `final_amount`), in base units. */
  posted: bigint;
  signedCalls: SignedCalls;
  /** Receipts from every source (relay copies, provider evidence), in any order, any shape. */
  receipts: unknown[];
};

export type Ruling = {
  rule: typeof JUDGE_RULE_VERSION;
  /** To the provider, before the protocol fee. Never more than `posted`. */
  payout: bigint;
  /** `evidence`: a receipt counted. `no_evidence`: none did. */
  basis: "evidence" | "no_evidence";
  /** One line a payer or provider can read. */
  reason: string;
  /** The receipt the ruling rests on, when one counted. */
  receipt?: Pick<SliceReceipt, "kind" | "served" | "cumulativeCost" | "receiptHash">;
  /** Why each other receipt was set aside, at most 20, for the record. */
  setAside: string[];
  /** SHA-256 hex over the rule version, the slice, the posted amount, the call log and the counted receipt: what the ruling's memo names. */
  evidenceHash: string;
};

function evidenceHash(input: RuleInput, counted: SliceReceipt | undefined): string {
  const hashes = [...input.signedCalls.bodyHashes].sort();
  const parts = [
    JUDGE_RULE_VERSION,
    input.slice.network,
    input.slice.budget,
    input.slice.createdSlot,
    input.slice.payee,
    input.posted.toString(),
    String(input.signedCalls.count),
    createHash("sha256").update(hashes.join("\n")).digest("hex"),
    counted ? counted.receiptHash : "-",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/** Decides one disputed slice. */
export function decideRuling(input: RuleInput): Ruling {
  const setAside: string[] = [];
  let best: SliceReceipt | undefined;
  for (const value of input.receipts) {
    const read = readSliceReceipt(value, input.slice);
    if (!read.ok) {
      setAside.push(read.reason);
      continue;
    }
    const r = read.receipt;
    if (r.served > input.signedCalls.count) {
      setAside.push(`served_${r.served}_above_signed_${input.signedCalls.count}`);
      continue;
    }
    if (!input.signedCalls.bodyHashes.has(r.requestHash)) {
      setAside.push("request_not_signed");
      continue;
    }
    // The latest counts: most calls served, then the higher total (a provider's own later statement).
    if (!best || r.served > best.served || (r.served === best.served && r.cumulativeCost > best.cumulativeCost)) best = r;
  }
  const trimmed = setAside.slice(0, 20);
  if (!best) {
    return {
      rule: JUDGE_RULE_VERSION,
      payout: BigInt(0),
      basis: "no_evidence",
      reason: "No receipt from the provider matched calls the Budget signed, so the whole slice goes back to the payer.",
      setAside: trimmed,
      evidenceHash: evidenceHash(input, undefined),
    };
  }
  const payout = best.cumulativeCost < input.posted ? best.cumulativeCost : input.posted;
  const reason =
    payout === input.posted
      ? `The provider's receipts show ${best.served} served call${best.served === 1 ? "" : "s"} costing ${best.cumulativeCost}, at least the ${input.posted} it posted, so the post stands.`
      : `The provider posted ${input.posted} but its receipts show ${best.served} served call${best.served === 1 ? "" : "s"} costing ${best.cumulativeCost}, so it is paid ${payout} and the rest goes back to the payer.`;
  return {
    rule: JUDGE_RULE_VERSION,
    payout,
    basis: "evidence",
    reason,
    receipt: { kind: best.kind, served: best.served, cumulativeCost: best.cumulativeCost, receiptHash: best.receiptHash },
    setAside: trimmed,
    evidenceHash: evidenceHash(input, best),
  };
}
