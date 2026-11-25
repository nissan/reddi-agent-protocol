/**
 * Server only. The Budget page (`/budget`): a person opens a pooled Budget
 * from their own wallet, gets the key their agent spends it with, and then
 * watches and steers it.
 *
 * 1. `prepareBudget` checks the terms (one token, the total, up to four
 *    providers, an alert email) and picks a fresh nonce, so the Budget's
 *    address is known before anything is signed. It answers with the text the
 *    payer's wallet signs: the authorization `createSpender` checks (R5-M1).
 * 2. `startBudget` makes the relay's record from that signature and builds
 *    the `open_budget` (or `open_token_budget`) transaction for the payer's
 *    wallet: flag 0x08 (the relay's KMS key is the spender), the providers as
 *    the allowlist, half the total as the per-provider cap, 72 h open, 24 h
 *    to dispute, the RAP judge when one is set (`BUDGET_DEFAULT_JUDGE`). The
 *    agent's key is handed out here, once.
 * 3. `activateSpender` (custody) marks the record open once the open is
 *    finalized on chain and matches what the payer signed.
 * 4. `budgetStatus` reads the Budget and its slices on chain and says, for
 *    each slice, what the payer can do with it now.
 * 5. `buildBudgetAction` builds one payer transaction: approve (waive) a
 *    posted slice so it is paid at once, dispute it, close the Budget early,
 *    or pay out a slice whose window has ended (anyone may).
 *
 * Nothing here signs or sends: every transaction goes to the payer's wallet.
 * Devnet only, like the rest of the Budget relay (`./runtime`).
 */

import { randomBytes } from "crypto";
import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { ESCROW_PROTOCOL_TREASURY, treasuryTokenAccount } from "@redditech/x402-solana";
import {
  BUDGET_ALLOWLIST_LEN,
  MAX_SOL_BUDGET_LAMPORTS,
  MAX_TOKEN_BUDGET_BASE_UNITS,
  budgetAddress,
  closeBudgetInstruction,
  decodeBudget,
  decodeReservation,
  disputeEnds,
  disputeInstruction,
  judgeEnds,
  minReservation,
  openBudgetInstruction,
  p256SpenderAddress,
  payoutInstruction,
  reservationAddress,
  waiveInstruction,
  type BudgetAccount,
  type ReservationAccount,
} from "@redditech/x402-solana/budget";
import { SANDBOX_PROVIDERS, type SandboxProvider } from "@/lib/sandbox/catalog";
import { microUsdToLamports } from "@/lib/sandbox/pricing";
import { contactProblem } from "./alerts";
import { createSpender, relayAuthorizationMessage, type CustodyDeps } from "./custody";
import type { BudgetNetwork, SpenderRecord } from "./store";

export const BUDGET_NETWORK: BudgetNetwork = "solana-devnet";
const HOUR_SLOTS = BigInt(9_000);
/** The spec's defaults: open 72 h, 24 h to dispute after close, 72 h for the judge. */
export const BUDGET_OPEN_SLOTS = HOUR_SLOTS * BigInt(72);
export const BUDGET_DISPUTE_SLOTS = HOUR_SLOTS * BigInt(24);
export const BUDGET_JUDGE_SLOTS = HOUR_SLOTS * BigInt(72);
/** $5, the default Budget. */
export const BUDGET_DEFAULT_MICRO_USD = BigInt(5_000_000);
export const BUDGET_OPEN_COMPUTE_UNITS = 60_000;
export const BUDGET_MICRO_LAMPORTS_PER_UNIT = 1_000;

/** The USDC mint the devnet program allowlists (`USDC_DEVNET_MINT` in the program's consts). */
export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Rounded up to a step, so the default reads as 0.0334 SOL, not 0.033333334. */
function roundUp(value: bigint, step: bigint): bigint {
  return ((value + step - BigInt(1)) / step) * step;
}

export type BudgetTokenName = "SOL" | "USDC";
export const BUDGET_TOKENS: Record<BudgetTokenName, { decimals: number; max: bigint; mint: PublicKey | null; defaultTotal: bigint }> = {
  SOL: { decimals: 9, max: MAX_SOL_BUDGET_LAMPORTS, mint: null, defaultTotal: roundUp(microUsdToLamports(BUDGET_DEFAULT_MICRO_USD), BigInt(100_000)) },
  USDC: { decimals: 6, max: MAX_TOKEN_BUDGET_BASE_UNITS, mint: DEVNET_USDC_MINT, defaultTotal: BUDGET_DEFAULT_MICRO_USD },
};

