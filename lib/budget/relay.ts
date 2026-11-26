/**
 * Server only. The agent's side of a Budget, run by the relay: an agent
 * sends an OpenAI-style chat call with its Budget key, and the relay pays
 * the provider it names from the Budget.
 *
 * One call goes:
 *
 * 1. The key (`<agentSecret>.<recordId>`, shown once on the Budget page)
 *    names the relay's record of the Budget. The secret is checked here and
 *    again by the Budget signer, which alone holds the spender key.
 * 2. The model names a provider the payer picked for this Budget, paid in
 *    the Budget's token (`./providers`).
 * 3. The signer signs the call (`budgetRequestMessage`: Budget, provider,
 *    call number, body hash) and the relay sends it to the provider with
 *    `x402-budget` and `x402-budget-signature`.
 * 4. A provider with no slice yet, or too little left, answers 402 with a
 *    Budget offer. The relay checks the offer (this program, this payee,
 *    the Budget's token, the provider's own payout account), has the signer
 *    approve a reserve of at most the payer's per-provider maximum, and sends
 *    the same call again with that reserve in `x402-budget-reserve`. The
 *    provider signs and pays for the reserve; the relay pays nothing.
 * 5. The provider's answer and receipt go back to the agent as they came,
 *    with `x-rap-budget-charged` saying whether the call was charged:
 *    `true` for a served call (and, when the provider's receipt verifies for
 *    this slice and this body, the slice's running cost and the served call's
 *    count from it), `false` only when the relay knows the provider did not
 *    serve, and `unknown` once the call reached the provider and the answer
 *    did not come back whole (audit 1079ce8 S2-claude-03).
 *
 * The signer numbers each call itself (`signCallAsSpender`): neither the relay
 * nor a provider picks a call number, and no number is signed twice.
 *
 * A provider that keeps asking for a bigger slice gets one approval at a
 * time: none while its slice is at the payer's per-provider maximum, none
 * within `RESERVE_BACKOFF_MS` of the last one, and none once it has left
 * `RESERVE_MAX_UNLANDED` reserves in a row unused (audit 2026-11-25, bbe1828
 * M-b). Only a reserve the relay actually handed to the provider counts as
 * a strike: a signer refusal, a full approval ceiling or a chain read that
 * failed is the relay's side, not the provider's, and strikes are forgotten
 * after `RESERVE_STRIKE_TTL_MS` (audit 1079ce8 S7-claude-01, S2-claude-02).
 * Each approval is for what the provider offered (`reservation`, within the
 * per-provider maximum), never more, since a provider-kit provider refuses a
 * reserve above its offer (S7-claude-02). Tiny raises stay bounded by the
 * backoff and by the signer's approval count per Budget.
 *
 * The spender key is a KMS key in the signer project, and every approval and
 * call it signs is counted and limited there. The main app still holds keys
 * that move devnet money for the SOL sandbox providers it runs itself (their
 * payee wallets, slice ledger and payout cron, `lib/sandbox/budget-desk.ts`);
 * a mainnet version must run those apart from the relay.
 */

import { createHash, timingSafeEqual } from "crypto";
import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER, type PooledBudgetOffer } from "@redditech/x402-solana/budget-provider";
import { sessionBodyHash } from "@redditech/x402-solana/session-auth";
import { reservationAddress } from "@redditech/x402-solana/budget";
import type { ApprovalRequest, Approved, CallRequest, CustodyFailure, SignedCall } from "./custody";
import { budgetProviderDirectory, type BudgetProvider } from "./providers";
import { readSliceReceipt } from "./judge/receipts";
import { GENESIS_HASH, type BudgetCustodyStore, type BudgetNetwork, type SpenderRecord } from "./store";

