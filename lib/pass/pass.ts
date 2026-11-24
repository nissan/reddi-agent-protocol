/**
 * Server only. The agent pass (#1048): a budget a person gives their agent
 * with one Solana Pay signature, so an assistant that can only send an HTTP
 * request with a key can pay providers per call.
 *
 * 1. `startPass` checks the providers and opens a pass: one metered session
 *    escrow per provider (its own nonce and maximum), a reference key, an
 *    expiry 24 hours out, and the agent's API key, of which only a hash is kept.
 * 2. `buildPassTransaction` is the Solana Pay transaction request: one lock per
 *    provider plus a memo per lock that delegates that session to the pass's
 *    relay key until the expiry. The person's wallet signs it once.
 * 3. `activatePass` finds the confirmed lock by its reference and records the
 *    payer and the escrows.
 * 4. `passCall` serves the agent: it picks the provider's session, checks the
 *    budget and the per-call cap before anything is sent, signs the next
 *    session call with the relay key, checks the provider's receipt and keeps
 *    it for the next call.
 * 5. `closePass` closes every session: the provider settles what it served
 *    and the rest of each lock goes back to the person's wallet.
 *
 * The relay key holds no funds. It can only make calls to the providers named
 * in the locks, up to each lock, until the expiry: the delegation memo the
 * person signed says exactly that, and the escrow program pays only the payee
 * named at lock time. Runs on devnet against the sandbox providers.
 */
import { createHash, createHmac, createPrivateKey, randomBytes, sign as edSign } from "crypto";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import {
  lockBoundDelegationHeaderValue,
  sessionCallAction,
  sessionDelegationMemo,
  sessionDelegationMemoInstruction,
  sessionSignatureHeaderValue,
  SOLANA_GENESIS_HASHES,
  transactionFactsReader,
  type SessionDelegation,
} from "@redditech/x402-solana";
import { findSandboxProviderById, findSandboxProviderByModel, SANDBOX_ENDPOINT_PATH, type SandboxProvider } from "@/lib/sandbox/catalog";
import { meteredPaymentHeader, type SandboxChallenge } from "@/lib/sandbox/client";
import { buildSandboxMeteredLock, sandboxEscrowAddress } from "@/lib/sandbox/escrow";
import { handleSandboxChatCompletion, SANDBOX_MAX_SESSION_CALLS, SESSION_RECEIPT_HEADER, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { maxChargeLamports, requestInputTokens } from "@/lib/sandbox/pricing";
import { decodeReceiptHeader, encodeReceiptHeader, isSandboxReceipt, PROVIDER_RECEIPT_HEADER, sandboxReceiptSignatureValid, type SandboxReceipt } from "@/lib/sandbox/receipt";
import { sandboxProviderAddress } from "@/lib/sandbox/keys";
import type { AgentPass, AgentPassStore, PassSession } from "./store";

/** A pass lasts 24 hours (Nissan, 24 Nov 2026), the limit for a client delegation. */
export const PASS_SECONDS = 24 * 60 * 60;
/** Calls stop this long before the expiry, leaving time to close every session while the delegation holds. */
export const PASS_EXPIRY_MARGIN_SECONDS = 10 * 60;
/** A close must start this long before the expiry, so the provider checks the delegation before it runs out. */
export const PASS_CLOSE_MARGIN_SECONDS = 30;
/**
 * Both windows of a pass's locks, in slots: 30 hours at the nominal 400 ms, and still more than
 * 25 hours if devnet slots run 15% fast. Until then neither side can end a lock alone: the provider
 * cannot claim it and the person cannot refund it. The relay closes each session (the provider
 * settles what it served and the rest comes back) before the delegation ends; if a pass is never
 * closed, the person refunds the whole lock once the window has passed.
 */
export const PASS_WINDOW_SLOTS = BigInt(270_000);
/** How long a pass waits for its lock before it is dropped. */
export const PASS_START_SECONDS = 15 * 60;
export const PASS_MAX_PROVIDERS = 3;
/** A budget must cover at least one call of this many input tokens at the provider's maximum. */
export const PASS_MIN_CALL_INPUT_TOKENS = 1_000;
/** The most one provider's lock may hold on devnet: 0.05 SOL. */
export const PASS_MAX_BUDGET_LAMPORTS = BigInt(50_000_000);
/** The gateway serves up to this many calls per session; the last one is kept for the close. */
export const PASS_MAX_CALLS_PER_PROVIDER = SANDBOX_MAX_SESSION_CALLS - 1;
/** A call holds its session this long; another call to the same provider waits or is told to retry. */
export const PASS_CALL_HOLD_MS = 60_000;
/** The prompt the relay sends to close a session. It costs a few tokens. */
export const PASS_CLOSE_PROMPT = "Close this session.";
export const PASS_LOCK_COMPUTE_UNITS_EACH = 80_000;
export const PASS_LOCK_MICRO_LAMPORTS_PER_UNIT = 1_000;
export const PASS_KEY_PREFIX = "rap_pass_";
export const PASS_REFERENCE_SIGNATURES = 1_000;
export const PASS_READS_PER_POLL = 4;

export type PassFailure = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): PassFailure => ({ ok: false, status, code, message });

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function signWith(key: Keypair, message: Uint8Array): Uint8Array {
  const pk = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(key.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return new Uint8Array(edSign(null, Buffer.from(message), pk));
}

/** The relay key for a pass id: an ed25519 key from HMAC(secret, id), its own label so it never equals a try's. Never stored. */
export function passRelayKeypair(passId: string, secret: Buffer): Keypair {
  const seed = createHmac("sha256", secret).update("reddi-pass-relay/1|").update(passId, "utf8").digest();
  return Keypair.fromSeed(Uint8Array.from(seed));
}

export function hashPassKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

const PASS_KEY = /^rap_pass_[A-Za-z0-9_-]{43}$/;

/** The key from an `Authorization: Bearer …` header, or undefined. */
export function passKeyFromAuthorization(header: string | null | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  return match && PASS_KEY.test(match[1]) ? match[1] : undefined;
}

function sessionDelegation(pass: AgentPass, provider: SandboxProvider, escrow: PublicKey, secret: Buffer): SessionDelegation {
  return { genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], escrow: escrow.toBase58(), provider: provider.payTo, sessionKey: passRelayKeypair(pass.id, secret).publicKey.toBase58(), expiresAt: pass.expiresAt };
}

