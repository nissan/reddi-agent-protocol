/**
 * Devnet sandbox providers' side of pooled Budgets, in SOL. Server-side only.
 *
 * It follows the provider kit's Budget desk (`packages/provider-kit/src/budgets.ts`),
 * which is paid in tokens only, for the sandbox's SOL providers:
 *
 * 1. A call names the Budget and its call number in `x402-budget`, signed by
 *    the Budget's spender in `x402-budget-signature`. The signature is
 *    checked against the spender read on chain before anything else.
 * 2. No slice yet, or too little left: 402 with a Budget offer. The relay
 *    sends the call again with a spender-approved `reserve` in
 *    `x402-budget-reserve`; it is checked to be exactly that reserve (payee,
 *    payout account, amount within the offer, fees bounded), then the
 *    provider signs it as payee and fee payer and sends it.
 * 3. The call is served and its cost (never more than what is left of the
 *    slice) is recorded before the answer is sent. The record is
 *    conditional on the call number, so one number is never recorded twice.
 *    Nothing moves on chain per call.
 *
 * The sweep (`settleDueSandboxBudgets`) posts each slice's total once its
 * Budget is closed or its open period is about to end, closes a Budget whose
 * open period has ended (anyone may) and pays each posted slice out once the
 * payer approved it, its dispute window ended, or a judge's window passed.
 *
 * Fails closed: a Budget, slice or ledger that cannot be read or written
 * refuses the call before it is answered. Test SOL only.
 */
import bs58 from "bs58";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, type Connection, type Keypair } from "@solana/web3.js";
import { AGENT_SEED, AGENT_TYPE_ENUM, buildRegisterAgentData, INCINERATOR } from "@/lib/program";
import { ESCROW_PROTOCOL_TREASURY } from "@redditech/x402-solana";
import { closeBudgetInstruction, decodeBudget, decodeReservation, disputeEnds, judgeEnds, minReservation, payoutInstruction, postFinalInstruction, reservationAddress, type BudgetAccount, type ReservationAccount } from "@redditech/x402-solana/budget";
import { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER, checkPooledBudgetForProvider, checkReserveTransaction, readBudgetPaymentHeader, verifyPooledBudgetRequest, type PooledBudgetOffer } from "@redditech/x402-solana/budget-provider";
import { supabaseOrigin } from "@/lib/supabase/config";
import { SANDBOX_PROVIDERS, type SandboxProvider } from "./catalog";
import { DEVNET_GENESIS_HASH, isDevnetConnection } from "./devnet-genesis";
import { confirmByPolling } from "./settle-signer";

export { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER };

/** A first reserve asks for this many of the call's worst case. */
export const SANDBOX_BUDGET_RESERVE_CALLS = 10;
/** A Budget must still be open about an hour for a sandbox provider to join it; it stops taking calls at half that. */
export const SANDBOX_BUDGET_MIN_OPEN_SLOTS = BigInt(9_000);
/** The receipt of a Budget-paid sandbox call travels in this header: base64url JSON. */
export const BUDGET_RECEIPT_HEADER = "x-reddi-budget-receipt";
export const SANDBOX_BUDGET_RECEIPT_VERSION = "rap.sandbox.budget-receipt.v1";

/** What a sandbox provider remembers of its slice of one Budget. Amounts are lamport strings. */
export type SandboxBudgetSlice = {
  provider: string;
  budget: string;
  createdSlot: string;
  payer: string;
  reserved: string;
  spent: string;
  inputTokens: number;
  outputTokens: number;
  /** Calls served. The next call must carry `sequence + 1`. */
  sequence: number;
  lastReceiptHash?: string;
  lastCallMs: number;
  status: "open" | "posted" | "done";
  posted?: string;
  postSignature?: string;
  payoutSignature?: string;
  /** 1 on the first write; each write names the next. */
  version: number;
};

export type SliceWrite = "ok" | "conflict" | "unavailable";

export interface SandboxBudgetSliceStore {
  /** Throws when the ledger cannot be read. */
  get(provider: string, budget: string): Promise<SandboxBudgetSlice | undefined>;
  /** Writes `next` only if the stored slice is at `next.version - 1` (absent, for version 1). */
  put(next: SandboxBudgetSlice): Promise<SliceWrite>;
  /** Every slice still `open` or `posted`. Throws when the ledger cannot be read. */
  due(): Promise<SandboxBudgetSlice[]>;
}

