/**
 * Server only. The try page's paid call (#925), one flow for every wallet:
 *
 * 1. `startTry` asks the provider for a challenge and seals a ticket.
 * 2. `buildTryTransaction` is the Solana Pay transaction request: for the
 *    wallet that asks, it builds the metered lock plus a Memo instruction that
 *    delegates this one call to the ticket's relay key. The lock instruction
 *    also names the ticket's reference key, read-only (the program ignores
 *    accounts after its own), so the page can find the transaction.
 * 3. `runTry` finds the confirmed lock by its reference, then makes the call
 *    with the relay key's signature and the lock-bound delegation. The
 *    provider checks the memo in the lock before it serves (x402-solana
 *    `verifySessionRequestWithTransactions`), settles the actual tokens, and
 *    the unused part of the maximum goes back to the payer.
 *
 * The wallet signs one transaction and nothing else, which is all a Solana
 * Pay transaction request can ask of it. Runs on devnet against the sandbox
 * providers; the relay key never holds funds.
 */
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import {
  lockBoundDelegationHeaderValue,
  sessionDelegationMemo,
  sessionDelegationMemoInstruction,
  sessionSignatureHeaderValue,
  SOLANA_GENESIS_HASHES,
  transactionFactsReader,
  type SessionDelegation,
} from "@redditech/x402-solana";
import { createPrivateKey, sign as edSign } from "crypto";
import { SANDBOX_ENDPOINT_PATH, type SandboxProvider } from "@/lib/sandbox/catalog";
import { buildSandboxMeteredLock, decodeSandboxEscrow, sandboxEscrowAddress } from "@/lib/sandbox/escrow";
import { handleSandboxChatCompletion, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { maxChargeLamports, requestInputTokens } from "@/lib/sandbox/pricing";
import { meteredPaymentHeader, type SandboxChallenge } from "@/lib/sandbox/client";
import { decodeReceiptHeader, PROVIDER_RECEIPT_HEADER } from "@/lib/sandbox/receipt";
import { findTryTask, tryTaskProvider, type TryTask } from "./tasks";
import { newTicketId, openTicket, relayKeypair, sealTicket, TRY_TICKET_SECONDS, type TryTicket } from "./ticket";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function signWith(key: Keypair, message: Uint8Array): Uint8Array {
  const pk = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(key.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return new Uint8Array(edSign(null, Buffer.from(message), pk));
}

export const TRY_LOCK_COMPUTE_UNITS = 80_000;
export const TRY_LOCK_MICRO_LAMPORTS_PER_UNIT = 1_000;

export type TryFailure = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): TryFailure => ({ ok: false, status, code, message });

function messagesFor(task: TryTask) {
  return [{ role: "user" as const, content: task.prompt }];
}

function requestText(task: TryTask, provider: SandboxProvider): string {
  return JSON.stringify({ model: provider.model, messages: messagesFor(task) });
}

function delegationFor(ticket: TryTicket, provider: SandboxProvider, escrow: PublicKey, secret: Buffer): SessionDelegation {
  return { genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], escrow: escrow.toBase58(), provider: provider.payTo, sessionKey: relayKeypair(ticket.id, secret).publicKey.toBase58(), expiresAt: ticket.exp };
}

/** Step 1: the provider's challenge for this task, and the sealed ticket. */
export async function startTry(input: { taskId: unknown; origin: string; secret: Buffer; deps: SandboxGatewayDeps; nowMs?: number }): Promise<{ ok: true; ticket: TryTicket; token: string; task: TryTask; provider: SandboxProvider } | TryFailure> {
  const task = findTryTask(input.taskId);
  if (!task) return fail(400, "unknown_task", "Pick one of the listed tasks.");
  const provider = tryTaskProvider(task);
  const text = requestText(task, provider);
  const reply = await handleSandboxChatCompletion({ body: JSON.parse(text), rawBody: text, paymentHeader: null, origin: input.origin }, input.deps);
  let challenge: SandboxChallenge | undefined;
  try {
    const body = JSON.parse(reply.bodyText) as { x402?: SandboxChallenge };
    challenge = reply.status === 402 ? body.x402 : undefined;
  } catch {
    challenge = undefined;
  }
  if (!challenge || typeof challenge.nonce !== "string" || challenge.payTo !== provider.payTo) {
    return fail(503, "provider_unavailable", `${provider.name} is not taking calls right now. Nothing was asked of your wallet.`);
  }
  const maxLamports = maxChargeLamports(provider, requestInputTokens(messagesFor(task)));
  const nowMs = input.nowMs ?? Date.now();
  const ticket: TryTicket = {
    v: 1,
    id: newTicketId(),
    taskId: task.id,
    nonce: challenge.nonce,
    maxLamports: maxLamports.toString(),
    reference: Keypair.generate().publicKey.toBase58(),
    exp: Math.floor(nowMs / 1000) + TRY_TICKET_SECONDS,
  };
  return { ok: true, ticket, token: sealTicket(ticket, input.secret), task, provider };
}