export type BudgetFailure = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): BudgetFailure => ({ ok: false, status, code, message });
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** The providers a Budget can name on this page: the devnet sandbox providers that take real devnet payments for text. */
export function budgetProviders(): SandboxProvider[] {
  return SANDBOX_PROVIDERS.filter((p) => p.behaviour !== "offline" && !p.simulatedOnly && !p.studio && !p.media);
}

export function budgetProviderView(p: SandboxProvider) {
  return { id: p.id, name: p.name, model: p.model, tagline: p.tagline, payTo: p.payTo, pricing: { inputPerMillionUsd: p.pricing.inputPerMillionUsd, outputPerMillionUsd: p.pricing.outputPerMillionUsd } };
}

/** The RAP judge every Budget names by default (Nissan, 24 Nov 2026), once its key is set. Null: no judge, and the allowlist stands in (B1). */
export function defaultBudgetJudge(env: Record<string, string | undefined> = process.env): PublicKey | null {
  const value = env.BUDGET_DEFAULT_JUDGE?.trim();
  if (!value || !BASE58.test(value)) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

/** What the payer signs for, as the page sends it back on start. Amounts are base-unit strings. */
export type BudgetTerms = {
  payer: string;
  token: BudgetTokenName;
  total: string;
  providerIds: string[];
  email: string;
  /** 32 hex characters. */
  nonce: string;
  issuedAt: number;
};

type CheckedTerms = {
  payer: PublicKey;
  token: BudgetTokenName;
  total: bigint;
  cap: bigint;
  providers: SandboxProvider[];
  email: string;
  nonce: Buffer;
  budget: PublicKey;
};

function checkTerms(input: Partial<Record<keyof BudgetTerms, unknown>>, programId: PublicKey): CheckedTerms | BudgetFailure {
  if (typeof input.payer !== "string" || !BASE58.test(input.payer)) return fail(400, "invalid_payer", "Connect a wallet first.");
  let payer: PublicKey;
  try {
    payer = new PublicKey(input.payer);
  } catch {
    return fail(400, "invalid_payer", "Connect a wallet first.");
  }
  if (input.token !== "SOL" && input.token !== "USDC") return fail(400, "invalid_token", "Pick SOL or USDC.");
  const token = BUDGET_TOKENS[input.token];
  if (typeof input.total !== "string" || !/^\d{1,20}$/.test(input.total)) return fail(400, "invalid_amount", "Give the Budget an amount.");
  const total = BigInt(input.total);
  if (total <= BigInt(0)) return fail(400, "invalid_amount", "Give the Budget an amount.");
  if (total > token.max) return fail(400, "amount_too_large", `A Budget holds at most ${formatBase(token.max, token.decimals)} ${input.token} for now.`);
  const ids = Array.isArray(input.providerIds) ? [...new Set(input.providerIds.filter((x): x is string => typeof x === "string"))] : [];
  if (ids.length === 0) return fail(400, "providers_required", "Pick at least one provider your agent may pay.");
  if (ids.length > BUDGET_ALLOWLIST_LEN) return fail(400, "too_many_providers", `Pick at most ${BUDGET_ALLOWLIST_LEN} providers.`);
  const offered = budgetProviders();
  const providers = ids.map((id) => offered.find((p) => p.id === id));
  if (providers.some((p) => !p)) return fail(400, "unknown_provider", "One of those providers does not take Budgets.");
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const problem = contactProblem({ email });
  if (problem) return fail(400, "contact_required", problem);
  const cap = total / BigInt(2);
  if (cap < minReservation(total)) return fail(400, "amount_too_small", "That Budget is too small to split between providers.");
  const nonceHex = typeof input.nonce === "string" && /^[0-9a-f]{32}$/.test(input.nonce) ? input.nonce : undefined;
  const nonce = nonceHex ? Buffer.from(nonceHex, "hex") : randomBytes(16);
  return { payer, token: input.token, total, cap, providers: providers as SandboxProvider[], email, nonce, budget: budgetAddress(payer, nonce, programId) };
}

export function formatBase(units: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = units / base;
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function authorizationOf(t: CheckedTerms, issuedAt: number) {
  return {
    network: BUDGET_NETWORK,
    payer: t.payer.toBase58(),
    budget: t.budget.toBase58(),
    providers: t.providers.map((p) => p.payTo),
    // One reserve may take at most the per-provider cap: the most any slice can reach anyway.
    maxReserve: t.cap,
    contact: { email: t.email },
    issuedAt,
  };
}

/** Step 1: the terms with a fresh nonce, and the text the payer's wallet signs. */
export function prepareBudget(
  input: Partial<Record<keyof BudgetTerms, unknown>>,
  programId: PublicKey,
  nowMs: number = Date.now(),
): { ok: true; terms: BudgetTerms; budget: string; message: string } | BudgetFailure {
  const checked = checkTerms({ ...input, nonce: undefined }, programId);
  if ("ok" in checked) return checked;
  const issuedAt = Math.floor(nowMs / 1000);
  const message = relayAuthorizationMessage(authorizationOf(checked, issuedAt));
  return {
    ok: true,
    budget: checked.budget.toBase58(),
    message: Buffer.from(message).toString("base64"),
    terms: {
      payer: checked.payer.toBase58(),
      token: checked.token,
      total: checked.total.toString(),
      providerIds: checked.providers.map((p) => p.id),
      email: checked.email,
      nonce: checked.nonce.toString("hex"),
      issuedAt,
    },
  };
}

function withPriority(feePayer: PublicKey, blockhash: string, instructions: TransactionInstruction[]): string {
  const tx = new Transaction({ feePayer, recentBlockhash: blockhash });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: BUDGET_OPEN_COMPUTE_UNITS }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BUDGET_MICRO_LAMPORTS_PER_UNIT }));
  tx.add(...instructions);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