const HEX32 = /^[0-9a-f]{32}$/;
const SECRET = /^rap_budget_[A-Za-z0-9_-]{20,100}$/;
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** A reserve with its approval measures well under this; the provider refuses more than 60,000. */
export const RESERVE_COMPUTE_UNITS = 60_000;
/** The most a relayed call's body may be. */
export const RELAY_MAX_BODY_BYTES = 32_768;
/** Per-call provider timeout: model calls can be slow. */
export const PROVIDER_TIMEOUT_MS = 120_000;
/** The whole relayed call, every provider round included, ends within this (the route allows 300 s). */
export const RELAY_DEADLINE_MS = 260_000;
/** The most of a provider's answer the relay reads and passes on. */
export const PROVIDER_MAX_ANSWER_BYTES = 1_048_576;
/** No second reserve approval for a provider within this time of the last. */
export const RESERVE_BACKOFF_MS = 60_000;
/** Reserves a provider may leave unused in a row before the relay approves no more for it (until the strikes expire). */
export const RESERVE_MAX_UNLANDED = 3;
/** Strikes older than this are forgotten, so a provider shut out by a bad hour can be paid again. */
export const RESERVE_STRIKE_TTL_MS = 60 * 60_000;
/** The response header that says whether this call was charged: `true`, `false` or `unknown`. */
export const CHARGED_HEADER = "x-rap-budget-charged";
/** The slice's running cost after this call, in base units, from the provider's verified receipt. */
export const SLICE_COST_HEADER = "x-rap-budget-slice-cost";
/** Calls this provider has served from the slice, from the same receipt. */
export const SLICE_CALLS_HEADER = "x-rap-budget-slice-calls";
/** Signer refusals that mean "not now": a shared ceiling is full. The agent waits and retries; nothing was charged. */
const SIGNER_BUSY = new Set(["global_overuse", "global_overuse_new", "payer_overuse", "key_overuse"]);
/** Signer refusals that mean a part of the relay is down. */
const SIGNER_DOWN = new Set(["signer_unavailable", "chain_unavailable", "store_unavailable", "kms_unavailable"]);
/** How long the agent is told to wait when a shared ceiling is full. */
export const CEILING_RETRY_SECONDS = 60;

/** What a provider sent back, passed to the agent as is. */
export type ProviderAnswer = { status: number; headers: Record<string, string>; bodyText: string };

export type RelayDeps = {
  store: BudgetCustodyStore;
  programId: PublicKey;
  env?: Record<string, string | undefined>;
  /** Sends the call to the provider with the given headers, giving up after `timeoutMs`. */
  callProvider(provider: BudgetProvider, bodyText: string, headers: Record<string, string>, timeoutMs: number): Promise<ProviderAnswer>;
  /** The provider's slice of this Budget instance on chain: what is reserved, 0 when it has none. */
  reservedOnChain(budget: string, createdSlot: bigint, payee: string): Promise<bigint>;
  nowMs?: () => number;
  signCall(input: { id: string; agentSecret: string; call: CallRequest; caller?: string; expect: { budget: string; createdSlot: bigint; spender: string; network: BudgetNetwork } }): Promise<SignedCall | CustodyFailure>;
  approve(input: { id: string; agentSecret: string; request: ApprovalRequest; caller?: string }): Promise<Approved | CustodyFailure>;
  /** A recent blockhash of the Budget's cluster, for the reserve the provider signs. */
  blockhash(): Promise<string>;
  /**
   * Keeps the provider's signed receipt of a served call, the evidence the RAP
   * judge weighs if the payer disputes the slice (`lib/budget/judge`). Best
   * effort: a receipt that cannot be kept never fails the call.
   */
  saveReceipt?(input: { budget: string; createdSlot: string; payee: string; receipt: string }): Promise<boolean>;
};

/** Response headers that carry a provider's signed receipt: the provider kit's, then the sandbox providers'. */
export const RECEIPT_HEADERS = ["x-reddi-provider-receipt", "x-reddi-budget-receipt"] as const;

/** The provider's receipt header of an answer, if it sent one of a sane size. */
export function receiptOf(headers: Record<string, string>): string | undefined {
  for (const name of RECEIPT_HEADERS) {
    const value = Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];
    if (typeof value === "string" && value.length > 0 && value.length <= 8192 && /^[A-Za-z0-9_-]+$/.test(value)) return value;
  }
  return undefined;
}

export type RelayResult = ProviderAnswer;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

/**
 * A refusal the relay writes itself. `charged` is false when the call never
 * reached the provider (or the provider was only asked for a reserve), and
 * "unknown" once the call went to the provider and its answer was lost.
 */
function refuse(status: number, code: string, message: string, extra: Record<string, unknown> = {}, charged: false | "unknown" = false, headers: Record<string, string> = {}): RelayResult {
  const result = { status, headers: { ...JSON_HEADERS, ...headers, [CHARGED_HEADER]: String(charged) }, bodyText: JSON.stringify({ error: { code, message }, charged, ...extra }) };
  RELAY_MADE.add(result);
  return result;
}