/** Step 2 (Solana Pay transaction request POST): the unsigned lock for `account` to sign, base64. */
export async function buildTryTransaction(input: { token: unknown; account: unknown; secret: Buffer; connection: Pick<Connection, "getLatestBlockhash">; nowMs?: number }): Promise<{ ok: true; transaction: string; message: string } | TryFailure> {
  const ticket = openTicket(input.token, input.secret, input.nowMs);
  if (!ticket) return fail(400, "ticket_invalid", "This try link has expired or is not one of ours. Start again from the try page.");
  const task = findTryTask(ticket.taskId);
  if (!task) return fail(400, "ticket_invalid", "This try link names a task that no longer exists.");
  let payer: PublicKey;
  try {
    payer = new PublicKey(String(input.account));
  } catch {
    return fail(400, "account_invalid", "The wallet sent an account that is not a Solana address.");
  }
  const provider = tryTaskProvider(task);
  const lock = buildSandboxMeteredLock({ payer, payee: new PublicKey(provider.payTo), maxLamports: BigInt(ticket.maxLamports), challengeNonce: ticket.nonce });
  lock.instruction.keys.push({ pubkey: new PublicKey(ticket.reference), isSigner: false, isWritable: false });
  const memo = sessionDelegationMemoInstruction(delegationFor(ticket, provider, lock.escrow, input.secret), payer);
  const { blockhash, lastValidBlockHeight } = await input.connection.getLatestBlockhash("confirmed");
  // An explicit, small compute budget. Without one, wallets add their own priority fee, which
  // was eight times the base fee on run 5 and larger than the call itself. The lock used
  // 53,575 compute units there; at 1,000 micro-lamports a unit the priority fee is 80 lamports.
  // The budget goes first, where wallets and their transaction checkers expect it: with it last,
  // Solflare's security check failed and hid the amount and fee (run 6).
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: TRY_LOCK_COMPUTE_UNITS }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: TRY_LOCK_MICRO_LAMPORTS_PER_UNIT })];
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...budget, lock.instruction, memo);
  const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  return { ok: true, transaction, message: `Lock up to the maximum for one ${provider.name} call on devnet. Unused SOL comes back after the answer.` };
}

/** What `runTry` reads from devnet: the reference's signatures and each transaction. A `Connection` fits. */
export type TryChainReader = Parameters<typeof transactionFactsReader>[0] & {
  getSignaturesForAddress(address: PublicKey, options: { limit: number; before?: string }, commitment: "confirmed"): Promise<readonly { signature: string; err: unknown }[]>;
};

export type TryRunResult =
  | { ok: true; state: "waiting" }
  /** The lock was already finished (settled by an earlier request this server no longer holds, or refunded). Nothing more is taken. */
  | { ok: true; state: "settled"; lockSignature: string; payer: string; escrow: string }
  | {
      ok: true;
      state: "answered";
      lockSignature: string;
      payer: string;
      escrow: string;
      status: number;
      body: unknown;
      /** The request and response body bytes as text: what the receipt's hashes cover. */
      requestText: string;
      responseText: string;
      /** The provider's signed receipt, decoded and unchecked. The page verifies it. */
      receipt?: unknown;
    };