function providerOf(session: PassSession): SandboxProvider {
  const provider = findSandboxProviderById(session.providerId);
  if (!provider) throw new Error(`pass names an unknown provider ${session.providerId}`);
  return provider;
}

/** The most the closing call can cost: every call leaves room for it, so a session can always close. */
export function passCloseReserveLamports(provider: SandboxProvider): bigint {
  return maxChargeLamports(provider, requestInputTokens([{ content: PASS_CLOSE_PROMPT }]));
}

/** The smallest budget a provider takes: one call of `PASS_MIN_CALL_INPUT_TOKENS` at its full output limit, and the close. */
export function passMinBudgetLamports(provider: SandboxProvider): bigint {
  return maxChargeLamports(provider, PASS_MIN_CALL_INPUT_TOKENS) + passCloseReserveLamports(provider);
}

/** Providers a pass can name: they answer, take devnet locks, and can settle a session now. */
export async function passProvidersAvailable(deps: SandboxGatewayDeps, candidates: readonly SandboxProvider[]): Promise<SandboxProvider[]> {
  if (!deps.settler || deps.acceptMeteredSessions !== true || !deps.readTransaction) return [];
  const deployment = await deps.settler.deployment();
  if (!deployment.ok) return [];
  return candidates.filter((provider) => provider.behaviour !== "offline" && !provider.simulatedOnly && deps.settler!.canSettle(provider.id));
}