/** Answers the relay wrote itself, told apart by identity: a provider cannot forge one with a header. */
const RELAY_MADE = new WeakSet<object>();

/** A refusal by the signer, as the agent should read it: a full ceiling is a wait (429), a part that is down a retry (503). */
function signerRefusal(failure: CustodyFailure): RelayResult {
  if (SIGNER_BUSY.has(failure.code)) return refuse(429, failure.code, failure.message, {}, false, { "retry-after": String(CEILING_RETRY_SECONDS) });
  return refuse(SIGNER_DOWN.has(failure.code) ? 503 : 402, failure.code, failure.message);
}

/** Splits `<agentSecret>.<recordId>`. */
export function parseBudgetKey(value: string | null | undefined): { id: string; agentSecret: string } | undefined {
  const raw = value?.trim().replace(/^Bearer\s+/i, "");
  if (!raw) return undefined;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return undefined;
  const agentSecret = raw.slice(0, dot);
  const id = raw.slice(dot + 1);
  return HEX32.test(id) && SECRET.test(agentSecret) ? { id, agentSecret } : undefined;
}

function secretMatches(record: SpenderRecord, secret: string): boolean {
  if (!record.agentSecretSha256) return false;
  const a = createHash("sha256").update(secret).digest();
  const b = Buffer.from(record.agentSecretSha256, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function associatedTokenAccount(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

function readJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function errorCode(answer: ProviderAnswer): { code?: string; body?: Record<string, unknown> } {
  const body = readJson(answer.bodyText);
  const error = body?.error as { code?: unknown } | undefined;
  return { body, code: typeof error?.code === "string" ? error.code : undefined };
}

/** The provider for a call: by model or id, among those the payer named, in the Budget's token. */
export function pickProvider(record: SpenderRecord, model: string, env?: Record<string, string | undefined>): BudgetProvider | { code: string; message: string } {
  const token = record.mint ? "USDC" : "SOL";
  const named = budgetProviderDirectory(env).filter((p) => record.expectedPayees.includes(p.payee) && p.token === token);
  const provider = named.find((p) => p.model === model || p.id === model);
  if (provider) return provider;
  const list = named.map((p) => `${p.model} (${p.name})`).join(", ");
  return { code: "provider_not_in_budget", message: `This Budget pays only the providers its payer picked: ${list || "none that are available"}.` };
}

/**
 * Checks a provider's Budget offer before anything is approved for it: our
 * program, this provider as payee, the Budget's token, and the provider's
 * own payout account (its wallet for SOL, its associated token account for a token).
 */
export function checkOffer(offer: unknown, input: { provider: BudgetProvider; record: SpenderRecord; programId: PublicKey }): PooledBudgetOffer | string {
  if (!offer || typeof offer !== "object") return "The provider asked for a slice without a Budget offer.";
  const o = offer as Partial<PooledBudgetOffer>;
  if (o.scheme !== "budget") return "The provider's offer is not a Budget offer.";
  if (o.network !== GENESIS_HASH[input.record.network]) return "The provider's offer is for another cluster.";
  if (o.programId !== input.programId.toBase58()) return "The provider's offer names another program.";
  if (o.payee !== input.provider.payee) return "The provider's offer names another payee.";
  const mint = input.record.mint ?? null;
  if ((o.mint ?? null) !== mint) return "The provider is not paid in this Budget's token.";
  const payout = mint ? associatedTokenAccount(new PublicKey(input.provider.payee), new PublicKey(mint)).toBase58() : input.provider.payee;
  if (o.payoutAccount !== payout) return "The provider's offer pays into an account that is not its own.";
  if (typeof o.reservation !== "string" || !/^\d{1,20}$/.test(o.reservation) || typeof o.minReservation !== "string" || !/^\d{1,20}$/.test(o.minReservation)) return "The provider's offer has no amounts.";
  return o as PooledBudgetOffer;
}

/** The reserve the provider co-signs and pays for: a compute limit, the spender's approval, then the reserve. */
export function reserveTransaction(payee: PublicKey, blockhash: string, approved: [TransactionInstruction, TransactionInstruction]): string {
  const tx = new Transaction({ feePayer: payee, recentBlockhash: blockhash });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: RESERVE_COMPUTE_UNITS }), ...approved);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

type ReserveState = NonNullable<SpenderRecord["reserves"]>[string];

/** Writes this provider's reserve bookkeeping on the record (version-checked, a few tries). */
async function saveReserveState(store: BudgetCustodyStore, id: string, payee: string, state: ReserveState): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.byId(id);
    if (!current) return false;
    const written = await store.update({ ...current, reserves: { ...(current.reserves ?? {}), [payee]: state }, version: current.version + 1 });
    if (written.ok) return true;
    if (written.code === "store_unavailable") return false;
  }
  return false;
}