/** How many signatures naming the reference `runTry` lists, and how many it reads per poll (S2-15). */
export const TRY_REFERENCE_SIGNATURES = 1_000;
export const TRY_READS_PER_POLL = 4;
const CACHE_LIMIT = 5_000;

/**
 * Per-instance memory for `runTry`, so polls stay cheap and repeatable:
 * signatures already found not to be a ticket's lock are not read again, and a
 * lock's answer (or the call in flight) is returned to every later poll of the
 * same ticket instead of calling the provider again (S2-14).
 */
export class TryRunCache {
  private readonly rejected = new Set<string>();
  private readonly answers = new Map<string, Promise<TryRunResult | TryFailure>>();
  private readonly cursors = new Map<string, string>();

  /** The oldest signature naming a ticket's reference that every newer one has been ruled out down to. */
  cursor(ticketId: string): string | undefined {
    return this.cursors.get(ticketId);
  }

  advance(ticketId: string, signature: string): void {
    this.cursors.set(ticketId, signature);
    if (this.cursors.size > CACHE_LIMIT) this.cursors.delete(this.cursors.keys().next().value as string);
  }

  isRejected(key: string): boolean {
    return this.rejected.has(key);
  }

  reject(key: string): void {
    this.rejected.add(key);
    if (this.rejected.size > CACHE_LIMIT) this.rejected.delete(this.rejected.values().next().value as string);
  }

  answer(key: string, run: () => Promise<TryRunResult | TryFailure>): Promise<TryRunResult | TryFailure> {
    const known = this.answers.get(key);
    if (known) return known;
    const pending = run();
    this.answers.set(key, pending);
    if (this.answers.size > CACHE_LIMIT) this.answers.delete(this.answers.keys().next().value as string);
    // Only a final outcome is kept: a served answer, or a lock already finished. A thrown
    // call (devnet unreachable) or a refusal while the escrow is still locked, such as a
    // provider 502 or 429, may pass on the next poll, so that poll calls again.
    pending.then(
      (result) => {
        if (!(result.ok && (result.state === "settled" || (result.state === "answered" && result.status === 200)))) this.answers.delete(key);
      },
      () => this.answers.delete(key),
    );
    return pending;
  }
}

const defaultCache = new TryRunCache();

/** Step 3: once the lock has landed, make the call. `waiting` until it has. */
export async function runTry(input: {
  token: unknown;
  origin: string;
  secret: Buffer;
  connection: TryChainReader;
  deps: SandboxGatewayDeps;
  nowMs?: number;
  cache?: TryRunCache;
  /** Signatures per page; tests make it small. */
  pageSize?: number;
}): Promise<TryRunResult | TryFailure> {
  const ticket = openTicket(input.token, input.secret, input.nowMs);
  if (!ticket) return fail(400, "ticket_invalid", "This try link has expired or is not one of ours. Start again from the try page.");
  const task = findTryTask(ticket.taskId);
  if (!task) return fail(400, "ticket_invalid", "This try link names a task that no longer exists.");
  const provider = tryTaskProvider(task);
  const cache = input.cache ?? defaultCache;
  const pageSize = input.pageSize ?? TRY_REFERENCE_SIGNATURES;
  const reference = new PublicKey(ticket.reference);
  const found = [...(await input.connection.getSignaturesForAddress(reference, { limit: pageSize }, "confirmed"))];
  // More than a page names the reference: also walk back one older page per poll, from
  // where earlier polls ruled everything out, so a flood cannot push the lock out of view.
  let older: { signature: string; err: unknown }[] = [];
  if (found.length === pageSize) {
    const before = cache.cursor(ticket.id) ?? found[found.length - 1].signature;
    older = [...(await input.connection.getSignaturesForAddress(reference, { limit: pageSize, before }, "confirmed"))];
  }
  const read = transactionFactsReader(input.connection);
  let reads = 0;
  // Oldest first: the reference is only public once the lock lands, so transactions
  // that name it to crowd the lock out come after it. Each is read once per ticket,
  // and a poll reads at most a few, so stuffing the reference cannot fan out RPC reads.
  for (const candidate of [...found, ...older].reverse()) {
    if (candidate.err) continue;
    const seen = `${ticket.id}:${candidate.signature}`;
    if (cache.isRejected(seen)) continue;
    if (reads >= TRY_READS_PER_POLL) break;
    reads += 1;
    const facts = await read(candidate.signature);
    if (!facts) continue; // Not readable yet: try again on the next poll.
    if (facts.failed || facts.signers.length === 0) {
      cache.reject(seen);
      continue;
    }
    const payer = new PublicKey(facts.signers[0]);
    const escrow = sandboxEscrowAddress(payer, ticket.nonce);
    // The reference key is public, so anyone can put it in a transaction. Only a lock
    // carrying this ticket's delegation memo, signed by its payer, is this try's.
    const delegation = delegationFor(ticket, provider, escrow, input.secret);
    const memo = sessionDelegationMemo(delegation);
    if (!facts.accounts.includes(escrow.toBase58()) || !facts.memos.some((m) => m.text === memo && m.accounts.includes(payer.toBase58()))) {
      cache.reject(seen);
      continue;
    }
    return cache.answer(seen, () => callProvider({ ...input, task, provider, ticket, delegation, escrow, payer, lockSignature: candidate.signature }));
  }
  // The older page is all ruled out: the next poll starts below it.
  if (older.length === pageSize && older.every((c) => c.err || cache.isRejected(`${ticket.id}:${c.signature}`))) cache.advance(ticket.id, older[older.length - 1].signature);
  return { ok: true, state: "waiting" };
}

