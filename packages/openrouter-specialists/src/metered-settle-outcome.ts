/**
 * What a specialist knows about a metered settle once it has tried to send one (audit S7-Codex-R2-04
 * and R2-05), and how it reads the settle back from the chain.
 *
 * The operator's signer (`RuntimeDeps.settleMeteredEscrow`) is opaque: it signs, sends and confirms.
 * When it throws, the runtime can only say "nothing was charged" if the signer says it never sent
 * anything, by throwing `SettleNotSentError`. Any other failure may come after the cluster took the
 * transaction, so the outcome is unknown: the payer is told so, and the answer the settle would pay
 * for is held for the payer (`HeldAnswerStore`) until the settle is found on chain.
 *
 * The fee in a receipt is what the treasury's token account received in the confirmed settle, never
 * the rate the server's clock gives: the program reads the rate at payout.
 */
import { createHash } from "node:crypto";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

/** Throw this from a settle signer when nothing was sent (for example, the key is unavailable or preflight refused it). */
export class SettleNotSentError extends Error {
  constructor(message = "The settle was not sent.") {
    super(message);
    this.name = "SettleNotSentError";
  }
}

/**
 * Signs, sends and confirms a metered escrow's settle with the provider wallet's key; returns the
 * confirmed signature. A `MeteredSettleSigner` from `@redditech/x402-solana` fits. A signer that
 * calls `context.onSigned` with the signature before it sends lets an unknown outcome name it.
 */
export type SpecialistSettleSigner = (instructions: TransactionInstruction[], context?: { onSigned?: (signature: string) => void }) => Promise<string>;

/** An answer whose settle's outcome was unknown, held for the payer. Strings only, so a durable store can keep it. */
export interface HeldAnswer {
  /** The upstream completion and the runtime's `reddi` block, as JSON. */
  upstreamJson: string;
  reddiJson: string;
  /** The settle's amount, the escrow's created slot it names, and its signature when the signer gave it. */
  chargedBaseUnits: string;
  createdSlot: string;
  settleSignature?: string;
  /** Settlement figures for the receipt, except the fee, which is read from the chain. */
  settlement: { currency: string; inputTokens: number; outputTokens: number; charged: string; capped: boolean; maxBaseUnits: string; payer: string };
}

export interface HeldAnswerStore {
  put(key: string, answer: HeldAnswer): Promise<void> | void;
  get(key: string): Promise<HeldAnswer | undefined> | HeldAnswer | undefined;
  delete(key: string): Promise<void> | void;
}

/** Keeps held answers in this process, the most recent `limit` of them. */
export class MemoryHeldAnswerStore implements HeldAnswerStore {
  private readonly answers = new Map<string, HeldAnswer>();
  constructor(private readonly limit = 1_000) {}
  put(key: string, answer: HeldAnswer): void {
    this.answers.delete(key);
    this.answers.set(key, answer);
    if (this.answers.size > this.limit) this.answers.delete(this.answers.keys().next().value as string);
  }
  get(key: string): HeldAnswer | undefined {
    return this.answers.get(key);
  }
  delete(key: string): void {
    this.answers.delete(key);
  }
}

/** One escrow and one exact request body: the payer's retry carries both. */
export function heldAnswerKey(escrow: PublicKey, requestText: string): string {
  return `${escrow.toBase58()}:${createHash("sha256").update(Buffer.from(requestText, "utf8")).digest("hex")}`;
}

const SETTLE_TOKEN_ESCROW = createHash("sha256").update("global:settle_token_escrow").digest().subarray(0, 8);

/** The settle the provider sent for one job: its escrow, payee, treasury token account, amount and the escrow instance it names. */
export interface ExpectedSettle {
  programId: PublicKey;
  escrow: PublicKey;
  payee: PublicKey;
  treasuryToken: PublicKey;
  mint: PublicKey;
  actualBaseUnits: bigint;
  createdSlot: bigint;
}

export type SettleFacts = { state: "settled"; feeBaseUnits: bigint } | { state: "failed" } | { state: "unknown" };