/**
 * Relays one agent call paid from a Budget. `bodyText` is the agent's JSON
 * body: `model` names the provider, the rest goes to it unchanged.
 */
export async function relayBudgetCall(input: { key: string | null; bodyText: string; caller?: string }, deps: RelayDeps): Promise<RelayResult> {
  const key = parseBudgetKey(input.key);
  if (!key) return refuse(401, "budget_key_required", "Send your Budget key as Authorization: Bearer <key>. The Budget page shows it once, when the Budget is opened.");
  if (Buffer.byteLength(input.bodyText, "utf8") > RELAY_MAX_BODY_BYTES) return refuse(413, "invalid_request", "The request body is too large.");
  const body = readJson(input.bodyText);
  if (!body || typeof body.model !== "string") return refuse(400, "invalid_request", "Send a JSON chat request whose model names one of your Budget's providers.");
  if (body.stream === true) return refuse(400, "invalid_request", "Budget calls do not stream. Send the request without stream.");

  let record: SpenderRecord | undefined;
  try {
    record = await deps.store.byId(key.id);
  } catch {
    return refuse(503, "store_unavailable", "The relay could not read this Budget. Nothing was charged; try again.");
  }
  if (!record || !secretMatches(record, key.agentSecret)) return refuse(401, "budget_key_invalid", "That Budget key is not valid.");
  if (record.status === "pending" || !record.budget || !record.createdSlot) return refuse(409, "budget_not_open", "This Budget is not open yet. It opens once its transaction is finalized, usually within a minute.");
  if (record.status !== "open") return refuse(409, "budget_not_open", `This Budget is ${record.status}: it pays no more calls.`);

  const provider = pickProvider(record, body.model, deps.env);
  if ("code" in provider) return refuse(400, provider.code, provider.message);
  const forwarded = JSON.stringify({ ...body, model: provider.model });
  const bodyHash = sessionBodyHash(forwarded);
  const expect = { budget: record.budget, createdSlot: BigInt(record.createdSlot), spender: record.spender, network: record.network };

  const now = deps.nowMs ?? Date.now;
  const deadline = now() + RELAY_DEADLINE_MS;
  const send = async (headers: Record<string, string>): Promise<ProviderAnswer | RelayResult> => {
    const left = deadline - now();
    if (left < 5_000) return refuse(504, "relay_timeout", `${provider.name} took too long. Try again.`);
    try {
      const answer = await deps.callProvider(provider, forwarded, headers, Math.min(PROVIDER_TIMEOUT_MS, left));
      if (Buffer.byteLength(answer.bodyText, "utf8") > PROVIDER_MAX_ANSWER_BYTES) {
        return refuse(502, "provider_answer_too_large", `${provider.name} sent back more than the relay passes on. It may have charged for the call: check your Budget before you retry.`, {}, "unknown");
      }
      return answer;
    } catch {
      // The call may have reached the provider and been served before the answer was lost.
      return refuse(502, "provider_unreachable", `${provider.name} could not be reached, or took too long. It may have charged for the call: check your Budget before you retry.`, {}, "unknown");
    }
  };

  // One signature for this call: the signer gives it the next number. A reserve round resends the same headers.
  const signed = await deps.signCall({ id: key.id, agentSecret: key.agentSecret, call: { payee: provider.payee, bodyHash }, ...(input.caller ? { caller: input.caller } : {}), expect });
  if (!signed.ok) return signerRefusal(signed);
  const headers = {
    [BUDGET_PAYMENT_HEADER]: Buffer.from(JSON.stringify({ budget: expect.budget, createdSlot: record.createdSlot, sequence: signed.sequence })).toString("base64"),
    [BUDGET_SIGNATURE_HEADER]: Buffer.concat([Buffer.from(signed.publicKey), Buffer.from(signed.signature)]).toString("base64"),
  };
  let answer = await send(headers);
  const { code, body: refusal } = errorCode(answer);
  if (answer.status === 402 && (code === "budget_reservation_required" || code === "reservation_low")) {
    const at = now();
    const reserve = await approveReserve(refusal?.budget, { key, record, provider, caller: input.caller, now: at }, deps);
    if ("status" in reserve) return reserve;
    answer = await send({ ...headers, [BUDGET_RESERVE_HEADER]: reserve.transaction });
    // A provider that says plainly it cannot take a reserve now (its own reserve or rent limits, kit 0.4.1)
    // did not leave it unused: that is not a strike.
    const { code: after } = errorCode(answer);
    if (!isRelayRefusal(answer) && after && PROVIDER_CANNOT_RESERVE.has(after)) await unhand(deps.store, record.id, provider.payee, at);
  }
  if (isRelayRefusal(answer)) return answer;
  const receipt = answer.status === 200 ? receiptOf(answer.headers) : undefined;
  if (receipt && deps.saveReceipt) await deps.saveReceipt({ budget: expect.budget, createdSlot: record.createdSlot, payee: provider.payee, receipt }).catch(() => false);
  const charged = chargeOf(answer, receipt, { record, provider, programId: deps.programId, bodyHash });
  return { status: answer.status, headers: { ...passHeaders(answer.headers), "x-rap-budget-provider": provider.id, ...charged }, bodyText: answer.bodyText };
}