export class MemorySandboxBudgetSliceStore implements SandboxBudgetSliceStore {
  private readonly slices = new Map<string, SandboxBudgetSlice>();
  async get(provider: string, budget: string) {
    const s = this.slices.get(`${provider}:${budget}`);
    return s ? { ...s } : undefined;
  }
  async put(next: SandboxBudgetSlice): Promise<SliceWrite> {
    const key = `${next.provider}:${next.budget}`;
    const current = this.slices.get(key);
    if ((current?.version ?? 0) !== next.version - 1) return "conflict";
    this.slices.set(key, { ...next });
    return "ok";
  }
  async due() {
    return [...this.slices.values()].filter((s) => s.status !== "done").map((s) => ({ ...s }));
  }
}

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Table `sandbox_budget_slices` (migration 20261125150000), with the service role key. */
export class SupabaseSandboxBudgetSliceStore implements SandboxBudgetSliceStore {
  constructor(private readonly config: { url: string; serviceKey: string; fetchImpl?: FetchLike }) {}
  private request(path: string, init: { method: string; headers?: Record<string, string>; body?: string }) {
    const headers = { apikey: this.config.serviceKey, authorization: `Bearer ${this.config.serviceKey}`, "content-type": "application/json", ...(init.headers ?? {}) };
    return (this.config.fetchImpl ?? (fetch as unknown as FetchLike))(`${this.config.url}/rest/v1/${path}`, { method: init.method, headers, ...(init.body ? { body: init.body } : {}) });
  }
  async get(provider: string, budget: string) {
    if (!PROVIDER_ID.test(provider) || !BASE58.test(budget)) return undefined;
    const response = await this.request(`sandbox_budget_slices?provider=eq.${provider}&budget=eq.${budget}&select=record,version&limit=1`, { method: "GET" });
    if (!response.ok) throw new Error(`sandbox budget slices: ${response.status}`);
    const row = ((await response.json()) as { record: SandboxBudgetSlice; version: number }[])[0];
    return row ? { ...row.record, version: row.version } : undefined;
  }
  async put(next: SandboxBudgetSlice): Promise<SliceWrite> {
    if (!PROVIDER_ID.test(next.provider) || !BASE58.test(next.budget)) return "conflict";
    const row = { provider: next.provider, budget: next.budget, status: next.status, record: next, version: next.version, updated_at: new Date().toISOString() };
    try {
      if (next.version === 1) {
        const response = await this.request("sandbox_budget_slices", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) });
        if (response.ok) return "ok";
        return response.status === 409 ? "conflict" : "unavailable";
      }
      const response = await this.request(`sandbox_budget_slices?provider=eq.${next.provider}&budget=eq.${next.budget}&version=eq.${next.version - 1}`, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      if (!response.ok) return "unavailable";
      return ((await response.json()) as unknown[]).length === 1 ? "ok" : "conflict";
    } catch {
      return "unavailable";
    }
  }
  async due() {
    const response = await this.request("sandbox_budget_slices?status=neq.done&select=record,version&order=updated_at.asc&limit=200", { method: "GET" });
    if (!response.ok) throw new Error(`sandbox budget slices: ${response.status}`);
    return ((await response.json()) as { record: SandboxBudgetSlice; version: number }[]).map((row) => ({ ...row.record, version: row.version }));
  }
}

let configuredStore: SandboxBudgetSliceStore | undefined;
/** The shared ledger, or undefined while Supabase is not set up (Budget calls are then refused). */
export function sandboxBudgetSliceStore(env: Record<string, string | undefined> = process.env): SandboxBudgetSliceStore | undefined {
  if (configuredStore) return configuredStore;
  const url = supabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return undefined;
  configuredStore = new SupabaseSandboxBudgetSliceStore({ url, serviceKey });
  return configuredStore;
}

