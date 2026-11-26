/**
 * Server only. The RAP judge's pass: find every disputed Budget slice that
 * names this judge, weigh the evidence (`./rule`) and sign one `resolve` per
 * slice with the judge's key (`./kms`). And Nissan's override: hold a slice, or
 * rule it by hand with a payout and a reason.
 *
 * Timing, against the Budget's judge window (72 hours on the Budget page),
 * counted in slots from the dispute:
 *
 * - The pass sees a dispute within one run (every 10 minutes from GitHub
 *   Actions), records it and tells the operator.
 * - A slice whose evidence already supports the whole post is ruled at once.
 *   Otherwise the judge waits for evidence until a third of the window has
 *   passed (24 hours), then rules on what it has.
 * - It rules nothing automatically after two thirds of the window (48 hours):
 *   a slice still open then is reported to the operator on every pass.
 * - When the window ends, the program refunds the payer in full without a
 *   ruling, and the judge leaves the slice alone.
 *
 * A held slice is never ruled automatically. Fails closed: a slice whose log
 * cannot be read is treated as held, evidence that cannot be read waits for
 * the next pass, and a signature that does not match the judge's address
 * is never sent.
 */

import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ESCROW_PROTOCOL_TREASURY, treasuryTokenAccount } from "@redditech/x402-solana";
import { decodeBudget, decodeReservation, judgeEnds, reservationAddress, resolveInstruction, type BudgetAccount, type ReservationAccount } from "@redditech/x402-solana/budget";
import type { JudgeChain } from "./chain";
import { signAsJudge, type JudgeSigner } from "./kms";
import type { JudgeNetwork } from "./receipts";
import { decideRuling, JUDGE_RULE_VERSION, type Ruling } from "./rule";
import { heldBy, type JudgeLogRow, type JudgeStore, type SliceKey } from "./store";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
/** The most receipts weighed for one slice. */
export const RECEIPTS_READ = 200;
/** The most disputed slices one pass looks at; the rest wait for the next pass. */
export const SLICES_PER_PASS = 50;
/** The operator is reminded about one slice at most this often. */
export const REMIND_EVERY_MS = 6 * 60 * 60 * 1000;
/** Below this many lamports the judge cannot pay for its rulings: the operator is told. */
export const LOW_BALANCE_LAMPORTS = 10_000_000;

export type JudgeDeps = {
  chain: JudgeChain;
  store: JudgeStore;
  signer: JudgeSigner;
  programId: PublicKey;
  network: JudgeNetwork;
  env: Record<string, string | undefined>;
  /** Tells the operator (hello@ by email). Resolves false when nothing took it. */
  notify(subject: string, text: string): Promise<boolean>;
  nowMs?: () => number;
};

export type SliceOutcome = SliceKey & { status: string; payout?: string; signature?: string; error?: string };

export type JudgeWindows = {
  disputedSlot: bigint;
  /** Until this slot, a ruling short of the post waits for more evidence. */
  evidenceEnds: bigint;
  /** From this slot, nothing is ruled automatically. */
  autoEnds: bigint;
  /** From this slot, the program refunds without the judge. */
  judgeEnds: bigint;
};

export function judgeWindows(budget: BudgetAccount, reservation: ReservationAccount): JudgeWindows {
  const ends = judgeEnds(budget, reservation) ?? reservation.disputedSlot + budget.judgeSlots;
  return {
    disputedSlot: reservation.disputedSlot,
    evidenceEnds: reservation.disputedSlot + budget.judgeSlots / BigInt(3),
    autoEnds: reservation.disputedSlot + (budget.judgeSlots * BigInt(2)) / BigInt(3),
    judgeEnds: ends,
  };
}

function sliceOf(budget: PublicKey, reservation: ReservationAccount): SliceKey {
  return { budget: budget.toBase58(), createdSlot: reservation.budgetCreatedSlot.toString(), payee: reservation.payee.toBase58() };
}

type Found = { budgetKey: PublicKey; budget: BudgetAccount; reservation: ReservationAccount };