/** Step 1: open a pass for these providers and budgets. Returns the agent's key once; only its hash is stored. */
export async function startPass(input: {
  budgets: unknown;
  perCallMaxLamports?: unknown;
  deps: SandboxGatewayDeps;
  store: AgentPassStore;
  nowMs?: number;
}): Promise<{ ok: true; pass: AgentPass; key: string } | PassFailure> {
  if (!Array.isArray(input.budgets) || input.budgets.length === 0 || input.budgets.length > PASS_MAX_PROVIDERS) {
    return fail(400, "invalid_budgets", `Pick 1 to ${PASS_MAX_PROVIDERS} providers, each with a budget in lamports.`);
  }
  const sessions: PassSession[] = [];
  const picked: SandboxProvider[] = [];
  for (const entry of input.budgets as unknown[]) {
    const record = entry as { providerId?: unknown; lamports?: unknown } | null;
    const provider = findSandboxProviderById(record?.providerId);
    if (!provider) return fail(400, "unknown_provider", "One of the providers is not listed.");
    if (picked.some((p) => p.id === provider.id)) return fail(400, "invalid_budgets", `${provider.name} is named twice.`);
    if (typeof record?.lamports !== "string" || !/^[1-9][0-9]{0,18}$/.test(record.lamports)) return fail(400, "invalid_budgets", `Give ${provider.name}'s budget as a whole number of lamports.`);
    const lamports = BigInt(record.lamports);
    if (lamports < passMinBudgetLamports(provider)) return fail(400, "budget_too_small", `${provider.name}'s budget must cover at least one call: ${passMinBudgetLamports(provider)} lamports.`);
    if (lamports > PASS_MAX_BUDGET_LAMPORTS) return fail(400, "budget_too_large", `A budget on devnet is at most ${PASS_MAX_BUDGET_LAMPORTS} lamports per provider.`);
    picked.push(provider);
    sessions.push({ providerId: provider.id, nonce: randomBytes(16).toString("hex"), maxLamports: lamports.toString(), sequence: 0, cumulativeLamports: "0" });
  }
  let perCallMaxLamports: string | undefined;
  if (input.perCallMaxLamports !== undefined && input.perCallMaxLamports !== null && input.perCallMaxLamports !== "") {
    if (typeof input.perCallMaxLamports !== "string" || !/^[1-9][0-9]{0,18}$/.test(input.perCallMaxLamports)) return fail(400, "invalid_cap", "Give the per-call cap as a whole number of lamports.");
    perCallMaxLamports = input.perCallMaxLamports;
  }
  const available = await passProvidersAvailable(input.deps, picked);
  const missing = picked.find((provider) => !available.includes(provider));
  if (missing) return fail(503, "provider_unavailable", `${missing.name} is not taking passes right now. Nothing was asked of your wallet.`);

  const nowMs = input.nowMs ?? Date.now();
  const key = `${PASS_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const pass: AgentPass = {
    id: randomBytes(16).toString("hex"),
    keyHash: hashPassKey(key),
    network: "solana-devnet",
    reference: Keypair.generate().publicKey.toBase58(),
    expiresAt: Math.floor(nowMs / 1000) + PASS_SECONDS,
    ...(perCallMaxLamports ? { perCallMaxLamports } : {}),
    status: "waiting",
    sessions,
    version: 1,
    createdAt: new Date(nowMs).toISOString(),
  };
  const created = await input.store.create(pass);
  if (!created.ok) return fail(503, "store_unavailable", "The pass could not be saved. Nothing was asked of your wallet.");
  return { ok: true, pass, key };
}

/** Step 2 (Solana Pay transaction request POST): every lock and its delegation memo, for `account` to sign. */
export async function buildPassTransaction(input: {
  passId: unknown;
  account: unknown;
  secret: Buffer;
  store: AgentPassStore;
  connection: Pick<Connection, "getLatestBlockhash">;
  nowMs?: number;
}): Promise<{ ok: true; transaction: string; message: string } | PassFailure> {
  const pass = typeof input.passId === "string" ? await input.store.byId(input.passId) : undefined;
  const nowMs = input.nowMs ?? Date.now();
  if (!pass || pass.status !== "waiting" || Date.parse(pass.createdAt) + PASS_START_SECONDS * 1000 <= nowMs) {
    return fail(400, "pass_invalid", "This pass link has expired, is already paid, or is not one of ours. Start again from the pass page.");
  }
  let payer: PublicKey;
  try {
    payer = new PublicKey(String(input.account));
  } catch {
    return fail(400, "account_invalid", "The wallet sent an account that is not a Solana address.");
  }
  const instructions = [];
  for (const [index, session] of pass.sessions.entries()) {
    const provider = providerOf(session);
    const lock = buildSandboxMeteredLock({
      payer,
      payee: new PublicKey(provider.payTo),
      maxLamports: BigInt(session.maxLamports),
      challengeNonce: session.nonce,
      claimWindowSlots: PASS_WINDOW_SLOTS,
      cancelWindowSlots: PASS_WINDOW_SLOTS,
    });
    // The reference rides read-only on the first lock (the program ignores accounts after its own), so the page can find the transaction.
    if (index === 0) lock.instruction.keys.push({ pubkey: new PublicKey(pass.reference), isSigner: false, isWritable: false });
    instructions.push(lock.instruction, sessionDelegationMemoInstruction(sessionDelegation(pass, provider, lock.escrow, input.secret), payer));
  }
  const { blockhash, lastValidBlockHeight } = await input.connection.getLatestBlockhash("confirmed");
  // A small explicit compute budget, first, as on the try page (run 5 and run 6 findings).
  const budget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: PASS_LOCK_COMPUTE_UNITS_EACH * pass.sessions.length }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PASS_LOCK_MICRO_LAMPORTS_PER_UNIT }),
  ];
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...budget, ...instructions);
  const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const names = pass.sessions.map((session) => providerOf(session).name).join(" and ");
  return { ok: true, transaction, message: `Lock your agent's budget for ${names} on devnet, for 24 hours. Unused SOL comes back when the pass closes.` };
}

