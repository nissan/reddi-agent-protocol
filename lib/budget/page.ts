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
 *    to dispute, the RAP judge when one is set (`BUDGET_DEFAULT_JUDGE`) and
 *    the payer keeps it. A Budget without a judge also gets flag 0x01, so
 *    the relay releases each slice as soon as its provider posts
 *    (`./release`): with no judge, waiting out the window protects nobody.
 *    The agent's key is handed out here, once.
 * 3. `activateSpender` (custody) marks the record open once the open is
 *    finalized on chain and matches what the payer signed.
 * 4. `budgetStatus` reads the Budget and its slices on chain and says, for
 *    each slice, what the payer can do with it now.
 * 5. `buildBudgetAction` builds one payer transaction: approve (waive) a
 *    posted slice so it is paid at once, dispute it, close the Budget early,
 *    or pay out a slice whose window has ended (anyone may).
 *
 * Nothing here signs or sends: every transaction goes to the payer's wallet.
 * The network, program, USDC mint, tokens and caps are the build's
 * (`./network`); on mainnet a Budget holds USDC only, 1 to 100 USDC.
 */

import { createHash, randomBytes } from "crypto";
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
import { microUsdToLamports } from "@/lib/sandbox/pricing";
import { contactProblem } from "./alerts";
import { budgetProviderDirectory, budgetProviderView, type BudgetProvider, type BudgetTokenName } from "./providers";
import { AGENT_SECRET, createSpender, newAgentSecret, relayAuthorizationMessage, type CustodyDeps } from "./custody";
import { emailConfirmRequired, emailProofProblem } from "./email-confirm";
import { budgetLinkOrigin } from "./watch";
import type { SpenderRecord } from "./store";
import { BUDGET_NETWORK_TOKENS, BUDGET_USDC_MINT, budgetNetwork, MAINNET_BUDGET_CAPS, type BudgetNetwork } from "./network";

/** The cluster this build serves Budgets on (`./network`). */
export const BUDGET_NETWORK: BudgetNetwork = budgetNetwork();
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
export const DEVNET_USDC_MINT = BUDGET_USDC_MINT["solana-devnet"];
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Rounded up to a step, so the default reads as 0.0334 SOL, not 0.033333334. */
function roundUp(value: bigint, step: bigint): bigint {
  return ((value + step - BigInt(1)) / step) * step;
}

export type { BudgetTokenName };
export type BudgetTokenTerms = { decimals: number; min: bigint; max: bigint; mint: PublicKey | null; defaultTotal: bigint; offered: boolean };

/** Each token on a network: its mint there, the caps, the default total, and whether a Budget may hold it there. */
export function budgetTokens(network: BudgetNetwork): Record<BudgetTokenName, BudgetTokenTerms> {
  const mainnet = network === "solana-mainnet-beta";
  const offered = (t: BudgetTokenName) => BUDGET_NETWORK_TOKENS[network].includes(t);
  return {
    SOL: {
      decimals: 9,
      min: mainnet ? MAINNET_BUDGET_CAPS.SOL.min : BigInt(1),
      max: mainnet ? MAINNET_BUDGET_CAPS.SOL.max : MAX_SOL_BUDGET_LAMPORTS,
      mint: null,
      defaultTotal: roundUp(microUsdToLamports(BUDGET_DEFAULT_MICRO_USD), BigInt(100_000)),
      offered: offered("SOL"),
    },
    USDC: {
      decimals: 6,
      min: mainnet ? MAINNET_BUDGET_CAPS.USDC.min : BigInt(1),
      max: mainnet ? MAINNET_BUDGET_CAPS.USDC.max : MAX_TOKEN_BUDGET_BASE_UNITS,
      mint: BUDGET_USDC_MINT[network],
      defaultTotal: BUDGET_DEFAULT_MICRO_USD,
      offered: offered("USDC"),
    },
  };
}

/** The tokens of this build's network. */
export const BUDGET_TOKENS = budgetTokens(BUDGET_NETWORK);