/** Reads one slice from the chain and checks it is disputed, current, and names this judge. */
async function readDisputed(budgetKey: PublicKey, payee: PublicKey, deps: JudgeDeps): Promise<Found | string> {
  const slice = await deps.chain.readAccount(reservationAddress(budgetKey, payee, deps.programId));
  if (!slice || !slice.owner.equals(deps.programId)) return "slice_not_found";
  let reservation: ReservationAccount;
  try {
    reservation = decodeReservation(slice.data);
  } catch {
    return "slice_unreadable";
  }
  if (!reservation.budget.equals(budgetKey) || !reservation.payee.equals(payee)) return "slice_not_found";
  const account = await deps.chain.readAccount(budgetKey);
  if (!account || !account.owner.equals(deps.programId)) return "budget_not_found";
  let budget: BudgetAccount;
  try {
    budget = decodeBudget(account.data);
  } catch {
    return "budget_unreadable";
  }
  if (budget.createdSlot !== reservation.budgetCreatedSlot) return "slice_of_another_opening";
  if (!budget.judge || !budget.judge.equals(deps.signer.address)) return "not_this_judge";
  if (reservation.state !== "disputed") return `slice_${reservation.state}`;
  return { budgetKey, budget, reservation };
}

/** The resolve transaction for `payout`, with a memo naming the rule and the evidence. Signed by the judge's key; never sent unsigned. */
export async function buildRuling(found: Found, payout: bigint, memo: string, deps: JudgeDeps): Promise<{ ok: true; tx: Transaction } | { ok: false; error: string }> {
  const { budgetKey, budget, reservation } = found;
  const judge = deps.signer.address;
  const instructions: TransactionInstruction[] = [];
  let token: Parameters<typeof resolveInstruction>[0]["token"];
  if (budget.mint) {
    const mintAccount = await deps.chain.readAccount(budget.mint);
    if (!mintAccount) return { ok: false, error: "mint_not_found" };
    const tokenProgram = mintAccount.owner;
    const refund = getAssociatedTokenAddressSync(budget.mint, budget.payer, true, tokenProgram);
    // The payer's own token account takes the refund; the judge pays its rent if it is missing.
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(judge, refund, budget.payer, budget.mint, tokenProgram));
    token = { mint: budget.mint, payoutAccount: reservation.payoutAccount, treasuryToken: treasuryTokenAccount({ mint: budget.mint, tokenProgram }), refund, tokenProgram };
  }
  instructions.push(
    resolveInstruction({
      programId: deps.programId,
      budget: budgetKey,
      createdSlot: budget.createdSlot,
      payee: reservation.payee,
      payer: budget.payer,
      treasury: ESCROW_PROTOCOL_TREASURY,
      ...(token ? { token } : {}),
      judge,
      payout,
    }),
  );
  instructions.push(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: judge, isSigner: true, isWritable: false }], data: Buffer.from(memo.slice(0, 200), "utf8") }));
  let tx: Transaction;
  try {
    tx = new Transaction({ feePayer: judge, recentBlockhash: await deps.chain.latestBlockhash() });
  } catch {
    return { ok: false, error: "chain_unavailable" };
  }
  tx.add(...instructions);
  const signed = await signAsJudge(deps.signer, tx.serializeMessage());
  if (!signed.ok) return { ok: false, error: signed.code };
  tx.addSignature(judge, Buffer.from(signed.signature));
  if (!tx.verifySignatures()) return { ok: false, error: "kms_key_mismatch" };
  return { ok: true, tx };
}

async function sendRuling(found: Found, ruling: { payout: bigint; memo: string }, deps: JudgeDeps): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const built = await buildRuling(found, ruling.payout, ruling.memo, deps);
  if (!built.ok) return built;
  try {
    return { ok: true, signature: await deps.chain.sendAndConfirm(built.tx) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "send_failed" };
  }
}

function units(budget: BudgetAccount): string {
  return budget.mint ? `base units of ${budget.mint.toBase58()}` : "lamports";
}

/** Has the operator been told about this slice, for this reason, within `REMIND_EVERY_MS`? */
function toldRecently(rows: JudgeLogRow[], reason: string, nowMs: number): boolean {
  return rows.some((r) => r.kind === "alert" && r.reason === reason && nowMs - Date.parse(r.at) < REMIND_EVERY_MS);
}