/** What `activatePass` reads from devnet. A `Connection` fits. */
export type PassChainReader = Parameters<typeof transactionFactsReader>[0] & {
  getSignaturesForAddress(address: PublicKey, options: { limit: number }, commitment: "confirmed"): Promise<readonly { signature: string; err: unknown }[]>;
};

export type PassView = {
  id: string;
  status: AgentPass["status"];
  expiresAt: number;
  payer?: string;
  lockSignature?: string;
  perCallMaxLamports?: string;
  providers: { id: string; name: string; model: string; maxLamports: string; spentLamports: string; calls: number; escrow?: string; closed: boolean; settleSignature?: string }[];
};

export function passView(pass: AgentPass): PassView {
  return {
    id: pass.id,
    status: pass.status,
    expiresAt: pass.expiresAt,
    ...(pass.payer ? { payer: pass.payer } : {}),
    ...(pass.lockSignature ? { lockSignature: pass.lockSignature } : {}),
    ...(pass.perCallMaxLamports ? { perCallMaxLamports: pass.perCallMaxLamports } : {}),
    providers: pass.sessions.map((session) => {
      const provider = providerOf(session);
      return {
        id: provider.id,
        name: provider.name,
        model: provider.model,
        maxLamports: session.maxLamports,
        spentLamports: session.closed?.amountLamports ?? session.cumulativeLamports,
        // The relay's own closing call is not one the agent made.
        calls: session.closed ? Math.max(0, session.sequence - 1) : session.sequence,
        ...(session.escrow ? { escrow: session.escrow } : {}),
        closed: session.closed !== undefined,
        ...(session.closed?.settleSignature ? { settleSignature: session.closed.settleSignature } : {}),
      };
    }),
  };
}