/** The chain as a sandbox provider sees it. */
export interface SandboxBudgetChain {
  readAccount(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  slot(): Promise<bigint>;
  /** True when the server holds this provider's devnet key. */
  canSign(providerId: string): boolean;
  /** Adds the provider's signature to a reserve the spender approved, sends it and resolves once it is confirmed. */
  cosignAndSend(providerId: string, transaction: Transaction): Promise<string>;
  /** Signs with the provider's key, sends and resolves once confirmed. */
  send(providerId: string, instructions: TransactionInstruction[]): Promise<string>;
  /**
   * The program lets a Budget reserve only for a registered, active agent, so
   * a sandbox provider registers itself (devnet SOL: the 0.01 fee and the
   * account's rent) before its first reserve. Does nothing once registered.
   */
  ensureRegistered(providerId: string, model: string, programId: PublicKey): Promise<void>;
}

/** The devnet chain, with the providers' devnet keys (`SANDBOX_DEVNET_PAYEE_KEYS`). Refuses to sign on any other cluster. */
export function sandboxBudgetChain(connection: Connection, keys: Map<string, Keypair>): SandboxBudgetChain {
  const keyFor = async (providerId: string): Promise<Keypair> => {
    const keypair = keys.get(providerId);
    if (!keypair) throw new Error("this provider's devnet key is not set");
    if (!(await isDevnetConnection(connection))) throw new Error("the server RPC is not devnet");
    return keypair;
  };
  const submit = async (transaction: Transaction, lastValidBlockHeight: number): Promise<string> => {
    const raw = transaction.serialize();
    const signature = bs58.encode(transaction.signature!);
    await connection.sendRawTransaction(raw, { preflightCommitment: "confirmed" });
    if ((await confirmByPolling(connection, signature, lastValidBlockHeight)) !== "confirmed") throw new Error("the transaction failed on devnet");
    return signature;
  };
  return {
    async readAccount(address) {
      const info = await connection.getAccountInfo(address, "confirmed");
      return info ? { owner: info.owner, data: new Uint8Array(info.data) } : null;
    },
    slot: async () => BigInt(await connection.getSlot("confirmed")),
    canSign: (providerId) => keys.has(providerId),
    async cosignAndSend(providerId, transaction) {
      const keypair = await keyFor(providerId);
      if (!transaction.feePayer?.equals(keypair.publicKey)) throw new Error("the reserve does not name this provider as fee payer");
      // The relay built the reserve on a blockhash it read; its validity is checked by the send.
      const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      transaction.partialSign(keypair);
      return submit(transaction, lastValidBlockHeight);
    },
    async send(providerId, instructions) {
      const keypair = await keyFor(providerId);
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(...instructions);
      transaction.sign(keypair);
      return submit(transaction, latest.lastValidBlockHeight);
    },
    async ensureRegistered(providerId, model, programId) {
      const keypair = await keyFor(providerId);
      const agent = PublicKey.findProgramAddressSync([AGENT_SEED, keypair.publicKey.toBytes()], programId)[0];
      const found = await connection.getAccountInfo(agent, "confirmed");
      if (found && found.owner.equals(programId)) return;
      const register = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: agent, isSigner: false, isWritable: true },
          { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: INCINERATOR, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: buildRegisterAgentData(AGENT_TYPE_ENUM.Primary, model, BigInt(0), 0),
      });
      await this.send(providerId, [register]);
      console.log(JSON.stringify({ source: "sandbox-budget", event: "sandbox_provider_registered", provider: providerId, agent: agent.toBase58() }));
    },
  };
}

export type SandboxBudgetDeps = {
  chain: SandboxBudgetChain;
  store: SandboxBudgetSliceStore;
  programId: PublicKey;
  /** Judges the sandbox providers accept on a Budget: the RAP judge, when its key is set. */
  acceptedJudges: PublicKey[];
  nowMs?: () => number;
  log?: (event: Record<string, unknown>) => void;
};