async function tell(deps: JudgeDeps, slice: SliceKey, rows: JudgeLogRow[], reason: string, subject: string, text: string): Promise<void> {
  const now = (deps.nowMs ?? Date.now)();
  if (toldRecently(rows, reason, now)) return;
  const told = await deps.notify(subject, text);
  await deps.store.append({ ...slice, kind: "alert", reason, detail: { told } });
}

/** Judges one disputed slice found on chain. */
async function judgeSlice(found: Found, slot: bigint, deps: JudgeDeps): Promise<SliceOutcome> {
  const { budgetKey, budget, reservation } = found;
  const slice = sliceOf(budgetKey, reservation);
  const w = judgeWindows(budget, reservation);
  const where = `Budget ${slice.budget}, provider ${slice.payee}: posted ${reservation.finalAmount} ${units(budget)}, disputed at slot ${w.disputedSlot}; the judge's window ends at slot ${w.judgeEnds}.`;
  if (slot >= w.judgeEnds) return { ...slice, status: "window_over" };

  let rows: JudgeLogRow[];
  try {
    rows = await deps.store.log(slice);
  } catch {
    await deps.notify("RAP judge cannot read a dispute's log", `${where}\nThe slice's log could not be read, so it is treated as held. Check the database.`).catch(() => false);
    return { ...slice, status: "log_unreadable" };
  }
  if (!rows.some((r) => r.kind === "seen")) {
    await deps.store.append({ ...slice, kind: "seen", reason: "", detail: { disputedSlot: w.disputedSlot.toString(), posted: reservation.finalAmount.toString() } });
    await deps.notify("RAP judge: a Budget slice was disputed", `${where}\nThe judge rules it by the evidence rule unless you hold it.`).catch(() => false);
  }

  const held = heldBy(rows, slice, deps.env);
  if (held !== undefined) {
    if (slot >= w.autoEnds) await tell(deps, slice, rows, "held_past_auto", "RAP judge: a held dispute needs your ruling", `${where}\nYou hold it (${held}). Rule it by hand before the window ends, or the payer is refunded in full.`);
    return { ...slice, status: "held" };
  }
  if (slot >= w.autoEnds) {
    await tell(deps, slice, rows, "past_auto", "RAP judge: a dispute is past the automatic window", `${where}\nThe judge did not rule it in time automatically. Rule it by hand, or the payer is refunded in full when the window ends.`);
    return { ...slice, status: "past_auto" };
  }

  let ruling: Ruling;
  try {
    const [signedCalls, receipts] = await Promise.all([deps.store.signedCalls(slice), deps.store.receipts(slice, RECEIPTS_READ)]);
    ruling = decideRuling({ slice: { network: deps.network, ...slice, reservation: reservationAddress(budgetKey, reservation.payee, deps.programId).toBase58(), payer: budget.payer.toBase58() }, posted: reservation.finalAmount, signedCalls, receipts });
  } catch {
    return { ...slice, status: "evidence_unreadable" };
  }
  // A ruling short of the post waits for the provider's evidence until the evidence window ends.
  if (ruling.payout < reservation.finalAmount && slot < w.evidenceEnds) return { ...slice, status: "waiting_for_evidence", payout: ruling.payout.toString() };

  const sent = await sendRuling(found, { payout: ruling.payout, memo: `rap-judge ${JUDGE_RULE_VERSION} ${ruling.evidenceHash}` }, deps);
  if (!sent.ok) {
    await tell(deps, slice, rows, `send_failed:${sent.error}`, "RAP judge could not send a ruling", `${where}\nThe ruling (${ruling.payout} to the provider) failed: ${sent.error}. It is tried again on every pass.`);
    return { ...slice, status: "send_failed", error: sent.error };
  }
  await deps.store.append({
    ...slice,
    kind: "ruling",
    reason: ruling.reason,
    detail: { by: "rule", rule: ruling.rule, basis: ruling.basis, posted: reservation.finalAmount.toString(), payout: ruling.payout.toString(), evidenceHash: ruling.evidenceHash, receipt: ruling.receipt ? { ...ruling.receipt, cumulativeCost: ruling.receipt.cumulativeCost.toString() } : null, setAside: ruling.setAside, signature: sent.signature },
  });
  await deps.notify("RAP judge ruled a dispute", `${where}\nPaid to the provider: ${ruling.payout} (before the protocol fee). ${ruling.reason}\nTransaction: ${sent.signature}`).catch(() => false);
  return { ...slice, status: "ruled", payout: ruling.payout.toString(), signature: sent.signature };
}