async function callProvider(input: {
  origin: string;
  secret: Buffer;
  deps: SandboxGatewayDeps;
  task: TryTask;
  provider: SandboxProvider;
  ticket: TryTicket;
  delegation: SessionDelegation;
  escrow: PublicKey;
  payer: PublicKey;
  lockSignature: string;
}): Promise<TryRunResult> {
  const { task, provider, ticket, delegation, escrow, payer, lockSignature } = input;
  const relay = relayKeypair(ticket.id, input.secret);
  const text = requestText(task, provider);
  const challenge: SandboxChallenge = { version: "1", network: "solana-devnet", payTo: provider.payTo, amount: "0", currency: "SOL", endpoint: SANDBOX_ENDPOINT_PATH, nonce: ticket.nonce };
  const reply = await handleSandboxChatCompletion(
    {
      body: JSON.parse(text),
      rawBody: text,
      paymentHeader: meteredPaymentHeader(challenge, escrow.toBase58(), lockSignature, payer.toBase58()),
      origin: input.origin,
      session: {
        delegation: lockBoundDelegationHeaderValue(delegation, lockSignature),
        signature: await sessionSignatureHeaderValue({ genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], action: "single", escrow: escrow.toBase58(), sequence: 0, body: text }, (m) => signWith(relay, m)),
      },
    },
    input.deps,
  );
  let body: unknown;
  try {
    body = JSON.parse(reply.bodyText);
  } catch {
    body = { error: { code: "bad_response", message: "The provider's reply is not JSON." } };
  }
  // Another server instance may have served this lock already. The lock landed, so an
  // escrow that is now closed or no longer locked was settled (or later refunded): the
  // refusal reflects that, not a rejected payment, and nothing more is taken.
  if (reply.status !== 200) {
    if (await escrowNoLongerLocked(input.deps, escrow)) return { ok: true, state: "settled", lockSignature, payer: payer.toBase58(), escrow: escrow.toBase58() };
  }
  const receipt = decodeReceiptHeader(reply.headers[PROVIDER_RECEIPT_HEADER]);
  return { ok: true, state: "answered", lockSignature, payer: payer.toBase58(), escrow: escrow.toBase58(), status: reply.status, body, requestText: text, responseText: reply.bodyText, ...(receipt !== undefined ? { receipt } : {}) };
}

async function escrowNoLongerLocked(deps: SandboxGatewayDeps, escrow: PublicKey): Promise<boolean> {
  if (!deps.readAccount) return false;
  const account = await deps.readAccount(escrow);
  if (!account) return true;
  const decoded = decodeSandboxEscrow(account.data);
  return decoded !== undefined && decoded.status !== "locked";
}