/** The Budget offer a sandbox provider makes for a call whose most it can cost is `maxCall`. SOL: the payout account is the provider's wallet. */
export function sandboxBudgetOffer(provider: SandboxProvider, programId: PublicKey, acceptedJudges: PublicKey[], maxCall: bigint, currentReserved = BigInt(0), budgetTotal?: bigint): PooledBudgetOffer {
  const floor = budgetTotal === undefined ? BigInt(0) : minReservation(budgetTotal);
  const want = currentReserved + maxCall * BigInt(SANDBOX_BUDGET_RESERVE_CALLS);
  const least = currentReserved + maxCall;
  return {
    scheme: "budget",
    network: DEVNET_GENESIS_HASH,
    programId: programId.toBase58(),
    payee: provider.payTo,
    payoutAccount: provider.payTo,
    mint: null,
    reservation: (want > floor ? want : floor).toString(),
    minReservation: (least > floor ? least : floor).toString(),
    acceptedJudges: acceptedJudges.map((j) => j.toBase58()),
    minOpenSlotsLeft: SANDBOX_BUDGET_MIN_OPEN_SLOTS.toString(),
  };
}

export type BudgetRefusal = { ok: false; status: number; code: string; message: string; offer?: PooledBudgetOffer; expectedSequence?: number };
export type AdmittedBudgetCall = { ok: true; budget: BudgetAccount; reservation: ReservationAccount; slice: SandboxBudgetSlice; budgetKey: PublicKey };

async function readBudget(budget: PublicKey, payee: PublicKey, deps: SandboxBudgetDeps): Promise<{ ok: true; budget: BudgetAccount; reservation: ReservationAccount | null } | BudgetRefusal> {
  let account;
  let reservationAccount;
  try {
    [account, reservationAccount] = await Promise.all([deps.chain.readAccount(budget), deps.chain.readAccount(reservationAddress(budget, payee, deps.programId))]);
  } catch {
    return { ok: false, status: 503, code: "payment_check_unavailable", message: "The Budget could not be read. Nothing was charged; send the call again." };
  }
  if (!account || !account.owner.equals(deps.programId)) return { ok: false, status: 402, code: "budget_not_found", message: "No Budget of the escrow program is at that address." };
  try {
    const decoded = decodeBudget(account.data);
    let reservation: ReservationAccount | null = null;
    if (reservationAccount) {
      if (!reservationAccount.owner.equals(deps.programId)) throw new Error("owner");
      reservation = decodeReservation(reservationAccount.data);
    }
    return { ok: true, budget: decoded, reservation };
  } catch {
    return { ok: false, status: 402, code: "budget_not_found", message: "That account is not a Budget of the escrow program." };
  }
}

/**
 * Checks a Budget-paid call: the Budget, the call number and the spender's
 * signature, reserving or raising the slice first when the call carries a
 * reserve. Returns the slice to serve from, or a refusal. Nothing is charged here.
 */