/** Step 3: once the lock has landed, record the payer and the escrows. `waiting` until it has. */
export async function activatePass(input: { passId: unknown; secret: Buffer; connection: PassChainReader; store: AgentPassStore }): Promise<{ ok: true; pass: AgentPass } | PassFailure> {
  const pass = typeof input.passId === "string" ? await input.store.byId(input.passId) : undefined;
  if (!pass) return fail(404, "pass_unknown", "No pass has that id.");
  if (pass.status !== "waiting") return { ok: true, pass };
  const reference = new PublicKey(pass.reference);
  const found = await input.connection.getSignaturesForAddress(reference, { limit: PASS_REFERENCE_SIGNATURES }, "confirmed");
  const read = transactionFactsReader(input.connection);
  let reads = 0;
  // Oldest first: the reference is public only once the lock lands, so anything naming it later comes after the lock.
  for (const candidate of [...found].reverse()) {
    if (candidate.err) continue;
    if (reads >= PASS_READS_PER_POLL) break;
    reads += 1;
    const facts = await read(candidate.signature);
    if (!facts || facts.failed || facts.signers.length === 0) continue;
    const payer = new PublicKey(facts.signers[0]);
    // Only a transaction that locks every session and carries every delegation memo, signed by its payer, is this pass's.
    const escrows = pass.sessions.map((session) => sandboxEscrowAddress(payer, session.nonce));
    const complete = pass.sessions.every((session, index) => {
      const memo = sessionDelegationMemo(sessionDelegation(pass, providerOf(session), escrows[index], input.secret));
      return facts.accounts.includes(escrows[index].toBase58()) && facts.memos.some((m) => m.text === memo && m.accounts.includes(payer.toBase58()));
    });
    if (!complete) continue;
    const next: AgentPass = {
      ...pass,
      status: "active",
      payer: payer.toBase58(),
      lockSignature: candidate.signature,
      sessions: pass.sessions.map((session, index) => ({ ...session, escrow: escrows[index].toBase58() })),
      version: pass.version + 1,
    };
    const written = await input.store.update(next);
    if (written.ok) return { ok: true, pass: next };
    const reread = await input.store.byId(pass.id);
    return reread ? { ok: true, pass: reread } : fail(503, "store_unavailable", "The pass could not be saved. Your lock is safe; check again shortly.");
  }
  return { ok: true, pass };
}

type ChatMessage = { role: string; content: string };

function chatBody(body: unknown): { model: string; messages: ChatMessage[] } | undefined {
  const record = body as { model?: unknown; messages?: unknown } | null;
  if (!record || typeof record.model !== "string" || !Array.isArray(record.messages) || record.messages.length === 0) return undefined;
  const messages: ChatMessage[] = [];
  for (const message of record.messages as unknown[]) {
    const m = message as { role?: unknown; content?: unknown } | null;
    if (!m || typeof m.role !== "string" || typeof m.content !== "string") return undefined;
    messages.push({ role: m.role, content: m.content });
  }
  return { model: record.model, messages };
}

export type PassCallResult =
  | { ok: true; status: 200; body: Record<string, unknown>; receipt: SandboxReceipt; closingReceipt?: SandboxReceipt; pass: AgentPass }
  | PassFailure;

/**
 * Write one session of the pass. The pass row has one version for all its
 * sessions, so a call to another provider can land in between: on a version
 * conflict, read the pass again and apply `change` to the latest copy of
 * this session, leaving the others as they now are. `change` returns
 * undefined when the latest copy no longer allows the write.
 */
const SESSION_WRITE_ATTEMPTS = 8;
async function withSession(store: AgentPassStore, pass: AgentPass, index: number, change: (session: PassSession) => PassSession | undefined): Promise<AgentPass | undefined> {
  let current = pass;
  for (let attempt = 0; attempt < SESSION_WRITE_ATTEMPTS; attempt += 1) {
    const changed = change(current.sessions[index]);
    if (!changed) return undefined;
    const next: AgentPass = { ...current, sessions: current.sessions.map((session, i) => (i === index ? changed : session)), version: current.version + 1 };
    const written = await store.update(next);
    if (written.ok) return next;
    const latest = await store.byId(pass.id);
    if (!latest) return undefined;
    current = latest;
  }
  return undefined;
}

/** A session while a call holds it: until when, and which call (so only that call's write-back releases it). */
type HeldSession = PassSession & { heldUntil?: number; holdId?: string };

/**
 * Step 4: one call from the agent. The body is an OpenAI-style chat request
 * whose `model` names one of the pass's providers. Nothing is sent to the
 * provider unless the pass is active and unexpired, the session is open,
 * and the call's worst case fits under both the per-call cap and what is
 * left of the provider's lock.
 */
type RelayInput = { origin: string; secret: Buffer; deps: SandboxGatewayDeps; store: AgentPassStore; nowMs?: number };

