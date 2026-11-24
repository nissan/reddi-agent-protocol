/**
 * Server only. The incident step for pooled Budgets (audit round 4,
 * S7-claude-03): when a spender key, the key-encryption key or the relay may
 * be compromised, the operator
 *
 * 1. pauses every spender signature at once (`pauseBudgets`), then
 * 2. closes every open Budget on chain with its own spender key
 *    (`closeAllBudgets`). A close stops new slices for good and returns what
 *    was never reserved to the payer at once; slices already posted keep
 *    their dispute window, so the payer can still dispute them. On a Budget
 *    without an allowlist the program starts that window no earlier than the
 *    end of the open period when anyone but the payer closes, so closing
 *    early never shortens the payer's time to dispute.
 *
 * Each payer is told their Budget was closed and why. The close transactions
 * are paid by an operator fee key (`BUDGET_OPS_FEE_PAYER`), which holds no
 * Budget money.
 */

import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { closeBudgetInstruction } from "@redditech/x402-solana/budget";
import { sendBudgetAlert } from "./alerts";
import { signAsSpender, type CustodyDeps } from "./custody";
import type { SpenderRecord } from "./store";

export interface IncidentChain {
  readAccount(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  latestBlockhash(): Promise<string>;
  /** Sends a fully signed transaction and waits for it to confirm. Returns its signature. */
  sendAndConfirm(tx: Transaction): Promise<string>;
}

/** Reads `BUDGET_OPS_FEE_PAYER`: a JSON array of the 64 secret-key bytes. */
export function readOpsFeePayer(env: Record<string, string | undefined> = process.env): Keypair | undefined {
  const raw = env.BUDGET_OPS_FEE_PAYER?.trim();
  if (!raw) return undefined;
  try {
    const bytes = JSON.parse(raw) as unknown;
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) return undefined;
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    return undefined;
  }
}

/** Stops every spender signature but the close, at once, and tells the operator. */
export async function pauseBudgets(reason: string, deps: CustodyDeps): Promise<boolean> {
  const paused = await deps.store.setPaused(true, reason);
  await sendBudgetAlert(
    { audience: "operator", kind: "incident", subject: paused ? "Budget spending paused" : "FAILED to pause Budget spending", text: `Reason: ${reason}\n${paused ? "No spender key signs anything but a close until this is lifted." : "The pause switch could not be written. Set BUDGET_SPENDING_PAUSED=true and redeploy."}`, detail: { reason, paused } },
    undefined,
    deps,
  );
  return paused;
}

export type CloseResult = { budget: string; ok: boolean; signature?: string; error?: string };

async function markClosing(record: SpenderRecord, deps: CustodyDeps): Promise<SpenderRecord | undefined> {
  let current: SpenderRecord | undefined = record;
  for (let attempt = 0; attempt < 5 && current; attempt += 1) {
    if (current.status === "closing" || current.status === "closed") return current;
    const next: SpenderRecord = { ...current, status: "closing", version: current.version + 1 };
    if ((await deps.store.update(next)).ok) return next;
    current = await deps.store.byId(record.id);
  }
  return undefined;
}

/** Builds, has the spender sign, fee-pays and sends the close of one Budget. */
export async function closeBudgetNow(
  record: SpenderRecord,
  input: { reason: string; feePayer: Keypair; programId: PublicKey; chain: IncidentChain },
  deps: CustodyDeps,
): Promise<CloseResult> {
  const budget = record.budget;
  if (!budget || !record.createdSlot) return { budget: record.id, ok: false, error: "not_open_on_chain" };
  const marked = await markClosing(record, deps);
  if (!marked) return { budget, ok: false, error: "store_conflict" };
  const payer = new PublicKey(record.payer);
  const instructions: TransactionInstruction[] = [];
  let token;
  if (record.mint) {
    const mint = new PublicKey(record.mint);
    const mintAccount = await input.chain.readAccount(mint);
    if (!mintAccount) return { budget, ok: false, error: "mint_not_found" };
    const tokenProgram = mintAccount.owner;
    const refund = getAssociatedTokenAddressSync(mint, payer, true, tokenProgram);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(input.feePayer.publicKey, refund, payer, mint, tokenProgram));
    token = { mint, refund, tokenProgram };
  }
  instructions.push(
    closeBudgetInstruction({
      programId: input.programId,
      budget: new PublicKey(budget),
      createdSlot: BigInt(record.createdSlot),
      signer: new PublicKey(record.spender),
      payer,
      ...(token ? { token } : {}),
    }),
  );
  const tx = new Transaction({ feePayer: input.feePayer.publicKey, recentBlockhash: await input.chain.latestBlockhash() });
  tx.add(...instructions);
  const signed = await signAsSpender({ id: record.id, transaction: tx, programId: input.programId }, deps);
  if (!signed.ok) return { budget, ok: false, error: signed.code };
  signed.transaction.partialSign(input.feePayer);
  let signature: string;
  try {
    signature = await input.chain.sendAndConfirm(signed.transaction);
  } catch (error) {
    return { budget, ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "send_failed" };
  }
  await sendBudgetAlert(
    {
      audience: "payer",
      kind: "incident",
      subject: "Your Budget was closed early by the operator",
      text: `RAP closed your Budget ${budget} to protect it: ${input.reason}\nNo new provider can reserve from it. What was never reserved is back in your wallet. Any slice a provider already posted can still be disputed until its window ends; you will get a separate alert for each.\nClose transaction: ${signature}`,
      detail: { budget, signature, reason: input.reason },
      spenderId: record.id,
    },
    record.contact,
    deps,
  );
  return { budget, ok: true, signature };
}

/**
 * The whole incident: pause, then close every Budget the relay holds a key
 * for that is still open on chain. Without a fee payer it pauses and reports
 * which Budgets still need closing.
 */
export async function closeAllBudgets(
  input: { reason: string; feePayer: Keypair | undefined; programId: PublicKey; chain: IncidentChain },
  deps: CustodyDeps,
): Promise<{ paused: boolean; results: CloseResult[] }> {
  const paused = await pauseBudgets(input.reason, deps);
  const records = await deps.store.withStatus(["pending", "open", "frozen", "closing"]);
  const results: CloseResult[] = [];
  for (const record of records) {
    if (record.status === "pending") {
      // Not opened yet: its key must never sign. The open transaction the payer may still hold names a spender nobody will use.
      const next: SpenderRecord = { ...record, status: "frozen", frozenReason: `incident: ${input.reason}`, version: record.version + 1 };
      const ok = (await deps.store.update(next)).ok;
      results.push({ budget: record.id, ok, ...(ok ? {} : { error: "store_conflict" }) });
      continue;
    }
    if (!input.feePayer) {
      results.push({ budget: record.budget ?? record.id, ok: false, error: "no_fee_payer" });
      continue;
    }
    results.push(await closeBudgetNow(record, { ...input, feePayer: input.feePayer }, deps));
  }
  const failed = results.filter((r) => !r.ok);
  await sendBudgetAlert(
    {
      audience: "operator",
      kind: "incident",
      subject: failed.length === 0 ? `Incident: ${results.length} Budget(s) closed or frozen` : `Incident: ${failed.length} of ${results.length} Budget(s) NOT closed`,
      text: results.map((r) => `${r.budget}: ${r.ok ? `done${r.signature ? ` ${r.signature}` : ""}` : `FAILED ${r.error}`}`).join("\n") || "No Budget was open.",
      detail: { reason: input.reason, results },
    },
    undefined,
    deps,
  );
  return { paused, results };
}