export type StartedBudget = { ok: true; id: string; agentSecret: string; budget: string; transaction: string; record: SpenderRecord };

/** Step 2: the relay's record from the payer's signature, and the open for the payer's wallet. */
export async function startBudget(
  input: { terms: unknown; signature: unknown; programId: PublicKey; blockhash: () => Promise<string>; env?: Record<string, string | undefined> },
  deps: CustodyDeps,
): Promise<StartedBudget | BudgetFailure> {
  const raw = (input.terms && typeof input.terms === "object" ? input.terms : {}) as Partial<Record<keyof BudgetTerms, unknown>>;
  if (typeof raw.nonce !== "string" || !/^[0-9a-f]{32}$/.test(raw.nonce)) return fail(400, "invalid_request", "Start again: the Budget's terms are incomplete.");
  if (typeof raw.issuedAt !== "number" || !Number.isInteger(raw.issuedAt)) return fail(400, "invalid_request", "Start again: the Budget's terms are incomplete.");
  if (typeof input.signature !== "string" || input.signature.length > 200) return fail(400, "invalid_request", "Your wallet's signature is missing.");
  const t = checkTerms(raw, input.programId);
  if ("ok" in t) return t;
  if (!deps.signer) return fail(503, "custody_not_configured", "Budgets are not switched on for this server yet.");
  const created = await createSpender({ ...authorizationOf(t, raw.issuedAt), signature: input.signature, nonce: t.nonce.toString("hex"), programId: input.programId }, deps);
  if (!created.ok) {
    const status = created.code === "store_unavailable" || created.code === "custody_not_configured" || created.code === "alerts_not_configured" ? 503 : created.code === "not_the_payer" ? 403 : 400;
    return fail(status, created.code, created.message);
  }
  const spender = await p256SpenderAddress(deps.signer.publicKey);
  const mint = BUDGET_TOKENS[t.token].mint;
  const open = openBudgetInstruction({
    programId: input.programId,
    payer: t.payer,
    nonce: t.nonce,
    spender,
    judge: defaultBudgetJudge(input.env),
    openSlots: BUDGET_OPEN_SLOTS,
    disputeSlots: BUDGET_DISPUTE_SLOTS,
    judgeSlots: BUDGET_JUDGE_SLOTS,
    total: t.total,
    perProviderCap: t.cap,
    allowlist: t.providers.map((p) => new PublicKey(p.payTo)),
    p256Spender: true,
    ...(mint ? { token: { mint, source: associatedTokenAddress(t.payer, mint), tokenProgram: TOKEN_PROGRAM_ID } } : {}),
  });
  return {
    ok: true,
    id: created.record.id,
    agentSecret: created.agentSecret,
    budget: t.budget.toBase58(),
    record: created.record,
    transaction: withPriority(t.payer, await input.blockhash(), [open]),
  };
}

/** The key the page shows once: the record id and the agent secret, which the relay's agent route reads back. */
export function budgetAgentKey(id: string, agentSecret: string): string {
  return `${agentSecret}.${id}`;
}

export type SliceAction = "approve" | "dispute" | "payout";