/** Provider refusals of a handed reserve that are about its own limits, not a reserve left unused (provider kit 0.4.1). */
const PROVIDER_CANNOT_RESERVE = new Set(["budget_reserve_limit", "provider_budget_slots_full"]);

/** Marks the reserve approved at `approvedAt` as not taken up by the provider's choice, so it is no strike. */
async function unhand(store: BudgetCustodyStore, id: string, payee: string, approvedAt: number): Promise<void> {
  const current = await store.byId(id).catch(() => undefined);
  const state = current?.reserves?.[payee];
  if (state && state.approvedAt === approvedAt && state.handed !== false) await saveReserveState(store, id, payee, { ...state, handed: false });
}

/** True for an answer the relay wrote itself (it already carries the charged header), not the provider's. */
function isRelayRefusal(answer: ProviderAnswer): boolean {
  return RELAY_MADE.has(answer);
}

/**
 * What the agent is told about the charge for an answer the provider sent.
 * A 2xx was served and charged; the amount comes from the provider's receipt
 * only when it verifies for this slice and answers this exact body. A 4xx is
 * the provider refusing before it served. Anything else may or may not have
 * been charged.
 */
export function chargeOf(
  answer: ProviderAnswer,
  receipt: string | undefined,
  ctx: { record: SpenderRecord; provider: BudgetProvider; programId: PublicKey; bodyHash: string },
): Record<string, string> {
  if (answer.status >= 400 && answer.status < 500) return { [CHARGED_HEADER]: "false" };
  if (answer.status < 200 || answer.status >= 300) return { [CHARGED_HEADER]: "unknown" };
  const out: Record<string, string> = { [CHARGED_HEADER]: "true" };
  if (!receipt || !ctx.record.budget || !ctx.record.createdSlot) return out;
  const reading = readSliceReceipt(receipt, {
    network: ctx.record.network,
    budget: ctx.record.budget,
    createdSlot: ctx.record.createdSlot,
    reservation: reservationAddress(new PublicKey(ctx.record.budget), new PublicKey(ctx.provider.payee), ctx.programId).toBase58(),
    payee: ctx.provider.payee,
    payer: ctx.record.payer,
  });
  if (!reading.ok || reading.receipt.requestHash !== ctx.bodyHash) return out;
  return { ...out, [SLICE_COST_HEADER]: reading.receipt.cumulativeCost.toString(), [SLICE_CALLS_HEADER]: String(reading.receipt.served) };
}

/**
 * Has the signer approve a bigger slice for a provider that asked for one,
 * within the payer's per-provider maximum and the rules in the header above.
 * Answers the reserve transaction for the provider, or a refusal for the agent.
 */
