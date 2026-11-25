/**
 * Server only. The incident step for pooled Budgets (audit round 4,
 * S7-claude-03): when the relay or its KMS access may be compromised, the
 * operator
 *
 * 1. pauses every spender approval at once (`pauseBudgets`), then
 * 2. closes every open Budget on chain with a KMS approval
 *    (`closeAllBudgets`), and
 * 3. if the relay itself may be compromised, removes the KMS issuer's project
 *    grant (or revokes the key), so nothing can have KMS sign any more.
 *
 * A close stops new slices for good and returns what was never reserved to
 * the payer at once; slices already posted keep their dispute window, so the
 * payer can still dispute them. On a Budget without an allowlist the program
 * starts that window no earlier than the end of the open period when anyone
 * but the payer closes, so closing early never shortens the payer's time to
 * dispute.
 *
 * Each payer is told their Budget was closed and why. The close transactions
 * are paid by an operator fee key (`BUDGET_OPS_FEE_PAYER`), which holds no
 * Budget money. Closes run several at once within a deadline below the
 * route's time limit, so the operator always gets the summary, with every
 * Budget either closed, already closed, failed or listed as not reached; a
 * second run picks up what is left. Records not yet opened are frozen and
 * their payers told not to open; a Budget the payer opened anyway is found at
 * the address the payer signed for, and closed.
 *
 * What close does not stop: on a Budget that lets the spender waive (it has
 * an allowlist and flag 0x01), whoever can still get the KMS key to sign can
 * waive slices already posted, until they settle. The payer is told so.
 */

import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { decodeBudget, type BudgetAccount } from "@redditech/x402-solana/budget";
import { sendBudgetAlert } from "./alerts";
import { addHold, releaseHold } from "./holds";
import { approveAsSpender, PENDING_MAX_AGE_SECONDS, type CustodyDeps } from "./custody";
import { GENESIS_HASH, type SpenderRecord } from "./store";