export type SliceView = {
  payee: string;
  provider?: { id: string; name: string; model: string };
  reserved: string;
  posted: string;
  state: ReservationAccount["state"];
  approved: boolean;
  /** Slot the dispute window ends, once the Budget is closed. */
  disputeEndsSlot?: string;
  judgeEndsSlot?: string;
  actions: SliceAction[];
};

export type BudgetView = {
  address: string;
  payer: string;
  token: BudgetTokenName;
  decimals: number;
  total: string;
  unreserved: string;
  perProviderCap: string;
  judge: string | null;
  createdSlot: string;
  openEndsSlot: string;
  closedSlot: string | null;
  closed: boolean;
  /** Closed early by the agent without an allowlist: payouts wait for the open period's end unless the payer approves (flag 0x04). */
  reviewFromOpenEnd: boolean;
  slot: string;
  providers: { payee: string; id?: string; name?: string }[];
  slices: SliceView[];
  canClose: boolean;
};

export type BudgetReader = {
  readAccount(address: PublicKey, commitment?: "confirmed" | "finalized"): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  reservations(budget: PublicKey): Promise<{ address: PublicKey; data: Uint8Array }[]>;
  slot(): Promise<bigint>;
};

/** What a payer (or anyone, for a payout) can do with one slice at `slot`. */
export function sliceActions(budget: BudgetAccount, r: ReservationAccount, slot: bigint): SliceAction[] {
  const ends = disputeEnds(budget, r);
  const judgeEnd = judgeEnds(budget, r);
  const payable =
    (r.state === "posted" && r.waived) ||
    (r.state === "paid" && budget.closed) ||
    ((r.state === "posted" || r.state === "open") && ends !== null && slot >= ends) ||
    (r.state === "disputed" && judgeEnd !== null && slot >= judgeEnd);
  // Once a share can be paid out, approving it changes nothing: pay it out.
  if (payable) return ["payout"];
  const actions: SliceAction[] = [];
  if (r.state === "posted" && !r.waived) {
    actions.push("approve");
    if (budget.judge && (ends === null || slot < ends)) actions.push("dispute");
  }
  return actions;
}

const providerByPayTo = (payTo: string) => SANDBOX_PROVIDERS.find((p) => p.payTo === payTo);

/** Step 4: the Budget and its slices, read on chain. Undefined when no Budget is open at that address. */
export async function budgetStatus(address: string, programId: PublicKey, chain: BudgetReader): Promise<BudgetView | undefined> {
  if (!BASE58.test(address)) return undefined;
  const key = new PublicKey(address);
  const account = await chain.readAccount(key);
  if (!account || !account.owner.equals(programId)) return undefined;
  let budget: BudgetAccount;
  try {
    budget = decodeBudget(account.data);
  } catch {
    return undefined;
  }
  const slot = await chain.slot();
  const slices: SliceView[] = [];
  // A Budget with an allowlist has at most one slice per listed provider: read those few accounts rather than scan the program.
  const accounts = budget.allowlist.length > 0
    ? (await Promise.all(budget.allowlist.map((payee) => chain.readAccount(reservationAddress(key, payee, programId))))).filter((x): x is { owner: PublicKey; data: Uint8Array } => x !== null && x.owner.equals(programId))
    : await chain.reservations(key);
  for (const found of accounts) {
    let r: ReservationAccount;
    try {
      r = decodeReservation(found.data);
    } catch {
      continue;
    }
    if (r.budgetCreatedSlot !== budget.createdSlot) continue;
    const provider = providerByPayTo(r.payee.toBase58());
    const ends = disputeEnds(budget, r);
    const judgeEnd = judgeEnds(budget, r);
    slices.push({
      payee: r.payee.toBase58(),
      ...(provider ? { provider: { id: provider.id, name: provider.name, model: provider.model } } : {}),
      reserved: r.reserved.toString(),
      posted: r.finalAmount.toString(),
      state: r.state,
      approved: r.waived,
      ...(ends !== null ? { disputeEndsSlot: ends.toString() } : {}),
      ...(judgeEnd !== null ? { judgeEndsSlot: judgeEnd.toString() } : {}),
      actions: sliceActions(budget, r, slot),
    });
  }
  const token: BudgetTokenName = budget.mint ? "USDC" : "SOL";
  return {
    address,
    payer: budget.payer.toBase58(),
    token,
    decimals: BUDGET_TOKENS[token].decimals,
    total: budget.total.toString(),
    unreserved: budget.unreserved.toString(),
    perProviderCap: budget.perProviderCap.toString(),
    judge: budget.judge?.toBase58() ?? null,
    createdSlot: budget.createdSlot.toString(),
    openEndsSlot: budget.openEnds.toString(),
    closedSlot: budget.closed ? budget.closedSlot.toString() : null,
    closed: budget.closed,
    reviewFromOpenEnd: budget.reviewFromOpenEnd,
    slot: slot.toString(),
    providers: budget.allowlist.map((k) => {
      const p = providerByPayTo(k.toBase58());
      return { payee: k.toBase58(), ...(p ? { id: p.id, name: p.name } : {}) };
    }),
    slices,
    canClose: !budget.closed,
  };
}