export async function passCall(input: RelayInput & { key: string; body: unknown }): Promise<PassCallResult> {
  const nowMs = input.nowMs ?? (input.deps.now ?? Date.now)();
  const pass = await input.store.byKeyHash(hashPassKey(input.key));
  if (!pass) return fail(401, "pass_key_invalid", "This key is not an agent pass. Check it was copied whole.");
  if (pass.status === "waiting") return fail(409, "pass_not_paid", "This pass is waiting for its lock. Finish the payment on the pass page first.");
  if (pass.status === "closed") return fail(409, "pass_closed", "This pass is closed. Ask your person for a new one.");
  if (nowMs / 1000 >= pass.expiresAt - PASS_EXPIRY_MARGIN_SECONDS) {
    // Out of time for calls: settle what was served now, while the delegation still holds.
    await closeOpenSessions({ ...input, pass, nowMs });
    return fail(409, "pass_expired", "This pass has run its 24 hours and is closing. Ask your person for a new one.");
  }
  return callWithPass({ ...input, pass, nowMs });
}

async function callWithPass(input: RelayInput & { pass: AgentPass; body: unknown; nowMs: number; close?: boolean }): Promise<PassCallResult> {
  const { pass, nowMs } = input;
  if (input.close && nowMs / 1000 >= pass.expiresAt - PASS_CLOSE_MARGIN_SECONDS) {
    return fail(409, "pass_expired", "The delegation has run out, so this session cannot be closed by the relay. The person can refund the whole lock once its window has passed.");
  }
  const chat = chatBody(input.body);
  if (!chat) return fail(400, "invalid_request", "Send an OpenAI-style chat request: a model and a list of messages with text content.");
  const provider = findSandboxProviderByModel(chat.model);
  const index = provider ? pass.sessions.findIndex((session) => session.providerId === provider.id) : -1;
  if (!provider || index < 0) {
    const listed = pass.sessions.map((session) => providerOf(session).model).join(", ");
    return fail(404, "model_not_in_pass", `This pass pays for these models only: ${listed}.`);
  }
  const session = pass.sessions[index] as HeldSession;
  if (session.closed) return fail(409, "session_closed", `${provider.name}'s part of this pass is closed.`);
  if (!session.escrow || !pass.payer || !pass.lockSignature) return fail(409, "pass_not_paid", "This pass has no lock recorded yet.");
  if (!input.close && session.sequence >= PASS_MAX_CALLS_PER_PROVIDER) return fail(402, "pass_calls_used", `This pass has made its ${PASS_MAX_CALLS_PER_PROVIDER} calls to ${provider.name}. Close it, then ask for a new one.`);
  const text = JSON.stringify({ model: chat.model, messages: chat.messages });
  const worst = maxChargeLamports(provider, requestInputTokens(chat.messages));
  if (!input.close && pass.perCallMaxLamports && worst > BigInt(pass.perCallMaxLamports)) {
    return fail(402, "over_call_cap", `This call could cost up to ${worst} lamports, over the ${pass.perCallMaxLamports} per call your person set. Nothing was sent. Send a shorter request.`);
  }
  // Every call leaves room for the close, so the session can always settle what it served.
  const reserve = input.close ? BigInt(0) : passCloseReserveLamports(provider);
  if (BigInt(session.cumulativeLamports) + worst + reserve > BigInt(session.maxLamports)) {
    const left = BigInt(session.maxLamports) - BigInt(session.cumulativeLamports) - reserve;
    return fail(402, "budget_reached", `This call could cost up to ${worst} lamports and ${left > BigInt(0) ? left : BigInt(0)} are left for ${provider.name}. Nothing was sent.`);
  }
  if (session.heldUntil !== undefined && session.heldUntil > nowMs) return fail(409, "pass_busy", `Another call to ${provider.name} is in progress. Retry in a moment.`);

  // Hold the session so a second call cannot take the same sequence.
  // Only if the latest copy of this session is still the one checked above (same sequence, open, not held).
  const holdId = randomBytes(8).toString("hex");
  const held = await withSession(input.store, pass, index, (s) => {
    const latest = s as HeldSession;
    if (latest.closed || latest.sequence !== session.sequence || (latest.heldUntil !== undefined && latest.heldUntil > nowMs)) return undefined;
    return { ...latest, heldUntil: nowMs + PASS_CALL_HOLD_MS, holdId } as HeldSession;
  });
  if (!held) return fail(409, "pass_busy", `Another call to ${provider.name} is in progress. Retry in a moment.`);
  const release = async (current: AgentPass, change: (s: PassSession) => PassSession = (s) => s) =>
    withSession(input.store, current, index, (s) => {
      if ((s as HeldSession).holdId !== holdId) return undefined;
      const { heldUntil: _released, holdId: _id, ...rest } = change(s) as HeldSession;
      void _released;
      void _id;
      return rest;
    });

  const sequence = session.sequence + 1;
  const escrow = new PublicKey(session.escrow);
  const delegation = sessionDelegation(pass, provider, escrow, input.secret);
  const relay = passRelayKeypair(pass.id, input.secret);
  const challenge: SandboxChallenge = { version: "1", network: "solana-devnet", payTo: provider.payTo, amount: "0", currency: "SOL", endpoint: SANDBOX_ENDPOINT_PATH, nonce: session.nonce };
  let reply;
  try {
    reply = await handleSandboxChatCompletion(
      {
        body: JSON.parse(text),
        rawBody: text,
        paymentHeader: meteredPaymentHeader(challenge, session.escrow, pass.lockSignature, pass.payer),
        origin: input.origin,
        session: {
          sequence: String(sequence),
          ...(input.close ? { close: "close" } : {}),
          ...(session.lastReceipt ? { previousReceipt: session.lastReceipt } : {}),
          delegation: lockBoundDelegationHeaderValue(delegation, pass.lockSignature),
          signature: await sessionSignatureHeaderValue({ genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], action: sessionCallAction(input.close === true), escrow: session.escrow, sequence, body: text }, (m) => signWith(relay, m)),
        },
      },
      input.deps,
    );
  } catch {
    await release(held);
    return fail(503, "provider_unreachable", `${provider.name} could not be reached. Nothing was charged; retry shortly.`);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(reply.bodyText) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (reply.status === 202 && input.close && typeof body.settleSignature === "string") {
    // The settle was sent but not yet confirmed. The session is over either way: record the signature to look up.
    await release(held, (s) => ({ ...s, closed: { settleSignature: body.settleSignature as string, amountLamports: s.cumulativeLamports, refundedLamports: "0", pending: true } }));
    return fail(202, "settle_pending", `${provider.name}'s settle was sent and is not confirmed yet: ${body.settleSignature}.`);
  }
  if (reply.status !== 200) {
    await release(held);
    const error = body.error as { code?: unknown; message?: unknown } | undefined;
    return fail(reply.status === 202 ? 202 : reply.status >= 500 ? 502 : reply.status, typeof error?.code === "string" ? error.code : "provider_refused", typeof error?.message === "string" ? error.message : `${provider.name} refused the call.`);
  }
  // Check the receipt before keeping it: this provider's key, the next sequence, chained to the last one.
  const receipt = decodeReceiptHeader(reply.headers[PROVIDER_RECEIPT_HEADER]);
  const problem = await passReceiptProblem(receipt, provider, sequence, session);
  if (problem) {
    await release(held);
    return fail(502, "receipt_invalid", `${provider.name}'s receipt did not check: ${problem} The call was not counted.`);
  }
  const callReceipt = receipt as SandboxReceipt;
  const closing = input.close ? decodeReceiptHeader(reply.headers[SESSION_RECEIPT_HEADER]) : undefined;
  const closingReceipt = isSandboxReceipt(closing) ? closing : undefined;
  const after = await release(held, (s) => ({
    ...s,
    sequence,
    lastReceipt: encodeReceiptHeader(callReceipt),
    cumulativeLamports: callReceipt.receipt.session!.cumulativeCost,
    ...(input.close && closingReceipt
      ? {
          closed: {
            ...(closingReceipt.receipt.payment?.txSignature ? { settleSignature: closingReceipt.receipt.payment.txSignature } : {}),
            amountLamports: closingReceipt.receipt.payment?.amount ?? callReceipt.receipt.session!.cumulativeCost,
            refundedLamports: closingReceipt.receipt.payment?.metered?.refunded ?? "0",
          },
        }
      : {}),
  }));
  // The call was served and charged to the session even if this write lost a race; say so rather than hide it.
  const current = after ?? (await input.store.byId(pass.id)) ?? held;
  const left = BigInt(session.maxLamports) - BigInt(callReceipt.receipt.session!.cumulativeCost);
  return {
    ok: true,
    status: 200,
    body: {
      ...body,
      rap_pass: {
        provider: provider.id,
        sequence,
        callCostLamports: (BigInt(callReceipt.receipt.session!.cumulativeCost) - BigInt(session.cumulativeLamports)).toString(),
        spentLamports: callReceipt.receipt.session!.cumulativeCost,
        leftLamports: left.toString(),
        expiresAt: pass.expiresAt,
        receipt: encodeReceiptHeader(callReceipt),
      },
    },
    receipt: callReceipt,
    ...(closingReceipt ? { closingReceipt } : {}),
    pass: current,
  };
}