export interface IncidentChain {
  readAccount(address: PublicKey, commitment?: "confirmed" | "finalized"): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  latestBlockhash(): Promise<string>;
  /** The current slot, for the approval's expiry. */
  slot(): Promise<bigint>;
  /** The cluster's genesis hash, to refuse an RPC on the wrong cluster. */
  genesisHash(): Promise<string>;
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

/**
 * Lifts a hold, as the signer only (`BUDGET_INCIDENT_SECRET`): the pause of
 * every Budget, or the freeze of one record (which then opens again if its
 * status was frozen). Tells the operator.
 */
export async function releaseBudgets(target: { scope: "all" } | { scope: "spender"; spenderId: string }, reason: string, deps: CustodyDeps): Promise<boolean> {
  const env = deps.env ?? process.env;
  let released = await releaseHold(deps.store, target, reason, env, deps.nowMs ?? Date.now()).catch(() => false);
  if (released && target.scope === "all") released = await deps.store.setPaused(false, reason);
  if (released && target.scope === "spender") {
    const record = await deps.store.byId(target.spenderId);
    if (record?.status === "frozen") released = Boolean(await update(record, deps, (r) => (r.status === "frozen" ? { ...r, status: "open", frozenReason: undefined, version: r.version + 1 } : undefined)));
  }
  await sendBudgetAlert(
    { audience: "operator", kind: "incident", subject: released ? (target.scope === "all" ? "Budget spending resumed" : `Budget record ${target.spenderId} unfrozen`) : "FAILED to lift a Budget hold", text: `Reason: ${reason}`, detail: { reason, released, ...target } },
    undefined,
    deps,
  );
  return released;
}

/** Stops every spender approval but the close, at once, and tells the operator. */
export async function pauseBudgets(reason: string, deps: CustodyDeps): Promise<boolean> {
  // The hold is what the signer goes by, and only the signer can lift it (RT-M2); the switch is for the database's own check.
  const [held, switched] = await Promise.all([addHold(deps.store, { scope: "all" }, reason, deps.nowMs ?? Date.now()), deps.store.setPaused(true, reason)]);
  const paused = held || switched;
  await sendBudgetAlert(
    { audience: "operator", kind: "incident", subject: paused ? "Budget spending paused" : "FAILED to pause Budget spending", text: `Reason: ${reason}\n${paused ? "The relay approves nothing but a close until this is lifted. Approvals already given expire within about a minute. If the relay itself may be compromised, also remove the KMS issuer's project grant." : "The pause switch could not be written. Set BUDGET_SPENDING_PAUSED=true and redeploy."}`, detail: { reason, paused } },
    undefined,
    deps,
  );
  return paused;
}

export type CloseResult = { budget: string; ok: boolean; signature?: string; error?: string; note?: string };

async function update(record: SpenderRecord, deps: CustodyDeps, change: (r: SpenderRecord) => SpenderRecord | undefined): Promise<SpenderRecord | undefined> {
  let current: SpenderRecord | undefined = record;
  for (let attempt = 0; attempt < 5 && current; attempt += 1) {
    const changed = change(current);
    if (!changed) return current;
    const next: SpenderRecord = { ...changed, version: current.version + 1 };
    if ((await deps.store.update(next)).ok) return next;
    current = await deps.store.byId(record.id);
  }
  return undefined;
}

const markClosing = (record: SpenderRecord, deps: CustodyDeps) =>
  update(record, deps, (r) => (r.status === "closing" || r.status === "closed" ? undefined : { ...r, status: "closing" }));

async function noteResult(record: SpenderRecord, reason: string, result: CloseResult, deps: CustodyDeps, nowMs: number): Promise<void> {
  await update(record, deps, (r) => ({
    ...r,
    incident: { reason, ok: result.ok, at: new Date(nowMs).toISOString(), ...(result.signature ? { signature: result.signature } : {}), ...(result.error ? { error: result.error } : {}) },
  })).catch(() => undefined);
}

/** Builds, has KMS approve, fee-pays and sends the close of one Budget. Skips one already closed on chain. */
export async function closeBudgetNow(
  record: SpenderRecord,
  input: { reason: string; feePayer: Keypair; programId: PublicKey; chain: IncidentChain },
  deps: CustodyDeps,
): Promise<CloseResult> {
  const budget = record.budget;
  if (!budget || !record.createdSlot) return { budget: record.id, ok: false, error: "not_open_on_chain" };
  let onChain: BudgetAccount | undefined;
  try {
    const account = await input.chain.readAccount(new PublicKey(budget));
    if (!account) return { budget, ok: true, note: "already_closed" };
    if (account.owner.equals(input.programId)) onChain = decodeBudget(account.data);
  } catch {
    onChain = undefined;
  }
  if (onChain && onChain.createdSlot.toString() !== record.createdSlot) return { budget, ok: true, note: "already_closed" };
  if (onChain?.closed) {
    await markClosing(record, deps);
    return { budget, ok: true, note: "already_closed" };
  }
  const marked = await markClosing(record, deps);
  if (!marked) return { budget, ok: false, error: "store_conflict" };
  const payer = new PublicKey(record.payer);
  const instructions: TransactionInstruction[] = [];
  let token: { mint: PublicKey; refund: PublicKey; tokenProgram: PublicKey } | undefined;
  if (record.mint) {
    const mint = new PublicKey(record.mint);
    const mintAccount = await input.chain.readAccount(mint);
    if (!mintAccount) return { budget, ok: false, error: "mint_not_found" };
    const tokenProgram = mintAccount.owner;
    const refund = getAssociatedTokenAddressSync(mint, payer, true, tokenProgram);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(input.feePayer.publicKey, refund, payer, mint, tokenProgram));
    token = { mint, refund, tokenProgram };
  }
  let signature: string;
  try {
    const approved = await approveAsSpender({ id: record.id, auth: { operator: "incident" }, request: { purpose: "close", ...(token ? { token } : {}) }, programId: input.programId, caller: "incident" }, { ...deps, chain: input.chain });
    if (!approved.ok) return { budget, ok: false, error: approved.code };
    const tx = new Transaction({ feePayer: input.feePayer.publicKey, recentBlockhash: await input.chain.latestBlockhash() });
    tx.add(...instructions, ...approved.instructions);
    tx.sign(input.feePayer);
    signature = await input.chain.sendAndConfirm(tx);
  } catch (error) {
    return { budget, ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "send_failed" };
  }
  const waiveNote = onChain?.spenderMayWaive
    ? "\nThis Budget lets its spender waive: until each posted slice settles, a compromised relay could still waive it, so check every post alert and dispute what you do not recognise at once."
    : "";
  await sendBudgetAlert(
    {
      audience: "payer",
      kind: "incident",
      subject: "Your Budget was closed early by the operator",
      text: `RAP closed your Budget ${budget} to protect it: ${input.reason}\nNo new provider can reserve from it. What was never reserved is back in your wallet. Any slice a provider already posted can still be disputed until its window ends; you will get a separate alert for each.${waiveNote}\nClose transaction: ${signature}`,
      detail: { budget, signature, reason: input.reason, spenderMayWaive: onChain?.spenderMayWaive ?? null },
      spenderId: record.id,
    },
    record.contact,
    deps,
  );
  return { budget, ok: true, signature };
}

/** Freezes a record the payer has not opened yet, and tells the payer not to open it. */
async function freezePending(record: SpenderRecord, reason: string, deps: CustodyDeps): Promise<CloseResult> {
  const next = await update(record, deps, (r) => (r.status !== "pending" ? undefined : { ...r, status: "frozen", frozenReason: `incident: ${reason}` }));
  if (!next || next.status !== "frozen") return { budget: record.id, ok: false, error: "store_conflict" };
  await sendBudgetAlert(
    {
      audience: "payer",
      kind: "do_not_open",
      subject: "Do not open the Budget RAP prepared for you",
      text: `RAP stopped the Budget it prepared for you (${record.budget ?? `spender ${record.spender}`}): ${reason}\nIf you still hold the transaction that opens that Budget, do not sign it. If you already did, RAP will find the Budget and close it.`,
      detail: { budget: record.budget ?? null, spender: record.spender, reason },
      spenderId: record.id,
    },
    record.contact,
    deps,
  );
  return { budget: record.id, ok: true, note: "frozen_before_open" };
}