export async function admitSandboxBudgetCall(
  input: { provider: SandboxProvider; headers: { budget?: string | null; signature?: string | null; reserve?: string | null }; body: string; maxCall: bigint },
  deps: SandboxBudgetDeps,
): Promise<AdmittedBudgetCall | BudgetRefusal> {
  const { provider } = input;
  const payee = new PublicKey(provider.payTo);
  const offer = (current = BigInt(0), total?: bigint) => sandboxBudgetOffer(provider, deps.programId, deps.acceptedJudges, input.maxCall, current, total);
  if (!deps.chain.canSign(provider.id)) return { ok: false, status: 503, code: "provider_not_ready", message: `${provider.name} cannot take Budget calls right now. Nothing was charged.` };
  const header = readBudgetPaymentHeader(input.headers.budget ?? undefined);
  if (!header) return { ok: false, status: 402, code: "payment_required", message: "Name a Budget in x402-budget.", offer: offer() };
  if ("error" in header) return { ok: false, status: 400, code: "budget_invalid", message: header.error };

  let found = await readBudget(header.budget, payee, deps);
  if (!found.ok) return found;
  const key = header.budget.toBase58();
  let slice: SandboxBudgetSlice | undefined;
  try {
    slice = await deps.store.get(provider.id, key);
  } catch {
    return { ok: false, status: 503, code: "payment_check_unavailable", message: "This provider's ledger could not be read. Nothing was charged; send the call again." };
  }
  let carried: SandboxBudgetSlice | undefined;
  if (slice && slice.createdSlot !== header.createdSlot.toString()) {
    // An earlier Budget at this address. Its slice is settled by the sweep; this one starts fresh, on the same ledger row.
    if (slice.status !== "done") return { ok: false, status: 409, code: "budget_instance_mismatch", message: "This provider still holds a slice of an earlier Budget at this address. Try again once it is settled." };
    carried = slice;
    slice = undefined;
  }
  if (found.budget.createdSlot !== header.createdSlot) return { ok: false, status: 409, code: "budget_instance_mismatch", message: "That Budget was closed and opened again. Name the Budget as it is now." };

  const sequence = (slice?.sequence ?? 0) + 1;
  if (header.sequence !== sequence) return { ok: false, status: 409, code: "budget_sequence_mismatch", message: `This provider expects call ${sequence} of this budget next.`, expectedSequence: sequence };
  const auth = verifyPooledBudgetRequest({ genesisHash: DEVNET_GENESIS_HASH, action: "call", budget: header.budget, createdSlot: header.createdSlot, provider: payee, sequence, body: input.body, spender: found.budget.spender, p256Spender: found.budget.p256Spender, signatureHeader: input.headers.signature ?? undefined });
  if (!auth.ok) return { ok: false, status: 401, code: auth.reason, message: auth.message };

  const spent = BigInt(slice?.spent ?? "0");
  const reserveText = input.headers.reserve?.trim();
  if (reserveText) {
    const reservedNow = found.reservation && found.reservation.budgetCreatedSlot === found.budget.createdSlot ? found.reservation.reserved : BigInt(0);
    if (found.reservation && found.reservation.budgetCreatedSlot !== found.budget.createdSlot) {
      return { ok: false, status: 409, code: "budget_instance_mismatch", message: "This provider still holds a slice of an earlier Budget at this address. Try again once it is settled." };
    }
    const wanted = offer(spent > reservedNow ? spent : reservedNow, found.budget.total);
    const least = [BigInt(wanted.minReservation), minReservation(found.budget.total), spent + input.maxCall].reduce((a, b) => (a > b ? a : b));
    let slot: bigint;
    try {
      slot = await deps.chain.slot();
    } catch {
      return { ok: false, status: 503, code: "payment_check_unavailable", message: "The chain could not be read. Nothing was reserved or charged." };
    }
    const before = found.budget;
    const fits = (amount: bigint) => checkPooledBudgetForProvider({ budget: before, createdSlot: header.createdSlot, payee, mint: null, acceptedJudges: deps.acceptedJudges, slice: amount, reservedNow, hasReservation: reservedNow > BigInt(0), currentSlot: slot, minOpenSlotsLeft: SANDBOX_BUDGET_MIN_OPEN_SLOTS });
    const usable = fits(least);
    if (!usable.ok) return { ok: false, status: 402, code: usable.reason, message: usable.message };
    const checked = checkReserveTransaction({ transactionBase64: reserveText, programId: deps.programId, budget: header.budget, createdSlot: header.createdSlot, spender: found.budget.spender, payee, payoutAccount: payee, minAmount: least, maxAmount: BigInt(wanted.reservation), ...(found.budget.p256Spender ? { p256: { cluster: "devnet" as const } } : {}) });
    if (!checked.ok) return { ok: false, status: 402, code: checked.reason, message: checked.message, offer: wanted };
    const fitsAmount = fits(checked.amount);
    if (!fitsAmount.ok) return { ok: false, status: 402, code: fitsAmount.reason, message: fitsAmount.message };
    try {
      await deps.chain.ensureRegistered(provider.id, provider.model, deps.programId);
      const signature = await deps.chain.cosignAndSend(provider.id, checked.transaction);
      deps.log?.({ event: "sandbox_budget_reserved", provider: provider.id, budget: key, amount: checked.amount.toString(), signature });
    } catch (error) {
      deps.log?.({ event: "sandbox_budget_reserve_failed", provider: provider.id, budget: key, detail: error instanceof Error ? error.message : "unknown" });
      return { ok: false, status: 503, code: "budget_reserve_failed", message: "The reserve did not land. Nothing was charged; send the call again with a fresh reserve." };
    }
    found = await readBudget(header.budget, payee, deps);
    if (!found.ok) return found;
  }

  const r = found.reservation;
  if (!r || r.budgetCreatedSlot !== found.budget.createdSlot) return { ok: false, status: 402, code: "budget_reservation_required", message: "Reserve a slice of the Budget for this provider: send the call again with a spender-approved reserve in x402-budget-reserve.", offer: offer(BigInt(0), found.budget.total) };
  if (!r.payee.equals(payee)) return { ok: false, status: 402, code: "budget_reservation_required", message: "That reservation is not this provider's." };
  if (r.state !== "open" || (slice && slice.status !== "open")) return { ok: false, status: 409, code: "budget_slice_posted", message: "This provider has posted its total for this Budget and takes no more calls from it." };
  let slot: bigint;
  try {
    slot = await deps.chain.slot();
  } catch {
    return { ok: false, status: 503, code: "payment_check_unavailable", message: "The chain could not be read. Nothing was charged." };
  }
  // Enough time is kept before the open period ends to post the total, which the sweep does once this is reached.
  if (found.budget.closed || slot + SANDBOX_BUDGET_MIN_OPEN_SLOTS / BigInt(2) >= found.budget.openEnds) return { ok: false, status: 409, code: "budget_closing", message: "This Budget is closed or closing, so it takes no more calls." };
  if (spent + input.maxCall > r.reserved) return { ok: false, status: 402, code: "reservation_low", message: "What is left of this provider's slice may not cover this call. Raise it: send the call again with a spender-approved reserve for a higher total.", offer: offer(r.reserved, found.budget.total) };

  const current: SandboxBudgetSlice = slice ?? {
    provider: provider.id,
    budget: key,
    createdSlot: found.budget.createdSlot.toString(),
    payer: found.budget.payer.toBase58(),
    reserved: r.reserved.toString(),
    spent: "0",
    inputTokens: 0,
    outputTokens: 0,
    sequence: 0,
    lastCallMs: (deps.nowMs ?? Date.now)(),
    status: "open",
    // A fresh instance on an earlier Budget's row keeps counting that row's versions.
    version: carried?.version ?? 0,
  };
  return { ok: true, budget: found.budget, reservation: r, slice: { ...current, reserved: r.reserved.toString() }, budgetKey: header.budget };
}