/** Why a provider's receipt for call `sequence` cannot be kept, or undefined when it checks. Exported for tests. */
export async function passReceiptProblem(receipt: unknown, provider: SandboxProvider, sequence: number, session: PassSession): Promise<string | undefined> {
  if (!isSandboxReceipt(receipt) || !receipt.receipt.session) return "the answer came without a session receipt.";
  if (receipt.receipt.providerId !== (await sandboxProviderAddress(provider.id))) return "it is not signed by this provider's key.";
  if (!(await sandboxReceiptSignatureValid(receipt))) return "its signature does not verify.";
  const s = receipt.receipt.session;
  if (Number(s.sequence) !== sequence) return "it is for a different call in the session.";
  if (s.escrow !== session.escrow || s.maxAmount !== session.maxLamports) return "it names a different lock.";
  if (BigInt(s.cumulativeCost) < BigInt(session.cumulativeLamports) || BigInt(s.cumulativeCost) > BigInt(session.maxLamports)) return "its running total does not follow the last one.";
  return undefined;
}

/**
 * Step 5: close every open session. The provider settles what it served on
 * the closing call, and the rest of each lock goes back to the payer.
 */
export async function closePass(input: RelayInput & { key: string }): Promise<{ ok: true; pass: AgentPass; failures: string[] } | PassFailure> {
  const pass = await input.store.byKeyHash(hashPassKey(input.key));
  if (!pass) return fail(401, "pass_key_invalid", "This key is not an agent pass.");
  if (pass.status !== "active") return pass.status === "closed" ? { ok: true, pass, failures: [] } : fail(409, "pass_not_paid", "This pass has no lock to close yet.");
  return closeOpenSessions({ ...input, pass, nowMs: input.nowMs ?? (input.deps.now ?? Date.now)() });
}

async function closeOpenSessions(input: RelayInput & { pass: AgentPass; nowMs: number }): Promise<{ ok: true; pass: AgentPass; failures: string[] }> {
  const failures: string[] = [];
  for (const session of input.pass.sessions) {
    if (session.closed) continue;
    const provider = providerOf(session);
    // Each close reads the pass again: the one before it wrote a new version.
    const current = await input.store.byId(input.pass.id);
    if (!current) break;
    const result = await callWithPass({ ...input, pass: current, close: true, body: { model: provider.model, messages: [{ role: "user", content: PASS_CLOSE_PROMPT }] } });
    if (!result.ok && result.code !== "settle_pending") failures.push(`${provider.name}: ${result.message}`);
  }
  const pass = input.pass;
  const latest = (await input.store.byId(pass.id)) ?? pass;
  if (failures.length === 0 && latest.sessions.every((s) => s.closed)) {
    const closed = { ...latest, status: "closed" as const, version: latest.version + 1 };
    const written = await input.store.update(closed);
    return { ok: true, pass: written.ok ? closed : latest, failures };
  }
  return { ok: true, pass: latest, failures };
}