async function approveReserve(
  rawOffer: unknown,
  ctx: { key: { id: string; agentSecret: string }; record: SpenderRecord; provider: BudgetProvider; caller?: string; now: number },
  deps: RelayDeps,
): Promise<{ transaction: string } | RelayResult> {
  const { key, record, provider } = ctx;
  const offer = checkOffer(rawOffer, { provider, record, programId: deps.programId });
  if (typeof offer === "string") return refuse(502, "provider_offer_refused", offer);
  const max = BigInt(record.maxReserve ?? "0");
  let reserved: bigint;
  try {
    reserved = await deps.reservedOnChain(record.budget!, BigInt(record.createdSlot!), provider.payee);
  } catch {
    return refuse(503, "chain_unavailable", "The relay could not read the chain. Nothing was charged; try again.");
  }
  if (reserved >= max) return refuse(402, "budget_share_used", `${provider.name} already holds the most this Budget gives one provider.`);
  // The latest bookkeeping, not the copy read when this call began: another call may have just been approved.
  const fresh = await deps.store.byId(record.id).catch(() => undefined);
  const prev = (fresh ?? record).reserves?.[provider.payee];
  // Strikes expire: bookkeeping older than the TTL starts over.
  const live = prev && ctx.now - prev.approvedAt < RESERVE_STRIKE_TTL_MS ? prev : undefined;
  // A reserve handed to the provider since which the slice has not grown went unused: one strike.
  // An approval that never reached the provider (signer or chain failure) is not the provider's doing.
  const strikes = live && live.reservedBefore === reserved.toString() ? live.unlanded + (live.handed === false ? 0 : 1) : 0;
  const notReserving = () => refuse(402, "provider_not_reserving", `${provider.name} was handed reserves it did not take. This Budget approves no more for it for now; use another provider or try again in an hour.`);
  if (live && live.unlanded >= RESERVE_MAX_UNLANDED) return notReserving();
  if (live && ctx.now - live.approvedAt < RESERVE_BACKOFF_MS) {
    const wait = String(Math.ceil((RESERVE_BACKOFF_MS - (ctx.now - live.approvedAt)) / 1000));
    return refuse(429, "reserve_backoff", `${provider.name} was given a bigger slice moments ago. Try again shortly.`, {}, false, { "retry-after": wait });
  }
  if (strikes >= RESERVE_MAX_UNLANDED) {
    await saveReserveState(deps.store, record.id, provider.payee, { ...live!, unlanded: strikes });
    return notReserving();
  }
  // What the provider offered, within the payer's per-provider maximum: a kit provider refuses more than it offered.
  const wanted = BigInt(offer.reservation);
  const amount = wanted > max ? max : wanted;
  if (amount < BigInt(offer.minReservation)) return refuse(402, "budget_share_too_small", `${provider.name} needs a share of at least ${offer.minReservation} base units for this call, more than this Budget allows each provider.`);
  if (amount <= reserved) return refuse(502, "provider_offer_refused", `${provider.name} asked for a reserve no bigger than the share it already holds.`);
  // Written before asking, so the backoff holds even if this call dies after the approval; not yet a strike.
  if (!(await saveReserveState(deps.store, record.id, provider.payee, { approvedAt: ctx.now, reservedBefore: reserved.toString(), unlanded: strikes, handed: false }))) {
    return refuse(503, "store_unavailable", "The relay could not record the approval. Nothing was charged; try again.");
  }
  const approved = await deps.approve({ id: key.id, agentSecret: key.agentSecret, request: { purpose: "reserve", payee: provider.payee, amount, payoutAccount: offer.payoutAccount }, ...(ctx.caller ? { caller: ctx.caller } : {}) });
  if (!approved.ok) return signerRefusal(approved);
  let blockhash: string;
  try {
    blockhash = await deps.blockhash();
  } catch {
    return refuse(503, "chain_unavailable", "The relay could not read the chain. Nothing was charged; try again.");
  }
  const transaction = reserveTransaction(new PublicKey(provider.payee), blockhash, approved.instructions);
  // From here the reserve is the provider's to take: if its slice does not grow, the next raise counts a strike.
  // Best effort: a lost write only means one strike fewer, never a call refused.
  await saveReserveState(deps.store, record.id, provider.payee, { approvedAt: ctx.now, reservedBefore: reserved.toString(), unlanded: strikes, handed: true });
  return { transaction };
}

/** The provider's headers the agent gets: content type, retry advice and receipts, nothing else. */
function passHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { "cache-control": "no-store" };
  for (const [name, value] of Object.entries(headers)) {
    const n = name.toLowerCase();
    if (n === "content-type" || n === "retry-after" || n.startsWith("x-reddi-") || n.startsWith("x402-receipt")) out[n] = value;
  }
  if (!out["content-type"]) out["content-type"] = "application/json; charset=utf-8";
  return out;
}