export type BudgetAction = "approve" | "dispute" | "close" | "payout";

/** Step 5: one transaction for the connected wallet. Approve, dispute and close are the payer's; a payout anyone may send. */
export async function buildBudgetAction(
  input: { budget: unknown; payee: unknown; action: unknown; account: unknown; programId: PublicKey; chain: BudgetReader & { latestBlockhash(): Promise<string> } },
): Promise<{ ok: true; transaction: string } | BudgetFailure> {
  const action = input.action;
  if (action !== "approve" && action !== "dispute" && action !== "close" && action !== "payout") return fail(400, "invalid_request", "Unknown action.");
  if (typeof input.budget !== "string" || !BASE58.test(input.budget)) return fail(400, "invalid_request", "Name the Budget.");
  if (typeof input.account !== "string" || !BASE58.test(input.account)) return fail(400, "invalid_request", "Connect a wallet first.");
  const budgetKey = new PublicKey(input.budget);
  const account = new PublicKey(input.account);
  const found = await input.chain.readAccount(budgetKey);
  if (!found || !found.owner.equals(input.programId)) return fail(404, "budget_not_found", "That Budget is not open on chain.");
  const budget = decodeBudget(found.data);
  const ofBudget = { programId: input.programId, budget: budgetKey, createdSlot: budget.createdSlot };
  const isPayer = budget.payer.equals(account);
  if (action !== "payout" && !isPayer) return fail(403, "not_the_payer", "Only the wallet that opened this Budget can do that.");
  const mint = budget.mint;
  const token = mint ? { mint, refund: associatedTokenAddress(budget.payer, mint), tokenProgram: TOKEN_PROGRAM_ID } : undefined;
  let instruction: TransactionInstruction;
  if (action === "close") {
    if (budget.closed) return fail(409, "already_closed", "This Budget is already closed.");
    instruction = closeBudgetInstruction({ ...ofBudget, signer: budget.payer, payer: budget.payer, ...(token ? { token } : {}) });
  } else {
    if (typeof input.payee !== "string" || !BASE58.test(input.payee)) return fail(400, "invalid_request", "Name the provider.");
    const payee = new PublicKey(input.payee);
    const slice = await input.chain.readAccount(reservationAddress(budgetKey, payee, input.programId));
    if (!slice) return fail(404, "slice_not_found", "That provider has no share of this Budget.");
    const r = decodeReservation(slice.data);
    if (r.budgetCreatedSlot !== budget.createdSlot) return fail(404, "slice_not_found", "That provider has no share of this Budget.");
    const allowed = sliceActions(budget, r, await input.chain.slot());
    if (!allowed.includes(action)) return fail(409, "not_now", actionRefusal(action, r));
    if (action === "approve") instruction = waiveInstruction({ ...ofBudget, payee, signer: budget.payer });
    else if (action === "dispute") instruction = disputeInstruction({ ...ofBudget, payee, payer: budget.payer });
    else {
      instruction = payoutInstruction({
        ...ofBudget,
        payee,
        payer: budget.payer,
        treasury: ESCROW_PROTOCOL_TREASURY,
        ...(mint && token
          ? { token: { mint, payoutAccount: r.payoutAccount, treasuryToken: treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM_ID }), refund: token.refund, tokenProgram: TOKEN_PROGRAM_ID } }
          : {}),
      });
    }
  }
  return { ok: true, transaction: withPriority(account, await input.chain.latestBlockhash(), [instruction]) };
}

function actionRefusal(action: BudgetAction, r: ReservationAccount): string {
  if (action === "approve") return r.waived ? "You already approved this share." : "A share can be approved once the provider has posted what it is owed.";
  if (action === "dispute") return "This share cannot be disputed now: it must be posted, not approved, inside the dispute window, on a Budget with a judge.";
  return "This share cannot be paid out yet: it waits for your approval or the end of the dispute window.";
}