export type BudgetFailure = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): BudgetFailure => ({ ok: false, status, code, message });
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** The providers a Budget can name on this page, for both tokens (`./providers`). */
export function budgetProviders(env: Record<string, string | undefined> = process.env): BudgetProvider[] {
  return budgetProviderDirectory(env);
}

export { budgetProviderView };

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

/**
 * Why no Budget may be opened with the judge as configured, or undefined when
 * it may (audit 1079ce8 S2-claude-16). A `BUDGET_DEFAULT_JUDGE` that is set but
 * not an address is always refused: a typo must not open Budgets nobody can
 * dispute. On mainnet the judge is required (docs/BUDGET-JUDGE.md); devnet may
 * still run without one.
 */
export function budgetJudgeProblem(network: BudgetNetwork, env: Record<string, string | undefined> = process.env): string | undefined {
  const set = Boolean(env.BUDGET_DEFAULT_JUDGE?.trim());
  if (set && !defaultBudgetJudge(env)) return "BUDGET_DEFAULT_JUDGE is set but is not a Solana address.";
  if (network === "solana-mainnet-beta" && !set) return "BUDGET_DEFAULT_JUDGE is not set: mainnet Budgets need the RAP judge.";
  return undefined;
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
  /**
   * The agent's secret, made at prepare: the payer signs its hash, so the
   * signer can hold the key to what the payer signed (RT-M2). It is shown
   * once, with the key, when the Budget starts.
   */
  agentSecret: string;
  /** Proof that the payer read the alert address (`email-confirm.ts`); needed where confirmation is required. */
  emailProof?: string;
  /**
   * Whether the RAP judge stands behind this Budget (the default). False: no
   * judge, so nothing can be disputed, and each provider is paid as soon as
   * it posts what it is owed (`./release`; Nissan, 27 November 2026).
   */
  judged?: boolean;
};

type CheckedTerms = {
  network: BudgetNetwork;
  payer: PublicKey;
  token: BudgetTokenName;
  total: bigint;
  cap: bigint;
  providers: BudgetProvider[];
  email: string;
  emailProof?: string;
  nonce: Buffer;
  budget: PublicKey;
  /** The judge the Budget names, or null for none. */
  judge: PublicKey | null;
  /**
   * The payer chose no judge: the Budget lets the spender waive (flag 0x01),
   * so the relay releases each slice on completion (`./release`). A Budget
   * with the judge does not, so a post waits for the payer's approval or the
   * end of the dispute window. The program lets the spender waive only with
   * an allowlist, and every Budget the page opens has one.
   */
  releaseOnCompletion: boolean;
};

