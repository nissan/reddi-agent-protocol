/**
 * Pooled budgets, for a provider: join a buyer's budget with a slice, meter
 * calls against it, post what is owed once and collect the payout.
 *
 * One call goes:
 *
 * 1. `x402-budget` names the budget instance and the call number;
 *    `x402-budget-signature` is the budget's spender key over the call.
 * 2. No slice yet, or too little left in it: 402 with a budget offer. The
 *    agent's spender signs a `reserve` for the slice asked and sends it in
 *    `x402-budget-reserve` with the same call. The provider checks the budget
 *    (one-token rule, judge, allowlist, cap, time left) and that the
 *    transaction is exactly that reserve, then signs it as payee and fee
 *    payer and sends it. Raising a slice is the same call with a higher total.
 * 3. The call is served and its cost (capped at what is left of the slice) is
 *    recorded with its receipt before the answer is sent. Nothing moves on
 *    chain per call.
 *
 * The sweep (`settleDue`) posts each slice's total once, when its budget has
 * closed or its open period is about to end (a post may only go down later,
 * so the slice takes no calls after it); closes a budget whose open period
 * has ended (anyone may); and pays each posted slice out once it is waived or
 * its dispute window has ended, or once a judge's window has passed without a
 * ruling. A slice is never shown as paid until its payout has landed.
 *
 * Everything that could charge without serving fails closed: a budget or
 * reservation that cannot be read, a reserve that does not confirm, or a
 * ledger that cannot be written refuses the call before the model runs.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ESCROW_PROTOCOL_TREASURY, treasuryTokenAccount } from "@redditech/x402-solana";
import { closeBudgetInstruction, decodeBudget, decodeReservation, disputeEnds, judgeEnds, minReservation, payoutInstruction, postFinalInstruction, reservationAddress, type BudgetAccount, type ReservationAccount } from "@redditech/x402-solana/budget";
import { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER, checkPooledBudgetForProvider, checkReserveTransaction, readBudgetPaymentHeader, verifyPooledBudgetRequest, type PooledBudgetOffer } from "@redditech/x402-solana/budget-provider";
import type { ProviderChain } from "./chain.js";
import type { ProviderConfig } from "./config.js";
import type { PgPool } from "./postgres.js";
import { decodeState, encodeState } from "./state.js";

export { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER };

/** What the provider remembers of its slice of one budget. Amounts are base-unit strings. */
export interface BudgetSlice {
  budget: string;
  createdSlot: string;
  payer: string;
  spender: string;
  /** The slice's size on chain, as last read or reserved. */
  reserved: string;
  /** What the served calls cost, never more than `reserved`. */
  spent: string;
  inputTokens: number;
  outputTokens: number;
  /** Calls served. The next call must carry `sequence + 1`. */
  sequence: number;
  lastReceiptHash?: string;
  lastCallMs: number;
  /** `open`: taking calls. `posted`: total posted, waiting to be paid. `done`: paid out or refunded, or gone. */
  status: "open" | "posted" | "done";
  posted?: string;
  postSignature?: string;
  payoutSignature?: string;
}

export interface BudgetSliceStore {
  get(budget: string): Promise<BudgetSlice | undefined>;
  /** Durable before it resolves. */
  save(slice: BudgetSlice): Promise<void>;
  /** Every slice still `open` or `posted`. */
  due(): Promise<BudgetSlice[]>;
}

export class MemoryBudgetSliceStore implements BudgetSliceStore {
  private readonly slices = new Map<string, BudgetSlice>();
  async get(budget: string) {
    const s = this.slices.get(budget);
    return s ? { ...s } : undefined;
  }
  async save(slice: BudgetSlice) {
    this.slices.set(slice.budget, { ...slice });
  }
  async due() {
    return [...this.slices.values()].filter((s) => s.status !== "done").map((s) => ({ ...s }));
  }
}

