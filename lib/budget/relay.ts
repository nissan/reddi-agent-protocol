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
 * 5. The provider's answer and receipt go back to the agent as they came.
 *
 * The relay never holds a key that moves money: the spender is a KMS key in
 * the signer project, and every approval and call it signs is counted and
 * limited there.
 */

import { createHash, timingSafeEqual } from "crypto";
import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER, type PooledBudgetOffer } from "@redditech/x402-solana/budget-provider";
import { sessionBodyHash } from "@redditech/x402-solana/session-auth";
import type { ApprovalRequest, Approved, CallRequest, CustodyFailure, SignedCall } from "./custody";
import { budgetProviderDirectory, type BudgetProvider } from "./providers";
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

/** What a provider sent back, passed to the agent as is. */
export type ProviderAnswer = { status: number; headers: Record<string, string>; bodyText: string };

export type RelayDeps = {
  store: BudgetCustodyStore;
  programId: PublicKey;
  env?: Record<string, string | undefined>;
  /** Sends the call to the provider with the given headers. */
  callProvider(provider: BudgetProvider, bodyText: string, headers: Record<string, string>): Promise<ProviderAnswer>;
  signCall(input: { id: string; agentSecret: string; call: CallRequest; caller?: string; expect: { budget: string; createdSlot: bigint; spender: string; network: BudgetNetwork } }): Promise<SignedCall | CustodyFailure>;
  approve(input: { id: string; agentSecret: string; request: ApprovalRequest; caller?: string }): Promise<Approved | CustodyFailure>;
  /** A recent blockhash of the Budget's cluster, for the reserve the provider signs. */
  blockhash(): Promise<string>;
};

export type RelayResult = ProviderAnswer;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function refuse(status: number, code: string, message: string, extra: Record<string, unknown> = {}): RelayResult {
  return { status, headers: { ...JSON_HEADERS }, bodyText: JSON.stringify({ error: { code, message }, charged: false, ...extra }) };
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

async function rememberCalls(store: BudgetCustodyStore, id: string, payee: string, served: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.byId(id);
    if (!current) return;
    if ((current.calls?.[payee] ?? 0) >= served) return;
    const written = await store.update({ ...current, calls: { ...(current.calls ?? {}), [payee]: served }, version: current.version + 1 });
    if (written.ok || written.code === "store_unavailable") return;
  }
}

function expectedSequence(body: Record<string, unknown> | undefined): number | undefined {
  if (typeof body?.expectedSequence === "number" && Number.isSafeInteger(body.expectedSequence) && body.expectedSequence > 0) return body.expectedSequence;
  // The provider kit says it in words: "This provider expects call N of this budget next."
  const message = (body?.error as { message?: unknown } | undefined)?.message;
  const match = typeof message === "string" ? /expects call (\d{1,7}) /.exec(message) : null;
  return match ? Number(match[1]) : undefined;
}

/**
 * Relays one agent call paid from a Budget. `bodyText` is the agent's JSON
 * body: `model` names the provider, the rest goes to it unchanged.
 */
export async function relayBudgetCall(input: { key: string | null; bodyText: string; caller?: string }, deps: RelayDeps): Promise<RelayResult> {
  const key = parseBudgetKey(input.key);
  if (!key) return refuse(401, "budget_key_required", "Send your Budget key as Authorization: Bearer <key>. The Budget page shows it once, when the Budget is opened.");
  if (input.bodyText.length > RELAY_MAX_BODY_BYTES) return refuse(413, "invalid_request", "The request body is too large.");
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

  const sign = async (sequence: number): Promise<{ ok: true; headers: Record<string, string> } | { ok: false; result: RelayResult }> => {
    const signed = await deps.signCall({ id: key.id, agentSecret: key.agentSecret, call: { payee: provider.payee, sequence, bodyHash, action: "call" }, ...(input.caller ? { caller: input.caller } : {}), expect });
    if (!signed.ok) return { ok: false, result: refuse(signed.code === "signer_unavailable" ? 503 : 402, signed.code, signed.message) };
    return {
      ok: true,
      headers: {
        [BUDGET_PAYMENT_HEADER]: Buffer.from(JSON.stringify({ budget: expect.budget, createdSlot: record!.createdSlot, sequence })).toString("base64"),
        [BUDGET_SIGNATURE_HEADER]: Buffer.concat([Buffer.from(signed.publicKey), Buffer.from(signed.signature)]).toString("base64"),
      },
    };
  };
  const send = async (headers: Record<string, string>): Promise<ProviderAnswer | RelayResult> => {
    try {
      return await deps.callProvider(provider, forwarded, headers);
    } catch {
      return refuse(502, "provider_unreachable", `${provider.name} could not be reached. Nothing was charged; try again.`);
    }
  };

  let sequence = (record.calls?.[provider.payee] ?? 0) + 1;
  let signed = await sign(sequence);
  if (!signed.ok) return signed.result;
  let headers = signed.headers;
  let answer = await send(headers);
  let reserved = false;
  let resynced = false;
  for (let round = 0; round < 3 && answer.status !== 200; round += 1) {
    const { code, body: refusal } = errorCode(answer);
    if (code === "budget_sequence_mismatch" && !resynced) {
      const next = expectedSequence(refusal);
      if (next === undefined) break;
      resynced = true;
      sequence = next;
      await rememberCalls(deps.store, record.id, provider.payee, next - 1);
      signed = await sign(sequence);
      if (!signed.ok) return signed.result;
      headers = signed.headers;
      answer = await send(headers);
      continue;
    }
    if ((code === "budget_reservation_required" || code === "reservation_low") && !reserved) {
      reserved = true;
      const offer = checkOffer(refusal?.budget, { provider, record, programId: deps.programId });
      if (typeof offer === "string") return refuse(502, "provider_offer_refused", offer);
      const max = BigInt(record.maxReserve ?? "0");
      const want = BigInt(offer.reservation);
      const amount = want < max ? want : max;
      if (amount < BigInt(offer.minReservation)) return refuse(402, "budget_share_too_small", `${provider.name} needs a share of at least ${offer.minReservation} base units for this call, more than this Budget allows each provider.`);
      const approved = await deps.approve({ id: key.id, agentSecret: key.agentSecret, request: { purpose: "reserve", payee: provider.payee, amount, payoutAccount: offer.payoutAccount }, ...(input.caller ? { caller: input.caller } : {}) });
      if (!approved.ok) return refuse(approved.code === "signer_unavailable" ? 503 : 402, approved.code, approved.message);
      let blockhash: string;
      try {
        blockhash = await deps.blockhash();
      } catch {
        return refuse(503, "chain_unavailable", "The relay could not read the chain. Nothing was charged; try again.");
      }
      answer = await send({ ...headers, [BUDGET_RESERVE_HEADER]: reserveTransaction(new PublicKey(provider.payee), blockhash, approved.instructions) });
      continue;
    }
    break;
  }
  if (answer.status === 200) await rememberCalls(deps.store, record.id, provider.payee, sequence).catch(() => undefined);
  return { status: answer.status, headers: { ...passHeaders(answer.headers), "x-rap-budget-provider": provider.id }, bodyText: answer.bodyText };
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