function checkTerms(input: Partial<Record<keyof BudgetTerms, unknown>>, programId: PublicKey, env: Record<string, string | undefined> = process.env): CheckedTerms | BudgetFailure {
  const network = budgetNetwork(env);
  if (typeof input.payer !== "string" || !BASE58.test(input.payer)) return fail(400, "invalid_payer", "Connect a wallet first.");
  let payer: PublicKey;
  try {
    payer = new PublicKey(input.payer);
  } catch {
    return fail(400, "invalid_payer", "Connect a wallet first.");
  }
  if (input.judged !== undefined && typeof input.judged !== "boolean") return fail(400, "invalid_request", "Choose whether the RAP judge stands behind this Budget.");
  const judged = input.judged !== false;
  // The judge must be set up only for a Budget that names it.
  const judgeProblem = judged ? budgetJudgeProblem(network, env) : undefined;
  if (judgeProblem) {
    console.error(JSON.stringify({ source: "budget-page", event: "judge_not_configured", problem: judgeProblem }));
    return fail(503, "judge_not_configured", "New Budgets are paused while the RAP judge is set up. Try again later.");
  }
  if (input.token !== "SOL" && input.token !== "USDC") return fail(400, "invalid_token", "Pick SOL or USDC.");
  const token = budgetTokens(network)[input.token];
  if (!token.offered) return fail(400, "token_not_offered", `Budgets on this network hold ${BUDGET_NETWORK_TOKENS[network].join(" or ")} only.`);
  if (typeof input.total !== "string" || !/^\d{1,20}$/.test(input.total)) return fail(400, "invalid_amount", "Give the Budget an amount.");
  const total = BigInt(input.total);
  if (total <= BigInt(0)) return fail(400, "invalid_amount", "Give the Budget an amount.");
  if (total > token.max) return fail(400, "amount_too_large", `A Budget holds at most ${formatBase(token.max, token.decimals)} ${input.token} for now.`);
  if (total < token.min) return fail(400, "amount_too_small", `A Budget holds at least ${formatBase(token.min, token.decimals)} ${input.token}.`);
  const ids = Array.isArray(input.providerIds) ? [...new Set(input.providerIds.filter((x): x is string => typeof x === "string"))] : [];
  if (ids.length === 0) return fail(400, "providers_required", "Pick at least one provider your agent may pay.");
  if (ids.length > BUDGET_ALLOWLIST_LEN) return fail(400, "too_many_providers", `Pick at most ${BUDGET_ALLOWLIST_LEN} providers.`);
  const offered = budgetProviders(env);
  const providers = ids.map((id) => offered.find((p) => p.id === id));
  if (providers.some((p) => !p)) return fail(400, "unknown_provider", "One of those providers does not take Budgets.");
  const other = providers.find((p) => p!.token !== input.token);
  if (other) return fail(400, "provider_token_mismatch", `${other.name} is paid in ${other.token}, not ${input.token}. A Budget holds one token.`);
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const problem = contactProblem({ email });
  if (problem) return fail(400, "contact_required", problem);
  const unproved = emailProofProblem({ network, payer: payer.toBase58(), email, proof: input.emailProof, env });
  if (unproved === "not_configured") {
    console.error(JSON.stringify({ source: "budget-page", event: "email_confirm_not_configured" }));
    return fail(503, "email_confirm_not_configured", "New Budgets are paused while alert confirmation is set up. Try again later.");
  }
  if (unproved) return fail(409, "email_unconfirmed", "Confirm your alert email first: we send a link to it, and the Budget opens once you have opened that link.");
  const cap = total / BigInt(2);
  if (cap < minReservation(total)) return fail(400, "amount_too_small", "That Budget is too small to split between providers.");
  const nonceHex = typeof input.nonce === "string" && /^[0-9a-f]{32}$/.test(input.nonce) ? input.nonce : undefined;
  const nonce = nonceHex ? Buffer.from(nonceHex, "hex") : randomBytes(16);
  return { network, payer, token: input.token, total, cap, providers: providers as BudgetProvider[], email, ...(typeof input.emailProof === "string" ? { emailProof: input.emailProof } : {}), nonce, budget: budgetAddress(payer, nonce, programId), judge: judged ? defaultBudgetJudge(env) : null, releaseOnCompletion: !judged };
}