/**
 * Records one served call: its cost, capped at what is left of the slice.
 * `conflict`: another call with the same number was recorded first, so this
 * answer must be withheld. `unavailable`: the ledger could not be written.
 */
export async function recordSandboxBudgetCall(
  slice: SandboxBudgetSlice,
  cost: bigint,
  tokens: { inputTokens: number; outputTokens: number },
  receiptHash: string,
  deps: Pick<SandboxBudgetDeps, "store" | "nowMs">,
): Promise<{ ok: true; slice: SandboxBudgetSlice; charged: bigint } | { ok: false; code: "conflict" | "unavailable" }> {
  const left = BigInt(slice.reserved) - BigInt(slice.spent);
  const charged = cost > left ? left : cost;
  const next: SandboxBudgetSlice = {
    ...slice,
    spent: (BigInt(slice.spent) + charged).toString(),
    inputTokens: slice.inputTokens + tokens.inputTokens,
    outputTokens: slice.outputTokens + tokens.outputTokens,
    sequence: slice.sequence + 1,
    lastReceiptHash: receiptHash,
    lastCallMs: (deps.nowMs ?? Date.now)(),
    version: slice.version + 1,
  };
  const written = await deps.store.put(next);
  return written === "ok" ? { ok: true, slice: next, charged } : { ok: false, code: written };
}

/**
 * Posts, closes and pays out what is due, for every slice or only the slices
 * of `onlyBudget`. One failure does not stop the rest.
 */
export async function settleDueSandboxBudgets(deps: SandboxBudgetDeps, onlyBudget?: string): Promise<{ provider: string; budget: string; status: string }[]> {
  let slices: SandboxBudgetSlice[];
  try {
    slices = await deps.store.due();
  } catch {
    return [];
  }
  const out: { provider: string; budget: string; status: string }[] = [];
  for (const slice of slices) {
    if (onlyBudget && slice.budget !== onlyBudget) continue;
    try {
      out.push({ provider: slice.provider, budget: slice.budget, status: await settleOne(slice, deps) });
    } catch (error) {
      deps.log?.({ event: "sandbox_budget_settle_failed", provider: slice.provider, budget: slice.budget, detail: error instanceof Error ? error.message : "unknown" });
      out.push({ provider: slice.provider, budget: slice.budget, status: "failed" });
    }
  }
  return out;
}