/** A frozen record the relay never saw open: the Budget the payer signed for, if the payer opened it anyway. */
async function attachOpened(record: SpenderRecord, chain: IncidentChain, programId: PublicKey, deps: CustodyDeps): Promise<SpenderRecord | undefined> {
  if (!record.budget) return undefined;
  const account = await chain.readAccount(new PublicKey(record.budget));
  if (!account || !account.owner.equals(programId)) return undefined;
  let budget: BudgetAccount;
  try {
    budget = decodeBudget(account.data);
  } catch {
    return undefined;
  }
  if (budget.payer.toBase58() !== record.payer || budget.spender.toBase58() !== record.spender) return undefined;
  return update(record, deps, (r) => ({ ...r, createdSlot: budget.createdSlot.toString(), ...(budget.mint ? { mint: budget.mint.toBase58() } : {}) }));
}

export type IncidentOutcome = { paused: boolean; results: CloseResult[]; unreached: string[] };

/**
 * The whole incident: pause, then close every Budget the relay spends from
 * that is still open on chain. Without a fee payer it pauses and reports
 * which Budgets still need closing.
 */
export async function closeAllBudgets(
  input: { reason: string; feePayer: Keypair | undefined; programId: PublicKey; chain: IncidentChain; concurrency?: number; deadlineMs?: number },
  deps: CustodyDeps,
): Promise<IncidentOutcome> {
  const startedMs = Date.now();
  const deadline = input.deadlineMs ?? startedMs + 240_000;
  const paused = await pauseBudgets(input.reason, deps);
  // Budgets that can hold money first; then pending records still young enough to be activated. An older
  // pending record can never be activated (PENDING_MAX_AGE_SECONDS), so it is skipped: anyone can make pending
  // records, and they must not crowd out the real Budgets (audit 2026-11-25, RT-M1).
  const nowS = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  const listed = await deps.store.withStatus(["pending", "open", "frozen", "closing"]);
  const live = (r: SpenderRecord) => !r.authorization || r.authorization.issuedAt + PENDING_MAX_AGE_SECONDS >= nowS;
  const expiredPending = listed.filter((r) => r.status === "pending" && !live(r)).length;
  const records = [...listed.filter((r) => r.status !== "pending"), ...listed.filter((r) => r.status === "pending" && live(r))];
  // An RPC on another cluster would read every Budget as missing, so "already closed": close none through it.
  const genesis = await input.chain.genesisHash().catch(() => undefined);
  const results: CloseResult[] = [];
  const unreached: string[] = [];
  const queue = [...records];
  const worker = async () => {
    for (let record = queue.shift(); record; record = queue.shift()) {
      if (Date.now() > deadline) {
        unreached.push(record.budget ?? record.id);
        continue;
      }
      let result: CloseResult;
      try {
        if (record.status === "pending") {
          result = await freezePending(record, input.reason, deps);
        } else if (GENESIS_HASH[record.network] !== genesis) {
          result = { budget: record.budget ?? record.id, ok: false, error: genesis ? "wrong_cluster" : "rpc_unavailable" };
        } else {
          let current: SpenderRecord | undefined = record;
          if (!current.createdSlot) current = await attachOpened(current, input.chain, input.programId, deps);
          if (!current?.budget || !current.createdSlot) {
            result = { budget: record.id, ok: true, note: "never_opened" };
          } else if (!input.feePayer) {
            result = { budget: current.budget, ok: false, error: "no_fee_payer" };
          } else {
            result = await closeBudgetNow(current, { ...input, feePayer: input.feePayer }, deps);
            await noteResult(current, input.reason, result, deps, Date.now());
          }
        }
      } catch (error) {
        result = { budget: record.budget ?? record.id, ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "unknown" };
      }
      results.push(result);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(input.concurrency ?? 6, records.length)) }, worker));
  const failed = results.filter((r) => !r.ok);
  const lines = [
    ...results.map((r) => `${r.budget}: ${r.ok ? `done${r.signature ? ` ${r.signature}` : r.note ? ` (${r.note})` : ""}` : `FAILED ${r.error}`}`),
    ...unreached.map((b) => `${b}: NOT REACHED (run the incident close again)`),
    ...(expiredPending > 0 ? [`${expiredPending} pending record(s) older than an hour skipped: they can no longer be activated.`] : []),
  ];
  await sendBudgetAlert(
    {
      audience: "operator",
      kind: "incident",
      subject:
        failed.length === 0 && unreached.length === 0
          ? `Incident: ${results.length} Budget(s) closed or frozen`
          : `Incident: ${failed.length + unreached.length} of ${records.length} Budget(s) NOT closed`,
      text: lines.join("\n") || "No Budget was open.",
      detail: { reason: input.reason, results, unreached },
    },
    undefined,
    deps,
  );
  return { paused, results, unreached };
}