type ParsedInstruction = { programId?: unknown; accounts?: unknown[]; data?: unknown };
type TokenBalance = { accountIndex?: unknown; mint?: unknown; uiTokenAmount?: { amount?: unknown } };
type ParsedTx = {
  meta?: { err?: unknown; preTokenBalances?: TokenBalance[] | null; postTokenBalances?: TokenBalance[] | null } | null;
  transaction?: { message?: { accountKeys?: unknown[]; instructions?: ParsedInstruction[] } };
} | null;

/** Reads a parsed transaction (`getParsedTransaction` at `confirmed`). */
export type SettleTransactionReader = (signature: string) => Promise<unknown>;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value: string): Buffer | undefined {
  let n = BigInt(0);
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return undefined;
    n = n * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > BigInt(0)) {
    bytes.unshift(Number(n & BigInt(255)));
    n >>= BigInt(8);
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

function key(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as { pubkey?: unknown; toBase58?: () => string };
    if (record.pubkey !== undefined) return key(record.pubkey);
    if (typeof record.toBase58 === "function") return record.toBase58();
  }
  return "";
}

function balance(list: TokenBalance[] | null | undefined, keys: string[], account: string, mint: string): bigint {
  for (const entry of list ?? []) {
    if (typeof entry?.accountIndex !== "number" || keys[entry.accountIndex] !== account || entry.mint !== mint) continue;
    const amount = entry.uiTokenAmount?.amount;
    if (typeof amount === "string" && /^\d+$/.test(amount)) return BigInt(amount);
  }
  return BigInt(0);
}

/**
 * The chain's account of one settle: `settled` with the treasury token account's credit when the
 * transaction succeeded and holds exactly one settle_token_escrow of this escrow, by this payee, to
 * this treasury account, for this amount, naming this escrow instance; `failed` when it is confirmed
 * and failed or holds no such settle; `unknown` when it cannot be read.
 */
export function settleFactsOf(tx: unknown, expected: ExpectedSettle): SettleFacts {
  const parsed = tx as ParsedTx;
  if (!parsed?.meta || !parsed.transaction?.message) return { state: "unknown" };
  if (parsed.meta.err !== null && parsed.meta.err !== undefined) return { state: "failed" };
  const keys = (parsed.transaction.message.accountKeys ?? []).map(key);
  const settles = (parsed.transaction.message.instructions ?? []).filter((ix) => {
    if (key(ix.programId) !== expected.programId.toBase58() || !Array.isArray(ix.accounts) || typeof ix.data !== "string") return false;
    const data = decodeBase58(ix.data);
    if (!data || data.length !== 24 || !data.subarray(0, 8).equals(SETTLE_TOKEN_ESCROW)) return false;
    const accounts = ix.accounts.map(key);
    return (
      data.readBigUInt64LE(8) === expected.actualBaseUnits &&
      data.readBigUInt64LE(16) === expected.createdSlot &&
      accounts[0] === expected.escrow.toBase58() &&
      accounts[2] === expected.payee.toBase58() &&
      accounts[6] === expected.treasuryToken.toBase58()
    );
  });
  if (settles.length !== 1) return { state: "failed" };
  const treasury = expected.treasuryToken.toBase58();
  const mint = expected.mint.toBase58();
  const fee = balance(parsed.meta.postTokenBalances, keys, treasury, mint) - balance(parsed.meta.preTokenBalances, keys, treasury, mint);
  if (fee < BigInt(0) || fee > expected.actualBaseUnits) return { state: "unknown" };
  return { state: "settled", feeBaseUnits: fee };
}

/** Reads a settle a few times: a transaction just confirmed is not always readable at once. */
export async function readSettleFacts(read: SettleTransactionReader, signature: string, expected: ExpectedSettle, options: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<SettleFacts> {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const facts = settleFactsOf(await read(signature), expected);
      if (facts.state !== "unknown") return facts;
    } catch {
      // Read again.
    }
    if (attempt + 1 < attempts) await sleep(400);
  }
  return { state: "unknown" };
}