/** One pass over every disputed slice on chain. */
export async function runJudgePass(deps: JudgeDeps): Promise<{ ok: boolean; slot: string; disputed: number; slices: SliceOutcome[]; balanceLamports?: number }> {
  let slot: bigint;
  let disputed: { address: PublicKey; data: Uint8Array }[];
  try {
    [slot, disputed] = await Promise.all([deps.chain.slot(), deps.chain.disputedReservations()]);
  } catch {
    return { ok: false, slot: "0", disputed: 0, slices: [] };
  }
  const slices: SliceOutcome[] = [];
  for (const account of disputed.slice(0, SLICES_PER_PASS)) {
    let reservation: ReservationAccount;
    try {
      reservation = decodeReservation(account.data);
    } catch {
      continue;
    }
    try {
      const found = await readDisputed(reservation.budget, reservation.payee, deps);
      if (typeof found === "string") {
        if (found !== "not_this_judge") slices.push({ ...sliceOf(reservation.budget, reservation), status: found });
        continue;
      }
      slices.push(await judgeSlice(found, slot, deps));
    } catch (error) {
      slices.push({ ...sliceOf(reservation.budget, reservation), status: "failed", error: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
    }
  }
  let balanceLamports: number | undefined;
  try {
    balanceLamports = await deps.chain.balance(deps.signer.address);
    if (balanceLamports < LOW_BALANCE_LAMPORTS && slices.some((s) => s.status !== "held")) {
      await deps.notify("RAP judge is low on SOL", `The judge ${deps.signer.address.toBase58()} holds ${balanceLamports} lamports. Send it SOL so it can pay for its rulings.`).catch(() => false);
    }
  } catch {
    balanceLamports = undefined;
  }
  const ok = !slices.some((s) => ["failed", "send_failed", "log_unreadable", "evidence_unreadable"].includes(s.status));
  return { ok, slot: slot.toString(), disputed: disputed.length, slices, ...(balanceLamports !== undefined ? { balanceLamports } : {}) };
}

/**
 * Nissan's ruling by hand: `payout` to the provider (at most its post), the
 * rest to the payer, with his reason on the record. Allowed whether or not the
 * slice is held, until the judge's window ends.
 */
export async function ruleByHand(input: { budget: string; payee: string; payout: bigint; reason: string }, deps: JudgeDeps): Promise<SliceOutcome | { status: string; error: string }> {
  let budgetKey: PublicKey, payee: PublicKey;
  try {
    budgetKey = new PublicKey(input.budget);
    payee = new PublicKey(input.payee);
  } catch {
    return { status: "refused", error: "invalid_address" };
  }
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 3) return { status: "refused", error: "reason_required" };
  if (input.payout < BigInt(0)) return { status: "refused", error: "invalid_payout" };
  const found = await readDisputed(budgetKey, payee, deps);
  if (typeof found === "string") return { status: "refused", error: found };
  const slice = sliceOf(budgetKey, found.reservation);
  if (input.payout > found.reservation.finalAmount) return { ...slice, status: "refused", error: "payout_above_post" };
  const slot = await deps.chain.slot();
  if (slot >= judgeWindows(found.budget, found.reservation).judgeEnds) return { ...slice, status: "refused", error: "window_over" };
  const memo = `rap-judge by-hand ${JUDGE_RULE_VERSION}`;
  const sent = await sendRuling(found, { payout: input.payout, memo }, deps);
  if (!sent.ok) return { ...slice, status: "send_failed", error: sent.error };
  await deps.store.append({ ...slice, kind: "ruling", reason, detail: { by: "nissan", posted: found.reservation.finalAmount.toString(), payout: input.payout.toString(), signature: sent.signature } });
  return { ...slice, status: "ruled", payout: input.payout.toString(), signature: sent.signature };
}