export function formatBase(units: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = units / base;
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function authorizationOf(t: CheckedTerms, issuedAt: number, programId: PublicKey, env: Record<string, string | undefined>, agentKeySha256: string) {
  return {
    agentKeySha256,
    network: t.network,
    payer: t.payer.toBase58(),
    budget: t.budget.toBase58(),
    providers: t.providers.map((p) => p.payee),
    // One reserve may take at most the per-provider cap: the most any slice can reach anyway.
    maxReserve: t.cap,
    contact: { email: t.email },
    issuedAt,
    // The Budget itself, so the wallet shows what is locked and activation can hold the Budget to it.
    terms: {
      site: new URL(budgetLinkOrigin(env)).host,
      programId: programId.toBase58(),
      mint: budgetTokens(t.network)[t.token].mint?.toBase58() ?? null,
      tokenName: t.token,
      total: t.total,
      judge: t.judge?.toBase58() ?? null,
      openSlots: BUDGET_OPEN_SLOTS,
      disputeSlots: BUDGET_DISPUTE_SLOTS,
      judgeSlots: BUDGET_JUDGE_SLOTS,
      spenderMayWaive: t.releaseOnCompletion,
    },
  };
}

/** Step 1: the terms with a fresh nonce, and the text the payer's wallet signs. */
export function prepareBudget(
  input: Partial<Record<keyof BudgetTerms, unknown>>,
  programId: PublicKey,
  nowMs: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): { ok: true; terms: BudgetTerms; budget: string; message: string } | BudgetFailure {
  const checked = checkTerms({ ...input, nonce: undefined }, programId, env);
  if ("ok" in checked) return checked;
  const issuedAt = Math.floor(nowMs / 1000);
  const { agentSecret, agentKeySha256 } = newAgentSecret();
  const message = relayAuthorizationMessage(authorizationOf(checked, issuedAt, programId, env, agentKeySha256));
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
      agentSecret,
      ...(checked.emailProof && emailConfirmRequired(checked.network, env) ? { emailProof: checked.emailProof } : {}),
      judged: !checked.releaseOnCompletion,
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
  if (typeof raw.agentSecret !== "string" || !AGENT_SECRET.test(raw.agentSecret)) return fail(400, "invalid_request", "Start again: the Budget's terms are incomplete.");
  const agentSecret = raw.agentSecret;
  const t = checkTerms(raw, input.programId, input.env ?? process.env);
  if ("ok" in t) return t;
  if (!deps.signer) return fail(503, "custody_not_configured", "Budgets are not switched on for this server yet.");
  const env = input.env ?? process.env;
  const spender = await p256SpenderAddress(deps.signer.publicKey);
  const mint = budgetTokens(t.network)[t.token].mint;
  const open = openBudgetInstruction({
    programId: input.programId,
    payer: t.payer,
    nonce: t.nonce,
    spender,
    judge: t.judge,
    spenderMayWaive: t.releaseOnCompletion,
    openSlots: BUDGET_OPEN_SLOTS,
    disputeSlots: BUDGET_DISPUTE_SLOTS,
    judgeSlots: BUDGET_JUDGE_SLOTS,
    total: t.total,
    perProviderCap: t.cap,
    allowlist: t.providers.map((p) => new PublicKey(p.payee)),
    p256Spender: true,
    ...(mint ? { token: { mint, source: associatedTokenAddress(t.payer, mint), tokenProgram: TOKEN_PROGRAM_ID } } : {}),
  });
  // The transaction is built before the record is stored, so a failure here leaves no record behind (a retry would get budget_taken).
  let transaction: string;
  try {
    transaction = withPriority(t.payer, await input.blockhash(), [open]);
  } catch {
    return fail(503, "chain_unavailable", "The chain could not be read. Nothing was made; try again.");
  }
  const created = await createSpender({ ...authorizationOf(t, raw.issuedAt, input.programId, env, createHash("sha256").update(agentSecret).digest("hex")), signature: input.signature, nonce: t.nonce.toString("hex"), agentSecret, programId: input.programId }, deps);
  if (!created.ok) {
    const status = created.code === "store_unavailable" || created.code === "custody_not_configured" || created.code === "alerts_not_configured" ? 503 : created.code === "not_the_payer" ? 403 : 400;
    return fail(status, created.code, created.message);
  }
  return {
    ok: true,
    id: created.record.id,
    agentSecret: created.agentSecret,
    budget: t.budget.toBase58(),
    record: created.record,
    transaction,
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
  /** Where the provider is paid (its wallet for SOL, its token account for a token). The page's action check uses it. */
  payoutAccount: string;
  /** Slot the dispute window ends, once the Budget is closed. */
  disputeEndsSlot?: string;
  judgeEndsSlot?: string;
  actions: SliceAction[];
  /** Added by the status route from the judge store (`lib/budget/evidence.ts`). */
  evidence?: import("./evidence").SliceEvidence;
};

export type BudgetView = {
  address: string;
  payer: string;
  token: BudgetTokenName;
  /** The Budget's mint, null for SOL. */
  mint: string | null;
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

const providerByPayTo = (payTo: string) => budgetProviderDirectory().find((p) => p.payee === payTo);

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
      payoutAccount: r.payoutAccount.toBase58(),
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
    mint: budget.mint?.toBase58() ?? null,
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