async function save(next: SandboxBudgetSlice, deps: SandboxBudgetDeps): Promise<void> {
  const written = await deps.store.put({ ...next, version: next.version + 1 });
  if (written !== "ok") throw new Error(`the ledger write was ${written}`);
}

async function settleOne(slice: SandboxBudgetSlice, deps: SandboxBudgetDeps): Promise<string> {
  const payee = payeeOf(slice.provider);
  const budgetKey = new PublicKey(slice.budget);
  const createdSlot = BigInt(slice.createdSlot);
  const found = await readBudget(budgetKey, payee, deps);
  if (!found.ok && found.code !== "budget_not_found") return "unreadable";
  const r = found.ok && found.budget.createdSlot === createdSlot ? found.reservation : null;
  const payer = new PublicKey(slice.payer);
  const pay = async () => {
    const signature = await deps.chain.send(slice.provider, [payoutInstruction({ programId: deps.programId, budget: budgetKey, createdSlot, payee, payer, treasury: ESCROW_PROTOCOL_TREASURY })]);
    deps.log?.({ event: "sandbox_budget_payout", provider: slice.provider, budget: slice.budget, signature });
    // Kept until the sweep sees the slice gone (a payout before the close keeps it on record as paid).
    await save({ ...slice, status: "posted", payoutSignature: signature }, deps);
    return "paid";
  };
  if (!found.ok || !r || r.budgetCreatedSlot !== createdSlot) {
    // The Budget is gone or opened again, or the slice was closed by a payout or a ruling. A slice paid
    // early may still hold its rent and block a reserve in a later Budget here: its payout closes it.
    const leftover = found.ok ? found.reservation : null;
    if (leftover && leftover.budgetCreatedSlot === createdSlot && leftover.state === "paid") {
      await deps.chain.send(slice.provider, [payoutInstruction({ programId: deps.programId, budget: budgetKey, createdSlot, payee, payer, treasury: ESCROW_PROTOCOL_TREASURY })]);
    }
    await save({ ...slice, status: "done" }, deps);
    return "done";
  }
  const budget = (found as { budget: BudgetAccount }).budget;
  const slot = await deps.chain.slot();
  if (slice.status === "open" && r.state === "open") {
    const ending = budget.closed || slot + SANDBOX_BUDGET_MIN_OPEN_SLOTS / BigInt(2) >= budget.openEnds;
    if (!ending) return "open";
    const amount = BigInt(slice.spent) > r.reserved ? r.reserved : BigInt(slice.spent);
    const signature = await deps.chain.send(slice.provider, [postFinalInstruction({ programId: deps.programId, budget: budgetKey, createdSlot, payee, amount })]);
    await save({ ...slice, status: "posted", posted: amount.toString(), postSignature: signature }, deps);
    deps.log?.({ event: "sandbox_budget_posted", provider: slice.provider, budget: slice.budget, amount: amount.toString(), signature });
    return "posted";
  }
  if (slice.status === "open") {
    await save({ ...slice, status: "posted" }, deps);
    slice = { ...slice, status: "posted", version: slice.version + 1 };
  }
  if (!budget.closed) {
    if (r.state === "paid") return "paid";
    if (slot < budget.openEnds) return r.waived && r.state === "posted" ? pay() : "posted";
    // The open period is over and nobody closed it: anyone may, and the dispute window starts then.
    await deps.chain.send(slice.provider, [closeBudgetInstruction({ programId: deps.programId, budget: budgetKey, createdSlot, signer: payee, payer: budget.payer })]);
    deps.log?.({ event: "sandbox_budget_closed", provider: slice.provider, budget: slice.budget });
    return "posted";
  }
  if (r.state === "paid" || (r.waived && r.state === "posted")) return pay();
  if (r.state === "disputed") {
    const ends = judgeEnds(budget, r);
    return ends !== null && slot >= ends ? pay() : "disputed";
  }
  const ends = disputeEnds(budget, r);
  return ends !== null && slot >= ends ? pay() : "posted";
}

function payeeOf(providerId: string): PublicKey {
  const provider = SANDBOX_PROVIDERS.find((p) => p.id === providerId);
  if (!provider) throw new Error(`unknown sandbox provider ${providerId}`);
  return new PublicKey(provider.payTo);
}