/** One JSON line per change; the last line for a budget wins. Opened only by the process that holds the payment memory's lock. */
export class FileBudgetSliceStore implements BudgetSliceStore {
  private readonly slices = new Map<string, BudgetSlice>();
  private fd: number | undefined;
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const s = JSON.parse(line) as BudgetSlice;
          if (typeof s?.budget === "string" && typeof s.status === "string") this.slices.set(s.budget, s);
        } catch {
          // A line cut short by a crash: the one before it stands.
        }
      }
    }
    this.fd = openSync(path, "a", 0o600);
  }
  async get(budget: string) {
    const s = this.slices.get(budget);
    return s ? { ...s } : undefined;
  }
  async save(slice: BudgetSlice) {
    if (this.fd === undefined) throw new Error("the budget file is closed");
    appendFileSync(this.fd, `${JSON.stringify(slice)}\n`);
    fsyncSync(this.fd);
    this.slices.set(slice.budget, { ...slice });
  }
  async due() {
    return [...this.slices.values()].filter((s) => s.status !== "done").map((s) => ({ ...s }));
  }
  close() {
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
  }
}

/** Slices shared by every instance of one provider (table `provider_kit.budget_slices`). */
export class PostgresBudgetSliceStore implements BudgetSliceStore {
  constructor(private readonly pool: PgPool, private readonly provider: string) {}
  async get(budget: string) {
    const result = await this.pool.query("select record from provider_kit.budget_slices where provider = $1 and budget = $2", [this.provider, budget]);
    const text = result.rows[0]?.record;
    return typeof text === "string" ? decodeState<BudgetSlice>(text) : undefined;
  }
  async save(slice: BudgetSlice) {
    await this.pool.query(
      `insert into provider_kit.budget_slices (provider, budget, status, record, updated_at) values ($1, $2, $3, $4, now())
       on conflict (provider, budget) do update set status = excluded.status, record = excluded.record, updated_at = now()`,
      [this.provider, slice.budget, slice.status, encodeState(slice)],
    );
  }
  async due() {
    const result = await this.pool.query("select record from provider_kit.budget_slices where provider = $1 and status <> 'done' order by updated_at", [this.provider]);
    return result.rows.map((row) => decodeState<BudgetSlice>(String(row.record)));
  }
}

const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** An owner's associated token account for a mint. */
function associatedTokenAccount(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

/**
 * Creates `owner`'s associated token account for a mint if it is missing, with `funder` paying the rent;
 * does nothing (and costs no rent) when it already exists. The associated token program's CreateIdempotent.
 */
export function createAssociatedTokenAccountIdempotent(funder: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: funder, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAccount(owner, mint, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export type BudgetRead =
  | { ok: true; budget: BudgetAccount; reservation: ReservationAccount | null }
  | { ok: false; status: number; code: string; message: string };

export interface BudgetDeskDeps {
  chain: ProviderChain;
  store: BudgetSliceStore;
  /** The genesis hash buyers sign for. */
  genesisHash: string;
  nowMs: () => number;
  log: (event: Record<string, unknown>) => void;
  /** Called once a slice is settled and gone, before it is marked done; if it throws, the sweep tries again next time. */
  onBudgetDone?: (done: { budget: string; createdSlot: string }) => Promise<void>;
}

/** The provider's side of budgets, built once per handler. */
export function createBudgetDesk(config: ProviderConfig, deps: BudgetDeskDeps) {
  const { terms } = config;
  const payee = terms.payee;
  const payoutAccount = associatedTokenAccount(payee, terms.mint, terms.tokenProgram);
  // A payout or close fails if the provider's or the payer's token account is missing (the payer may
  // have closed theirs since locking), so each one first creates them if needed: the provider pays
  // the rent, and only for an account that does not exist yet.
  const ensureAccounts = (payer: PublicKey): TransactionInstruction[] => [
    createAssociatedTokenAccountIdempotent(payee, payee, terms.mint, terms.tokenProgram),
    createAssociatedTokenAccountIdempotent(payee, payer, terms.mint, terms.tokenProgram),
  ];

  /** The budget offer in a 402, for a call whose most it can cost is `maxCall`. `currentReserved` is the slice already held. */
  function offer(maxCall: bigint, currentReserved: bigint = 0n, budgetTotal?: bigint): PooledBudgetOffer {
    const want = currentReserved + maxCall * BigInt(config.budgets.reserveCalls);
    // The program refuses a reservation below 1% of the budget, so the floor is at least that once the budget is known.
    const onChainFloor = budgetTotal === undefined ? 0n : minReservation(budgetTotal);
    const floor = config.budgets.minReservationBaseUnits > onChainFloor ? config.budgets.minReservationBaseUnits : onChainFloor;
    return {
      scheme: "budget",
      network: deps.genesisHash,
      programId: terms.programId.toBase58(),
      payee: payee.toBase58(),
      payoutAccount: payoutAccount.toBase58(),
      mint: terms.mint.toBase58(),
      reservation: (want > floor ? want : floor).toString(),
      minReservation: (currentReserved + maxCall > floor ? currentReserved + maxCall : floor).toString(),
      acceptedJudges: config.budgets.acceptedJudges.map((j) => j.toBase58()),
      minOpenSlotsLeft: config.budgets.minOpenSlots.toString(),
    };
  }

  async function read(budget: PublicKey): Promise<BudgetRead> {
    let account: Awaited<ReturnType<ProviderChain["readAccount"]>>;
    let reservationAccount: Awaited<ReturnType<ProviderChain["readAccount"]>>;
    try {
      account = await deps.chain.readAccount(budget);
      reservationAccount = await deps.chain.readAccount(reservationAddress(budget, payee, terms.programId));
    } catch {
      return { ok: false, status: 503, code: "payment_check_unavailable", message: "The budget could not be read. Nothing was charged; send the call again." };
    }
    if (!account || !account.owner.equals(terms.programId)) return { ok: false, status: 402, code: "budget_not_found", message: "No budget of the escrow program is at that address." };
    let decoded: BudgetAccount;
    let reservation: ReservationAccount | null = null;
    try {
      decoded = decodeBudget(account.data);
      if (reservationAccount) {
        if (!reservationAccount.owner.equals(terms.programId)) throw new Error("owner");
        reservation = decodeReservation(reservationAccount.data);
      }
    } catch {
      return { ok: false, status: 402, code: "budget_not_found", message: "That account is not a budget of the escrow program." };
    }
    return { ok: true, budget: decoded, reservation };
  }

  /**
   * Checks a call's budget headers and its spender signature, reserving or
   * raising the slice first when the call carries a reserve. Returns the
   * budget, the reservation and the provider's slice, or a refusal.
   */
  async function admit(input: { headers: Headers; body: string; maxCall: bigint }): Promise<
    | { ok: true; budget: BudgetAccount; reservation: ReservationAccount; slice: BudgetSlice; budgetKey: PublicKey }
    | { ok: false; status: number; code: string; message: string; offer?: PooledBudgetOffer }
  > {
    const header = readBudgetPaymentHeader(input.headers.get(BUDGET_PAYMENT_HEADER) ?? undefined);
    if (!header) return { ok: false, status: 402, code: "payment_required", message: "Name a budget in x402-budget.", offer: offer(input.maxCall) };
    if ("error" in header) return { ok: false, status: 400, code: "budget_invalid", message: header.error };
    let found = await read(header.budget);
    if (!found.ok) return found;
    const key = header.budget.toBase58();
    let slice = await deps.store.get(key).catch(() => null);
    if (slice === null) return { ok: false, status: 503, code: "payment_check_unavailable", message: "This provider's ledger could not be read. Nothing was charged; send the call again." };
    if (slice && slice.createdSlot !== header.createdSlot.toString()) {
      // An earlier budget at this address. Its slice is settled by the sweep; this one starts fresh.
      if (slice.status === "open") return { ok: false, status: 409, code: "budget_instance_mismatch", message: "This provider still holds a slice of an earlier budget at this address. Try again once it is settled." };
      slice = undefined;
    }
    if (found.budget.createdSlot !== header.createdSlot) return { ok: false, status: 409, code: "budget_instance_mismatch", message: "That budget was closed and opened again. Name the budget as it is now." };

    // The spender's signature is checked before anything is signed or sent for this budget.
    const sequence = (slice?.sequence ?? 0) + 1;
    if (header.sequence !== sequence) return { ok: false, status: 409, code: "budget_sequence_mismatch", message: `This provider expects call ${sequence} of this budget next.` };
    const auth = verifyPooledBudgetRequest({ genesisHash: deps.genesisHash, action: "call", budget: header.budget, createdSlot: header.createdSlot, provider: payee, sequence, body: input.body, spender: found.budget.spender, signatureHeader: input.headers.get(BUDGET_SIGNATURE_HEADER) ?? undefined });
    if (!auth.ok) return { ok: false, status: 401, code: auth.reason, message: auth.message };

    const spent = BigInt(slice?.spent ?? "0");
    const reserveText = input.headers.get(BUDGET_RESERVE_HEADER);
    if (reserveText) {
      const reservedNow = found.reservation && found.reservation.budgetCreatedSlot === found.budget.createdSlot ? found.reservation.reserved : 0n;
      const wanted = offer(input.maxCall, spent > reservedNow ? spent : reservedNow, found.budget.total);
      const least = [BigInt(wanted.minReservation), minReservation(found.budget.total), spent + input.maxCall].reduce((a, b) => (a > b ? a : b));
      let slot: bigint;
      try {
        slot = await deps.chain.readSlot();
      } catch {
        return { ok: false, status: 503, code: "payment_check_unavailable", message: "The chain could not be read. Nothing was reserved or charged." };
      }
      const before = found.budget;
      const fitsBudget = (amount: bigint) => checkPooledBudgetForProvider({ budget: before, createdSlot: header.createdSlot, payee, mint: terms.mint, acceptedJudges: config.budgets.acceptedJudges, slice: amount, reservedNow, hasReservation: reservedNow > 0n, currentSlot: slot, minOpenSlotsLeft: config.budgets.minOpenSlots });
      // The budget itself is checked first (its token, judge, allowlist, time and funds), so a budget this provider cannot be paid from is refused as that.
      const usable = fitsBudget(least);
      if (!usable.ok) return { ok: false, status: 402, code: usable.reason, message: usable.message };
      const checked = checkReserveTransaction({ transactionBase64: reserveText, programId: terms.programId, budget: header.budget, createdSlot: header.createdSlot, spender: found.budget.spender, payee, payoutAccount, minAmount: least, maxAmount: BigInt(wanted.reservation) });
      if (!checked.ok) return { ok: false, status: 402, code: checked.reason, message: checked.message, offer: wanted };
      const fits = fitsBudget(checked.amount);
      if (!fits.ok) return { ok: false, status: 402, code: fits.reason, message: fits.message };
      if (!deps.chain.cosignAndSend) return { ok: false, status: 503, code: "provider_not_ready", message: "This provider cannot sign reserves. Nothing was reserved or charged." };
      const leftover = found.reservation;
      if (leftover && leftover.budgetCreatedSlot !== found.budget.createdSlot) {
        // This provider's reservation in an earlier budget at this address refuses the reserve until it is closed.
        if (leftover.state !== "paid") return { ok: false, status: 409, code: "budget_instance_mismatch", message: "This provider still holds a slice of an earlier budget at this address. Try again once it is settled." };
        try {
          // Closing a paid reservation moves only its rent, to this provider; the program does not check the payer account.
          await closePaid(header.budget, leftover, found.budget.payer);
        } catch {
          return { ok: false, status: 503, code: "payment_check_unavailable", message: "This provider's slice of an earlier budget at this address could not be closed. Nothing was reserved or charged; send the call again." };
        }
      }
      try {
        const signature = await deps.chain.cosignAndSend(checked.transaction);
        deps.log({ event: "budget_reserved", budget: key, amount: checked.amount.toString(), signature });
      } catch (error) {
        deps.log({ event: "budget_reserve_failed", budget: key, detail: error instanceof Error ? error.message : "unknown" });
        return { ok: false, status: 503, code: "budget_reserve_failed", message: "The reserve did not land. Nothing was charged; send the call again with a fresh reserve." };
      }
      found = await read(header.budget);
      if (!found.ok) return found;
    }

    const r = found.reservation;
    if (!r || r.budgetCreatedSlot !== found.budget.createdSlot) return { ok: false, status: 402, code: "budget_reservation_required", message: "Reserve a slice of the budget for this provider: send the call again with a spender-signed reserve in x402-budget-reserve.", offer: offer(input.maxCall, 0n, found.budget.total) };
    if (!r.payee.equals(payee)) return { ok: false, status: 402, code: "budget_reservation_required", message: "That reservation is not this provider's." };
    if (r.state !== "open" || (slice && slice.status !== "open")) return { ok: false, status: 409, code: "budget_slice_posted", message: "This provider has posted its total for this budget and takes no more calls from it." };
    let slot: bigint;
    try {
      slot = await deps.chain.readSlot();
    } catch {
      return { ok: false, status: 503, code: "payment_check_unavailable", message: "The chain could not be read. Nothing was charged." };
    }
    // Enough time is kept before the open period ends to post the total, which the sweep does once this is reached.
    if (found.budget.closed || slot + config.budgets.minOpenSlots / 2n >= found.budget.openEnds) return { ok: false, status: 409, code: "budget_closing", message: "This budget is closed or closing, so it takes no more calls." };
    if (spent + input.maxCall > r.reserved) return { ok: false, status: 402, code: "reservation_low", message: "What is left of this provider's slice may not cover this call. Raise it: send the call again with a spender-signed reserve for a higher total.", offer: offer(input.maxCall, r.reserved, found.budget.total) };

    const current: BudgetSlice = slice ?? {
      budget: key,
      createdSlot: found.budget.createdSlot.toString(),
      payer: found.budget.payer.toBase58(),
      spender: found.budget.spender.toBase58(),
      reserved: r.reserved.toString(),
      spent: "0",
      inputTokens: 0,
      outputTokens: 0,
      sequence: 0,
      lastCallMs: deps.nowMs(),
      status: "open",
    };
    current.reserved = r.reserved.toString();
    return { ok: true, budget: found.budget, reservation: r, slice: current, budgetKey: header.budget };
  }

  /** Records a served call. Throws when the ledger cannot be written: the answer is then withheld. */
  async function record(slice: BudgetSlice, cost: bigint, tokens: { inputTokens: number; outputTokens: number }, receiptHash: string): Promise<BudgetSlice> {
    const left = BigInt(slice.reserved) - BigInt(slice.spent);
    const charged = cost > left ? left : cost;
    const next: BudgetSlice = {
      ...slice,
      spent: (BigInt(slice.spent) + charged).toString(),
      inputTokens: slice.inputTokens + tokens.inputTokens,
      outputTokens: slice.outputTokens + tokens.outputTokens,
      sequence: slice.sequence + 1,
      lastReceiptHash: receiptHash,
      lastCallMs: deps.nowMs(),
    };
    await deps.store.save(next);
    return next;
  }

  /** Posts, closes and pays out what is due. One failure does not stop the rest. */
  async function settleDue(): Promise<{ budget: string; status: string }[]> {
    const out: { budget: string; status: string }[] = [];
    let slices: BudgetSlice[];
    try {
      slices = await deps.store.due();
    } catch {
      return out;
    }
    for (const slice of slices) {
      try {
        out.push({ budget: slice.budget, status: await settleOne(slice) });
      } catch (error) {
        deps.log({ event: "budget_settle_failed", budget: slice.budget, detail: error instanceof Error ? error.message : "unknown" });
        out.push({ budget: slice.budget, status: "failed" });
      }
    }
    return out;
  }

  async function readOwnReservation(budgetKey: PublicKey): Promise<ReservationAccount | null> {
    const account = await deps.chain.readAccount(reservationAddress(budgetKey, payee, terms.programId));
    return account && account.owner.equals(terms.programId) ? decodeReservation(account.data) : null;
  }

  /** Closes this provider's paid reservation, returning its rent; nothing else moves. `payer` is its budget's payer. */
  async function closePaid(budgetKey: PublicKey, reservation: ReservationAccount, payer: PublicKey): Promise<string> {
    const signature = await deps.chain.sendInstructions([...ensureAccounts(payer), payoutInstruction({ programId: terms.programId, budget: budgetKey, createdSlot: reservation.budgetCreatedSlot, payee, payer, treasury: ESCROW_PROTOCOL_TREASURY, token: { mint: terms.mint, payoutAccount, treasuryToken: treasuryTokenAccount(terms), refund: associatedTokenAccount(payer, terms.mint, terms.tokenProgram), tokenProgram: terms.tokenProgram } })]);
    deps.log({ event: "budget_reservation_closed", budget: budgetKey.toBase58(), createdSlot: reservation.budgetCreatedSlot.toString(), signature });
    return signature;
  }

  async function settleOne(slice: BudgetSlice): Promise<string> {
    const budgetKey = new PublicKey(slice.budget);
    const createdSlot = BigInt(slice.createdSlot);
    const found = await read(budgetKey);
    const sameInstance = found.ok && found.budget.createdSlot === createdSlot;
    const r = sameInstance && found.ok ? found.reservation : null;
    if (!found.ok && found.code !== "budget_not_found") return "unreadable";
    if (!found.ok || !sameInstance || !r || r.budgetCreatedSlot !== createdSlot) {
      // The budget is gone or opened again, or the slice was closed by a payout or a resolve. A slice
      // paid early may still be open, holding its rent and refusing a reserve in a later budget at this
      // address: its payout closes it.
      const leftover = found.ok ? found.reservation : await readOwnReservation(budgetKey);
      if (leftover && leftover.budgetCreatedSlot === createdSlot && leftover.state === "paid") await closePaid(budgetKey, leftover, new PublicKey(slice.payer));
      if (deps.onBudgetDone) await deps.onBudgetDone({ budget: slice.budget, createdSlot: slice.createdSlot });
      await deps.store.save({ ...slice, status: "done" });
      return "done";
    }
    const budget = (found as Extract<BudgetRead, { ok: true }>).budget;
    const slot = await deps.chain.readSlot();
    const send = (instructions: TransactionInstruction[]) => deps.chain.sendInstructions(instructions);

    if (slice.status === "open" && r.state === "open") {
      const ending = budget.closed || slot + config.budgets.minOpenSlots / 2n >= budget.openEnds;
      if (!ending) return "open";
      const amount = BigInt(slice.spent) > r.reserved ? r.reserved : BigInt(slice.spent);
      const signature = await send([postFinalInstruction({ programId: terms.programId, budget: budgetKey, createdSlot, payee, amount })]);
      await deps.store.save({ ...slice, status: "posted", posted: amount.toString(), postSignature: signature });
      deps.log({ event: "budget_posted", budget: slice.budget, amount: amount.toString(), signature });
      return "posted";
    }
    if (slice.status === "open") await deps.store.save({ ...slice, status: "posted" });

    if (!budget.closed) {
      // Paid early on a waiver: the slice stays on record as paid until the budget closes; nothing more to send.
      if (r.state === "paid") return "paid";
      if (slot < budget.openEnds) return r.waived && r.state === "posted" ? await payout(slice, budget, budgetKey, createdSlot) : "posted";
      // The open period is over and nobody closed it: anyone may, and the dispute window starts then.
      const refund = associatedTokenAccount(budget.payer, terms.mint, terms.tokenProgram);
      await send([createAssociatedTokenAccountIdempotent(payee, budget.payer, terms.mint, terms.tokenProgram), closeBudgetInstruction({ programId: terms.programId, budget: budgetKey, createdSlot, signer: payee, payer: budget.payer, token: { mint: terms.mint, refund, tokenProgram: terms.tokenProgram } })]);
      deps.log({ event: "budget_closed", budget: slice.budget });
      return "posted";
    }
    // Paid early: the payout call again, now the budget is closed, closes the slice and returns its rent.
    if (r.state === "paid") return payout(slice, budget, budgetKey, createdSlot);
    if (r.waived && r.state === "posted") return payout(slice, budget, budgetKey, createdSlot);
    if (r.state === "disputed") {
      const ends = judgeEnds(budget, r);
      return ends !== null && slot >= ends ? payout(slice, budget, budgetKey, createdSlot) : "disputed";
    }
    const ends = disputeEnds(budget, r);
    return ends !== null && slot >= ends ? payout(slice, budget, budgetKey, createdSlot) : "posted";
  }

  async function payout(slice: BudgetSlice, budget: BudgetAccount, budgetKey: PublicKey, createdSlot: bigint): Promise<string> {
    const refund = associatedTokenAccount(budget.payer, terms.mint, terms.tokenProgram);
    const signature = await deps.chain.sendInstructions([...ensureAccounts(budget.payer), payoutInstruction({
      programId: terms.programId,
      budget: budgetKey,
      createdSlot,
      payee,
      payer: budget.payer,
      treasury: ESCROW_PROTOCOL_TREASURY,
      token: { mint: terms.mint, payoutAccount, treasuryToken: treasuryTokenAccount(terms), refund, tokenProgram: terms.tokenProgram },
    })]);
    deps.log({ event: "budget_payout", budget: slice.budget, signature });
    // Kept until the sweep sees the slice gone (a payout before close keeps it as `paid`).
    await deps.store.save({ ...slice, status: "posted", payoutSignature: signature });
    return "paid";
  }

  return { offer, admit, record, settleDue, payoutAccount };
}

export type BudgetDesk = ReturnType<typeof createBudgetDesk>;
