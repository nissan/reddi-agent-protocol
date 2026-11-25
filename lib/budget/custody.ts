/**
 * Server only. Spender approvals for pooled Budgets the relay spends from
 * (audit round 4, R4-M3 / S7-claude-03; Vercel KMS since 24 November 2026).
 * A Budget's spender is the agent's authority to reserve slices of the
 * payer's money, so the relay uses it like one:
 *
 * - the spender is a P-256 key in Vercel KMS (`./kms`): the Budget is opened
 *   with flag 0x08 and names the key's SHA-256; the private key never leaves
 *   KMS, and the relay holds no key material at all;
 * - the relay builds every approval itself, for one `reserve`, `waive` or
 *   close of *its own* Budget (named by address and `created_slot`), with a
 *   short expiry (`APPROVAL_SLOTS`, about a minute), so a pause or freeze
 *   stops everything after it;
 * - a record is the payer's only by the payer's own signature (audit round
 *   5, R5-M1): the payer's wallet signs `relayAuthorizationMessage`, naming
 *   the Budget, the providers (its on-chain allowlist), the most one reserve
 *   may take and where alerts go; the record is pinned to that Budget when it
 *   is made, and one Budget has one record;
 * - reserve and waive approvals go only to whoever holds the agent secret
 *   handed out once with the record;
 * - a reserve only for a provider the payer named, up to the payer's
 *   maximum; a waive only for a slice that has posted the amount the agent
 *   names, read on chain (audit round 5, R5-L1);
 * - the slot an approval's expiry counts from is read from the relay's own
 *   RPC, after checking that RPC serves the record's cluster;
 * - every approval is logged before KMS is asked, in one database step that
 *   also checks the pause, the record's status and the overuse limit, so
 *   concurrent requests cannot slip past them; an approval that cannot be
 *   logged is not signed;
 * - a Budget approved more than `BUDGET_SPENDER_MAX_USES_PER_10_MIN` times in
 *   ten minutes is frozen and the operator alerted; one payer's Budgets past
 *   `BUDGET_SPENDER_MAX_PER_PAYER_PER_10_MIN`, or all relay Budgets on the
 *   network past `BUDGET_SPENDER_MAX_GLOBAL_PER_10_MIN`, are refused until the
 *   count drops, and the operator told (R5-M2, round 5b); the agent's closes
 *   count too;
 * - nothing is approved while Budgets are paused (`BUDGET_SPENDING_PAUSED` set
 *   to anything but `false`/`0`/`no`/`off`, or the pause switch in the
 *   database), except the incident step's close;
 * - every signature KMS returns is checked against the key the Budget names
 *   before it is handed out.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  BUDGET_ALLOWLIST_LEN,
  budgetAddress,
  budgetApprovalMessage,
  closeBudgetInstruction,
  decodeBudget,
  decodeReservation,
  p256SpenderAddress,
  reservationAddress,
  reserveInstruction,
  secp256r1ApprovalInstruction,
  waiveInstruction,
  type BudgetTokenClose,
} from "@redditech/x402-solana/budget";
import { ed25519Verify } from "@redditech/x402-solana/ed25519";
import { budgetRequestMessage, type BudgetAction } from "@redditech/x402-solana/budget-provider";
import { signApproval, type SpenderSigner } from "./kms";
import { alertConfigProblem, contactProblem, sendBudgetAlert, type AlertSender } from "./alerts";
import { GENESIS_HASH, type BudgetContact, type BudgetCustodyStore, type BudgetNetwork, type SpenderRecord } from "./store";

export const DEFAULT_MAX_USES_PER_10_MIN = 30;
/** All relay Budgets together, in ten minutes: past this, Budget spending is paused (R5-M2). */
export const DEFAULT_MAX_GLOBAL_PER_10_MIN = 300;
/** All of one payer's relay Budgets, in ten minutes: so one payer cannot use up the shared ceiling (round 5b). */
export const DEFAULT_MAX_PER_PAYER_PER_10_MIN = 60;
/**
 * Paid calls are counted apart from approvals, with their own limits: an
 * agent makes many calls for each reserve, and a call can only spend what a
 * reserve already put in a provider's slice.
 */
export const DEFAULT_MAX_CALLS_PER_10_MIN = 300;
export const DEFAULT_MAX_CALLS_PER_PAYER_PER_10_MIN = 600;
export const DEFAULT_MAX_CALLS_GLOBAL_PER_10_MIN = 6_000;
/** The most calls one provider's slice of one Budget is signed for. */
export const MAX_CALL_SEQUENCE = 1_000_000;
/** A pending record activates only this long after the payer signed (round 5b). */
export const PENDING_MAX_AGE_SECONDS = 60 * 60;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const U64_MAX = BigInt("18446744073709551615");
/** How old (or how far ahead) a payer's authorization may be when the record is made. */
export const AUTHORIZATION_MAX_AGE_SECONDS = 600;
const AUTHORIZATION_MAX_AHEAD_SECONDS = 120;

/** What the relay reads from its own RPC: never from a request (audit round 5, S6-claude-03). */
export interface CustodyChain {
  slot(): Promise<bigint>;
  genesisHash(): Promise<string>;
  readAccount(address: PublicKey, commitment?: "confirmed" | "finalized"): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
}

export type CustodyDeps = {
  store: BudgetCustodyStore;
  /** The KMS key new Budgets name and that approves (`./kms`). Undefined: nothing is made or approved. */
  signer: SpenderSigner | undefined;
  sender: AlertSender;
  /** The relay's own RPC. Undefined: nothing is approved. */
  chain?: CustodyChain;
  /**
   * The one network this signer approves for (one KMS issuer per cluster,
   * R5-M2). Set by the Budget signer project; a record on another network is
   * refused before anything is logged or signed.
   */
  network?: BudgetNetwork;
  env?: Record<string, string | undefined>;
  nowMs?: number;
};

export type CustodyFailure = { ok: false; code: string; message: string };
const refuse = (code: string, message: string): CustodyFailure => ({ ok: false, code, message });

/**
 * How long a reserve or close approval stays usable: 150 slots, about a
 * minute. There is no nonce; replay is stopped by the Budget's own state (a
 * reserve must raise the slice, a waive or close happens once) and by this
 * expiry.
 */
export const APPROVAL_SLOTS = BigInt(150);
/** A waive does not name the amount on chain, so its approval lives shorter: about 20 seconds (R5-L1). */
export const WAIVE_APPROVAL_SLOTS = BigInt(50);

export type RelayAuthorization = {
  network: BudgetNetwork;
  payer: string;
  budget: string;
  /** The providers, as the Budget's allowlist will name them. */
  providers: string[];
  /** The most one reserve approval may name, in base units. */
  maxReserve: bigint;
  contact: Pick<BudgetContact, "email" | "webhook">;
  /** Unix seconds. */
  issuedAt: number;
  /**
   * The Budget's own terms, so the payer's wallet shows what it locks and
   * activation can hold the Budget on chain to them (audit 2026-11-25, routes
   * Low). The Budget page always sends them.
   */
  terms?: RelayBudgetTerms;
};

/** What the payer signs about the Budget itself. Amounts and slots in base units. */
export type RelayBudgetTerms = {
  /** The site that asked, such as `app.agent-protocol.reddi.tech`. */
  site: string;
  programId: string;
  /** Null for SOL. */
  mint: string | null;
  /** How the wallet shows the token, such as `SOL` or `USDC`. */
  tokenName: string;
  total: bigint;
  judge: string | null;
  openSlots: bigint;
  disputeSlots: bigint;
  judgeSlots: bigint;
  /** Whether the agent may approve a provider's posted total by itself (flag 0x01). */
  spenderMayWaive: boolean;
};

/**
 * The text the payer's wallet signs (Ed25519, as `signMessage` does) to let
 * the relay spend from one Budget. Providers are sorted, so the order the
 * payer picked them in does not matter.
 */
export function relayAuthorizationMessage(a: RelayAuthorization): Uint8Array {
  return new TextEncoder().encode(
    [
      "Reddi Agent Protocol: let the RAP relay spend from my Budget",
      `network: ${a.network}`,
      `payer: ${a.payer}`,
      `budget: ${a.budget}`,
      `providers: ${[...new Set(a.providers)].sort().join(",")}`,
      `max reserve: ${a.maxReserve.toString()}`,
      `alerts email: ${a.contact.email ?? "-"}`,
      `alerts webhook: ${a.contact.webhook ?? "-"}`,
      ...(a.terms
        ? [
            `site: ${a.terms.site}`,
            `program: ${a.terms.programId}`,
            `token: ${a.terms.tokenName} (${a.terms.mint ?? "native SOL"})`,
            `total: ${a.terms.total.toString()} base units`,
            `per provider at most: ${a.maxReserve.toString()} base units`,
            `judge: ${a.terms.judge ?? "none"}`,
            `open for: ${a.terms.openSlots.toString()} slots; dispute window: ${a.terms.disputeSlots.toString()} slots; judge window: ${a.terms.judgeSlots.toString()} slots`,
            `agent may approve posted totals: ${a.terms.spenderMayWaive ? "yes" : "no"}`,
          ]
        : []),
      `issued at: ${a.issuedAt}`,
    ].join("\n"),
  );
}

function decodeSignature(value: string): Uint8Array | undefined {
  const bytes = /^[0-9a-fA-F]{128}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  return bytes.length === 64 ? Uint8Array.from(bytes) : undefined;
}

const sha256Hex = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/**
 * Records a Budget the payer is about to open, on the payer's signed
 * authorization (R5-M1). The payer then opens that Budget with flag 0x08,
 * `spender` (the SHA-256 of the relay's KMS public key) as its spender and
 * `providers` as its allowlist. Every Budget the relay spends from names the
 * same key, so the record is pinned to its Budget here, and a Budget has one
 * record. `agentSecret` is returned once: the agent presents it to have a
 * reserve or waive approved.
 */
export async function createSpender(
  input: RelayAuthorization & {
    signature: string;
    /** The Budget's 16-byte nonce (hex): the Budget must be the payer's own address for it, so nobody can claim another payer's Budget first. */
    nonce: string;
    programId: PublicKey;
  },
  deps: CustodyDeps,
): Promise<{ ok: true; record: SpenderRecord; agentSecret: string } | CustodyFailure> {
  if (!deps.signer) return refuse("custody_not_configured", "Budget spending is not set up: BUDGET_SPENDER_KMS_ISSUER_ID or BUDGET_SPENDER_P256_PUBLIC_KEY is missing.");
  if (!BASE58.test(input.payer)) return refuse("invalid_payer", "The payer is not a Solana address.");
  if (!BASE58.test(input.budget)) return refuse("invalid_budget", "The Budget is not a Solana address.");
  if (input.network !== "solana-devnet" && input.network !== "solana-mainnet-beta") return refuse("invalid_network", "Unknown network.");
  const ownBudget = (() => {
    try {
      return typeof input.nonce === "string" && /^[0-9a-f]{32}$/.test(input.nonce) && budgetAddress(new PublicKey(input.payer), Buffer.from(input.nonce, "hex"), input.programId).toBase58() === input.budget;
    } catch {
      return false;
    }
  })();
  if (!ownBudget) return refuse("budget_mismatch", "The Budget is not the payer's Budget for that nonce.");
  const problem = contactProblem(input.contact);
  if (problem) return refuse("contact_required", problem);
  const unreachable = alertConfigProblem(input.contact, deps.env ?? process.env);
  if (unreachable) return refuse("alerts_not_configured", unreachable);
  const providers = [...new Set(input.providers ?? [])].sort();
  if (providers.length === 0) return refuse("providers_required", "Name the providers this Budget may pay: a relay Budget needs an allowlist.");
  if (providers.length > BUDGET_ALLOWLIST_LEN) return refuse("too_many_providers", `A Budget's allowlist holds at most ${BUDGET_ALLOWLIST_LEN} providers.`);
  if (providers.some((p) => !BASE58.test(p))) return refuse("invalid_payee", "A provider is not a Solana address.");
  if (typeof input.maxReserve !== "bigint" || input.maxReserve <= BigInt(0) || input.maxReserve > U64_MAX) return refuse("invalid_amount", "The maximum reserve is not a positive u64.");
  const nowS = Math.floor((deps.nowMs ?? Date.now()) / 1000);
  if (!Number.isInteger(input.issuedAt) || input.issuedAt < nowS - AUTHORIZATION_MAX_AGE_SECONDS || input.issuedAt > nowS + AUTHORIZATION_MAX_AHEAD_SECONDS) {
    return refuse("authorization_expired", "The payer's authorization is too old (or dated ahead): sign it again.");
  }
  const signature = decodeSignature(input.signature ?? "");
  const contact = { ...(input.contact.email ? { email: input.contact.email } : {}), ...(input.contact.webhook ? { webhook: input.contact.webhook } : {}) };
  const message = relayAuthorizationMessage({ ...input, providers, contact });
  let signedByPayer = false;
  try {
    signedByPayer = signature !== undefined && ed25519Verify(new PublicKey(input.payer), message, signature);
  } catch {
    signedByPayer = false;
  }
  if (!signedByPayer || !signature) {
    return refuse("not_the_payer", "The authorization is not signed by the payer's wallet.");
  }
  const agentSecret = `rap_budget_${randomBytes(32).toString("base64url")}`;
  const record: SpenderRecord = {
    id: randomBytes(16).toString("hex"),
    spender: (await p256SpenderAddress(deps.signer.publicKey)).toBase58(),
    spenderKey: Buffer.from(deps.signer.publicKey).toString("hex"),
    payer: input.payer,
    network: input.network,
    status: "pending",
    budget: input.budget,
    contact: { ...contact, ...(contact.webhook ? { webhookSecret: randomBytes(32).toString("base64url") } : {}) },
    expectedPayees: providers,
    maxReserve: input.maxReserve.toString(),
    ...(input.terms
      ? {
          terms: {
            site: input.terms.site,
            programId: input.terms.programId,
            mint: input.terms.mint,
            tokenName: input.terms.tokenName,
            total: input.terms.total.toString(),
            judge: input.terms.judge,
            openSlots: input.terms.openSlots.toString(),
            disputeSlots: input.terms.disputeSlots.toString(),
            judgeSlots: input.terms.judgeSlots.toString(),
            spenderMayWaive: input.terms.spenderMayWaive,
          },
        }
      : {}),
    authorization: { issuedAt: input.issuedAt, signature: Buffer.from(signature).toString("base64") },
    agentSecretSha256: sha256Hex(agentSecret),
    seen: {},
    version: 1,
    createdAt: new Date(deps.nowMs ?? Date.now()).toISOString(),
  };
  const created = await deps.store.create(record);
  if (!created.ok) {
    return created.code === "budget_taken"
      ? refuse("budget_taken", "The relay already holds a record for that Budget.")
      : refuse("store_unavailable", "The Budget record could not be stored. Nothing was made; try again.");
  }
  return { ok: true, record, agentSecret };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/**
 * Once the payer's open landed: checks the record's Budget on chain is a
 * P-256-spender Budget that names this record's payer and spender, with an
 * allowlist of exactly the providers the payer signed for, then marks it
 * open. Only an open record approves a reserve.
 */
export async function activateSpender(
  input: { id: string; programId: PublicKey },
  deps: CustodyDeps,
): Promise<{ ok: true; record: SpenderRecord } | CustodyFailure> {
  const chain = deps.chain;
  if (!chain) return refuse("chain_unavailable", "The relay has no RPC to read the Budget from.");
  const record = await deps.store.byId(input.id);
  if (!record) return refuse("unknown_budget_key", "No Budget record with that id.");
  // Only a pending record activates: a frozen one (an incident froze it before the payer opened) stays frozen.
  if (record.status !== "pending") return refuse("not_pending", `This Budget record is ${record.status}.`);
  if (!record.budget || !record.authorization) return refuse("not_authorized", "This record has no payer authorization (made before audit round 5): make a new one.");
  if (Math.floor((deps.nowMs ?? Date.now()) / 1000) > record.authorization.issuedAt + PENDING_MAX_AGE_SECONDS) {
    return refuse("authorization_expired", "The payer signed for this Budget over an hour ago and it was not opened in time: sign a new authorization with a new nonce.");
  }
  // Read through the relay's own RPC, and only once it is known to serve the record's cluster (round 5b).
  let account;
  try {
    if ((await chain.genesisHash()) !== GENESIS_HASH[record.network]) return refuse("wrong_cluster", "The relay's RPC does not serve this Budget's network.");
    account = await chain.readAccount(new PublicKey(record.budget), "finalized");
  } catch {
    return refuse("chain_unavailable", "The relay could not read the chain; try again.");
  }
  if (!account || !account.owner.equals(input.programId)) return refuse("budget_not_found", "The Budget is not open on chain yet.");
  let budget;
  try {
    budget = decodeBudget(account.data);
  } catch {
    return refuse("budget_not_found", "That account is not a Budget.");
  }
  if (budget.payer.toBase58() !== record.payer || budget.spender.toBase58() !== record.spender) {
    return refuse("budget_mismatch", "That Budget does not name this payer and spender.");
  }
  if (!budget.p256Spender) return refuse("budget_not_p256", "That Budget was not opened with a P-256 spender (flag 0x08).");
  if (budget.closed) return refuse("budget_closed", "That Budget is already closed.");
  if (!sameSet(budget.allowlist.map((k) => k.toBase58()), record.expectedPayees)) {
    return refuse("allowlist_mismatch", "That Budget's allowlist is not the providers the payer named.");
  }
  const t = record.terms;
  if (t) {
    // The Budget on chain must be the one the payer signed for, term by term.
    const differs =
      t.programId !== input.programId.toBase58() ||
      (budget.mint?.toBase58() ?? null) !== t.mint ||
      budget.total.toString() !== t.total ||
      (budget.judge?.toBase58() ?? null) !== t.judge ||
      budget.openSlots.toString() !== t.openSlots ||
      budget.disputeSlots.toString() !== t.disputeSlots ||
      budget.judgeSlots.toString() !== t.judgeSlots ||
      budget.spenderMayWaive !== t.spenderMayWaive ||
      budget.perProviderCap.toString() !== record.maxReserve;
    if (differs) return refuse("terms_mismatch", "That Budget's terms on chain are not the ones the payer signed for.");
  }
  const next: SpenderRecord = {
    ...record,
    status: "open",
    createdSlot: budget.createdSlot.toString(),
    ...(budget.mint ? { mint: budget.mint.toBase58() } : {}),
    version: record.version + 1,
  };
  const written = await deps.store.update(next);
  return written.ok ? { ok: true, record: next } : refuse("store_unavailable", "The Budget could not be marked open; try again.");
}

type Purpose = "reserve" | "waive" | "close";

/** What the caller wants approved. The relay builds the approval and the call from it. */
export type ApprovalRequest =
  | { purpose: "reserve"; payee: string; amount: bigint; payoutAccount?: string }
  /** `amount`: what the agent accepts the provider posted. The relay checks it on chain. */
  | { purpose: "waive"; payee: string; amount: bigint }
  | { purpose: "close"; token?: BudgetTokenClose };

/**
 * Who is asking. The agent presents the secret it got with the record; the
 * operator's incident step may only close.
 */
export type ApprovalAuth = { agentSecret: string } | { operator: "incident" };

export type Approved = {
  ok: true;
  purpose: Purpose;
  expiresSlot: bigint;
  /** The secp256r1 approval, then the Budget call. Send them in this order, next to each other. */
  instructions: [TransactionInstruction, TransactionInstruction];
};

function limitFrom(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** `BUDGET_SPENDING_PAUSED`: any value but empty, `false`, `0`, `no` or `off` pauses. */
export function pausedByEnv(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return Boolean(v) && !["false", "0", "no", "off"].includes(v!);
}

/** Freezes a record: it then approves only the close. Alerts the operator. */
export async function freezeSpender(record: SpenderRecord, reason: string, deps: CustodyDeps): Promise<SpenderRecord | undefined> {
  let current: SpenderRecord | undefined = record;
  for (let attempt = 0; attempt < 5 && current; attempt += 1) {
    if (current.status === "closed" || current.status === "closing" || current.status === "frozen") return current;
    const next: SpenderRecord = { ...current, status: "frozen", frozenReason: reason, version: current.version + 1 };
    const written = await deps.store.update(next);
    if (written.ok) {
      await sendBudgetAlert(
        {
          audience: "operator",
          kind: "budget_frozen",
          subject: `Budget ${next.budget ?? next.id} frozen: ${reason}`,
          text: `The relay froze Budget ${next.budget ?? "(not open yet)"} of payer ${next.payer}. It now approves only the close.\nReason: ${reason}\nNext: run the incident close for it, or check and unfreeze by hand.`,
          detail: { budget: next.budget ?? null, payer: next.payer, reason },
          spenderId: next.id,
        },
        undefined,
        deps,
      );
      return next;
    }
    current = await deps.store.byId(record.id);
  }
  return undefined;
}

function secretMatches(record: SpenderRecord, secret: string): boolean {
  if (!record.agentSecretSha256 || typeof secret !== "string" || secret.length === 0) return false;
  const a = Buffer.from(sha256Hex(secret), "hex");
  const b = Buffer.from(record.agentSecretSha256, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Approves one call as the spender of Budget record `id`, after every check
 * above. The caller sends both instructions, in order, in a transaction it
 * pays for; the provider signs a reserve as the payee. Pausing or freezing
 * does not revoke an approval already given, but it expires after
 * `APPROVAL_SLOTS` (`WAIVE_APPROVAL_SLOTS` for a waive), counted from the
 * slot the relay reads from its own RPC.
 */
export async function approveAsSpender(
  input: { id: string; auth: ApprovalAuth; request: ApprovalRequest; programId: PublicKey; caller?: string },
  deps: CustodyDeps,
): Promise<Approved | CustodyFailure> {
  const env = deps.env ?? process.env;
  const nowMs = deps.nowMs ?? Date.now();
  const signer = deps.signer;
  if (!signer) return refuse("custody_not_configured", "Budget spending is not set up: BUDGET_SPENDER_KMS_ISSUER_ID or BUDGET_SPENDER_P256_PUBLIC_KEY is missing.");
  if (signer.publicKeyOnly) return refuse("signer_elsewhere", "This deployment does not sign Budget approvals: ask the Budget signer.");
  const chain = deps.chain;
  if (!chain) return refuse("chain_unavailable", "The relay has no RPC to read the slot from.");
  const record = await deps.store.byId(input.id);
  if (!record || !record.spenderKey) return refuse("unknown_budget_key", "No usable Budget record with that id.");
  if (deps.network && record.network !== deps.network) return refuse("wrong_cluster", `This signer approves only ${deps.network} Budgets.`);
  const request = input.request;
  const { purpose } = request;
  if ("operator" in input.auth) {
    if (input.auth.operator !== "incident" || purpose !== "close") return refuse("not_authorized", "The operator path approves only a close.");
  } else if (!secretMatches(record, input.auth.agentSecret)) {
    return refuse("not_authorized", "That is not this Budget's agent secret.");
  }
  if (!record.budget || !record.createdSlot) return refuse("budget_not_open", "This Budget record has no open Budget.");
  const operator = async (subject: string, detail: Record<string, unknown>) =>
    sendBudgetAlert({ audience: "operator", kind: "sign_refused", subject, text: `${subject}\nBudget ${record.budget ?? record.id}, payer ${record.payer}.`, detail: { budget: record.budget ?? null, ...detail }, spenderId: record.id }, undefined, deps);
  const payee = request.purpose === "close" ? undefined : request.payee;
  if (payee !== undefined && !BASE58.test(payee)) return refuse("invalid_payee", "The provider is not a Solana address.");
  if (request.purpose !== "close" && (typeof request.amount !== "bigint" || request.amount <= BigInt(0) || request.amount > U64_MAX)) {
    return refuse("invalid_amount", "The amount is not a positive u64.");
  }
  if (request.purpose === "reserve" && request.payoutAccount !== undefined && !BASE58.test(request.payoutAccount)) {
    return refuse("invalid_payout_account", "The payout account is not a Solana address.");
  }

  const byOperator = "operator" in input.auth;
  // Only the incident step's close goes through a pause; the agent's close is paused and counted like the rest (round 5b).
  if (!byOperator && pausedByEnv(env.BUDGET_SPENDING_PAUSED)) return refuse("budgets_paused", "Budget spending is paused by the operator.");
  if (purpose !== "close") {
    if (record.status !== "open") return refuse("budget_not_open", `This Budget is ${record.status}: it approves only the close.`);
    if (!record.expectedPayees.includes(payee!)) {
      await operator(`Refused a ${purpose} for a provider the payer did not name`, { code: "unexpected_payee", payee: payee ?? null });
      return refuse("unexpected_payee", "The payer did not name this provider for this Budget.");
    }
    if (request.purpose === "reserve" && (!record.maxReserve || request.amount > BigInt(record.maxReserve))) {
      return refuse("above_max_reserve", `The payer allows at most ${record.maxReserve ?? 0} per reserve.`);
    }
  } else if (record.status === "closed") {
    return refuse("budget_closed", "This Budget is closed.");
  }

  // The slot comes from the relay's own RPC, and only once it is known to serve the record's cluster.
  let currentSlot: bigint;
  try {
    if ((await chain.genesisHash()) !== GENESIS_HASH[record.network]) {
      await operator("The relay's RPC is not on this Budget's cluster", { code: "wrong_cluster", network: record.network });
      return refuse("wrong_cluster", "The relay's RPC does not serve this Budget's network.");
    }
    currentSlot = await chain.slot();
  } catch {
    return refuse("chain_unavailable", "The relay could not read the chain; try again.");
  }

  const budget = new PublicKey(record.budget);
  const createdSlot = BigInt(record.createdSlot);
  if (request.purpose === "waive") {
    // A waive approval does not name the amount on chain, so the relay checks the slice itself (R5-L1).
    let slice;
    let onChain;
    try {
      const [budgetAccount, sliceAccount] = await Promise.all([chain.readAccount(budget), chain.readAccount(reservationAddress(budget, new PublicKey(request.payee), input.programId))]);
      onChain = budgetAccount && budgetAccount.owner.equals(input.programId) ? decodeBudget(budgetAccount.data) : undefined;
      slice = sliceAccount && sliceAccount.owner.equals(input.programId) ? decodeReservation(sliceAccount.data) : undefined;
    } catch {
      return refuse("chain_unavailable", "The relay could not read the slice; try again.");
    }
    if (!onChain || onChain.createdSlot !== createdSlot || onChain.closed) return refuse("budget_not_open", "This Budget is not open on chain.");
    if (!slice || slice.budgetCreatedSlot !== createdSlot || !slice.payee.equals(new PublicKey(request.payee))) return refuse("slice_not_found", "That provider has no slice of this Budget.");
    if (slice.state !== "posted" || slice.waived) return refuse("slice_not_posted", "Only a posted slice that was not waived can be waived.");
    if (slice.finalAmount !== request.amount) return refuse("amount_mismatch", `The provider posted ${slice.finalAmount}, not ${request.amount}.`);
  }

  const expiresSlot = currentSlot + (purpose === "waive" ? WAIVE_APPROVAL_SLOTS : APPROVAL_SLOTS);
  const approved = { p256ExpiresSlot: expiresSlot };
  const payoutAccount = request.purpose === "reserve" ? request.payoutAccount : undefined;
  const message = budgetApprovalMessage({
    programId: input.programId,
    budget,
    createdSlot,
    action: purpose,
    ...(payee ? { payee: new PublicKey(payee) } : {}),
    ...(request.purpose === "reserve" ? { amount: request.amount, ...(payoutAccount ? { payoutAccount: new PublicKey(payoutAccount) } : {}) } : {}),
    expiresSlot,
    cluster: record.network === "solana-mainnet-beta" ? "mainnet" : "devnet",
  });

  const detail: Record<string, string> = {
    message: Buffer.from(message).toString("hex"),
    expiresSlot: expiresSlot.toString(),
    createdSlot: record.createdSlot,
    caller: (input.caller ?? ("operator" in input.auth ? `operator:${input.auth.operator}` : "agent")).slice(0, 120),
    ...(request.purpose !== "close" ? { amount: request.amount.toString() } : {}),
    ...(payoutAccount ? { payoutAccount } : {}),
  };
  const limits = {
    perBudget: limitFrom(env.BUDGET_SPENDER_MAX_USES_PER_10_MIN, DEFAULT_MAX_USES_PER_10_MIN),
    perPayer: limitFrom(env.BUDGET_SPENDER_MAX_PER_PAYER_PER_10_MIN, DEFAULT_MAX_PER_PAYER_PER_10_MIN),
    global: limitFrom(env.BUDGET_SPENDER_MAX_GLOBAL_PER_10_MIN, DEFAULT_MAX_GLOBAL_PER_10_MIN),
  };
  const claim = await deps.store.claimUse({ spenderId: record.id, purpose, ...(payee ? { payee } : {}), messageSha256: sha256Hex(message), at: new Date(nowMs).toISOString(), detail, ...(byOperator ? { byOperator: true } : {}) }, limits);
  if (claim === "overuse") {
    await freezeSpender(record, `approved more than ${limits.perBudget} times in ten minutes`, deps);
    return refuse("key_overuse", "This Budget was approved too often and is frozen. The operator was alerted.");
  }
  if (claim === "payer_overuse") {
    await operator(`Refused: payer ${record.payer} asked for more than ${limits.perPayer} approvals in ten minutes`, { code: "payer_overuse", limit: limits.perPayer });
    return refuse("payer_overuse", "This payer's Budgets were approved too often in the last ten minutes; try again later.");
  }
  if (claim === "global_overuse" || claim === "global_overuse_new") {
    // A ceiling, not a pause (round 5b): it lifts by itself, so requests alone cannot stop every relay Budget for long.
    if (claim === "global_overuse_new") {
      await sendBudgetAlert(
        {
          audience: "operator",
          kind: "key_overuse",
          subject: "The relay hit its approval ceiling across all Budgets",
          text: `All relay Budgets on ${record.network} together asked for ${limits.global} approvals in ten minutes (BUDGET_SPENDER_MAX_GLOBAL_PER_10_MIN). Further approvals are refused until the count drops; closes by the incident step still go through. Check the approval log for who asked. If the relay or its KMS access may be compromised, run the incident step.`,
          detail: { limit: limits.global, network: record.network },
        },
        undefined,
        deps,
      );
    }
    return refuse("global_overuse", "The relay is at its approval ceiling; try again in a few minutes.");
  }
  if (claim === "paused") return refuse("budgets_paused", "Budget spending is paused by the operator.");
  if (claim === "not_open") return refuse("budget_not_open", "This Budget is no longer open: it approves only the close.");
  if (claim === "closed") return refuse("budget_closed", "This Budget is closed.");
  if (claim === "unknown") return refuse("unknown_budget_key", "No usable Budget record with that id.");
  if (claim !== "ok") return refuse("store_unavailable", "The use could not be logged, so nothing was signed.");

  const publicKey = Uint8Array.from(Buffer.from(record.spenderKey, "hex"));
  const signed = await signApproval(signer, publicKey, message);
  if (!signed.ok) {
    await operator(`KMS approval failed for a Budget: ${signed.code}`, { code: signed.code });
    return refuse(signed.code, signed.message);
  }
  const precompile = secp256r1ApprovalInstruction({ publicKey, signature: signed.signature, message });
  let call: TransactionInstruction;
  if (request.purpose === "reserve") {
    call = reserveInstruction({ programId: input.programId, budget, createdSlot, spender: approved, payee: new PublicKey(request.payee), amount: request.amount, ...(payoutAccount ? { payoutAccount: new PublicKey(payoutAccount) } : {}) });
  } else if (request.purpose === "waive") {
    call = waiveInstruction({ programId: input.programId, budget, createdSlot, payee: new PublicKey(request.payee), signer: approved });
  } else {
    call = closeBudgetInstruction({ programId: input.programId, budget, createdSlot, signer: approved, payer: new PublicKey(record.payer), ...(request.token ? { token: request.token } : {}) });
  }
  return { ok: true, purpose, expiresSlot, instructions: [precompile, call] };
}

/**
 * What the relay asks the spender to sign for one paid call
 * (`budgetRequestMessage`, action `call`). The call number is not asked for:
 * the signer gives each call the next number of its own counter.
 */
export type CallRequest = { payee: string; bodyHash: string };

export type SignedCall = {
  ok: true;
  /** The Budget instance the signature names. */
  budget: string;
  createdSlot: bigint;
  /** The call number this signature carries, from the signer's counter. */
  sequence: number;
  /** The spender's 33-byte compressed key. */
  publicKey: Uint8Array;
  /** 64-byte low-S r || s over `budgetRequestMessage`. */
  signature: Uint8Array;
};

/**
 * Signs one paid call as the spender of Budget record `id`, for the agent
 * holding its secret (`x402-budget-signature`, P-256 form). A call moves no
 * money on chain: the provider meters it against the slice a reserve already
 * put aside, so the most a call signature can let a provider charge is that
 * slice. Still, every call is for a provider the payer named, only while the
 * record is open, logged before KMS is asked, and counted against its own
 * limits (`BUDGET_CALLS_MAX_*`), past which the Budget is frozen like an
 * approval overuse. The message (`reddi-budget/1 …` text) cannot be read as
 * an approval: those are 175 bytes that start with `RAP-BUDGET-SPENDER-V1`.
 *
 * Call numbers (audit 2026-11-25, bbe1828 M-a): the signer keeps one counter
 * per Budget and provider and signs each number once, for one body. A number
 * is taken before KMS is asked, so a failed call leaves a gap rather than a
 * number that could be signed again over another body; providers accept any
 * number above the last one they served. Neither the relay nor the provider
 * can choose a number.
 */
export async function signCallAsSpender(
  input: { id: string; agentSecret: string; call: CallRequest; caller?: string },
  deps: CustodyDeps,
): Promise<SignedCall | CustodyFailure> {
  const env = deps.env ?? process.env;
  const nowMs = deps.nowMs ?? Date.now();
  const signer = deps.signer;
  if (!signer) return refuse("custody_not_configured", "Budget spending is not set up: BUDGET_SPENDER_KMS_ISSUER_ID or BUDGET_SPENDER_P256_PUBLIC_KEY is missing.");
  if (signer.publicKeyOnly) return refuse("signer_elsewhere", "This deployment does not sign Budget calls: ask the Budget signer.");
  const record = await deps.store.byId(input.id);
  if (!record || !record.spenderKey) return refuse("unknown_budget_key", "No usable Budget record with that id.");
  if (deps.network && record.network !== deps.network) return refuse("wrong_cluster", `This signer signs only ${deps.network} Budgets.`);
  if (!secretMatches(record, input.agentSecret)) return refuse("not_authorized", "That is not this Budget's agent secret.");
  if (!record.budget || !record.createdSlot) return refuse("budget_not_open", "This Budget record has no open Budget.");
  const { payee, bodyHash } = input.call;
  const action: BudgetAction = "call";
  if (typeof payee !== "string" || !BASE58.test(payee)) return refuse("invalid_payee", "The provider is not a Solana address.");
  if (typeof bodyHash !== "string" || !/^[0-9a-f]{64}$/.test(bodyHash)) return refuse("invalid_body_hash", "The body hash is not a SHA-256 in hex.");
  if (pausedByEnv(env.BUDGET_SPENDING_PAUSED)) return refuse("budgets_paused", "Budget spending is paused by the operator.");
  if (record.status !== "open") return refuse("budget_not_open", `This Budget is ${record.status}: it signs no more calls.`);
  if (!record.expectedPayees.includes(payee)) {
    await sendBudgetAlert(
      { audience: "operator", kind: "sign_refused", subject: "Refused a call for a provider the payer did not name", text: `Refused a call for a provider the payer did not name.\nBudget ${record.budget}, payer ${record.payer}.`, detail: { budget: record.budget, code: "unexpected_payee", payee }, spenderId: record.id },
      undefined,
      deps,
    );
    return refuse("unexpected_payee", "The payer did not name this provider for this Budget.");
  }
  const createdSlot = BigInt(record.createdSlot);
  const limits = {
    perBudget: limitFrom(env.BUDGET_CALLS_MAX_PER_10_MIN, DEFAULT_MAX_CALLS_PER_10_MIN),
    perPayer: limitFrom(env.BUDGET_CALLS_MAX_PER_PAYER_PER_10_MIN, DEFAULT_MAX_CALLS_PER_PAYER_PER_10_MIN),
    global: limitFrom(env.BUDGET_CALLS_MAX_GLOBAL_PER_10_MIN, DEFAULT_MAX_CALLS_GLOBAL_PER_10_MIN),
  };
  // The number is taken first, so it is never signed twice even when the log or KMS fails after.
  const sequence = await takeCallNumber(record.id, payee, deps.store);
  if (sequence === "exhausted") return refuse("call_numbers_used", `This Budget has made ${MAX_CALL_SEQUENCE} calls to this provider; open a new Budget.`);
  if (sequence === undefined) return refuse("store_unavailable", "The call could not be numbered, so nothing was signed.");
  const message = new TextEncoder().encode(budgetRequestMessage({ genesisHash: GENESIS_HASH[record.network], action, budget: record.budget, createdSlot, provider: payee, sequence, bodyHash }));
  const operator = async (subject: string, detail: Record<string, unknown>) =>
    sendBudgetAlert({ audience: "operator", kind: "sign_refused", subject, text: `${subject}\nBudget ${record.budget ?? record.id}, payer ${record.payer}.`, detail: { budget: record.budget ?? null, ...detail }, spenderId: record.id }, undefined, deps);
  const detail = { action, sequence: String(sequence), bodyHash, createdSlot: record.createdSlot, caller: (input.caller ?? "agent").slice(0, 120) };
  const claim = await deps.store.claimUse({ spenderId: record.id, purpose: "call", payee, messageSha256: sha256Hex(message), at: new Date(nowMs).toISOString(), detail }, limits);
  if (claim === "overuse") {
    await freezeSpender(record, `signed more than ${limits.perBudget} calls in ten minutes`, deps);
    return refuse("key_overuse", "This Budget made too many calls and is frozen. The operator was alerted.");
  }
  if (claim === "payer_overuse") {
    await operator(`Refused: payer ${record.payer} asked for more than ${limits.perPayer} calls in ten minutes`, { code: "payer_overuse", limit: limits.perPayer });
    return refuse("payer_overuse", "This payer's Budgets made too many calls in the last ten minutes; try again later.");
  }
  if (claim === "global_overuse" || claim === "global_overuse_new") {
    if (claim === "global_overuse_new") {
      await sendBudgetAlert(
        {
          audience: "operator",
          kind: "key_overuse",
          subject: "The relay hit its call ceiling across all Budgets",
          text: `All relay Budgets on ${record.network} together asked for ${limits.global} paid calls in ten minutes (BUDGET_CALLS_MAX_GLOBAL_PER_10_MIN). Further calls are refused until the count drops. Check the call log for who asked. If the relay may be compromised, run the incident step.`,
          detail: { limit: limits.global, network: record.network },
        },
        undefined,
        deps,
      );
    }
    return refuse("global_overuse", "The relay is at its call ceiling; try again in a few minutes.");
  }
  if (claim === "paused") return refuse("budgets_paused", "Budget spending is paused by the operator.");
  if (claim === "not_open" || claim === "closed") return refuse("budget_not_open", "This Budget is no longer open.");
  if (claim === "unknown") return refuse("unknown_budget_key", "No usable Budget record with that id.");
  if (claim !== "ok") return refuse("store_unavailable", "The call could not be logged, so nothing was signed.");
  const publicKey = Uint8Array.from(Buffer.from(record.spenderKey, "hex"));
  const signed = await signApproval(signer, publicKey, message);
  if (!signed.ok) {
    await operator(`KMS call signature failed for a Budget: ${signed.code}`, { code: signed.code });
    return refuse(signed.code, signed.message);
  }
  return { ok: true, budget: record.budget, createdSlot, sequence, publicKey, signature: signed.signature };
}

/**
 * Takes the next call number for this Budget record and provider: written
 * with a version check before anything is signed, so two calls never get the
 * same number and no number is handed out twice.
 */
async function takeCallNumber(id: string, payee: string, store: BudgetCustodyStore): Promise<number | "exhausted" | undefined> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let current: SpenderRecord | undefined;
    try {
      current = await store.byId(id);
    } catch {
      return undefined;
    }
    if (!current) return undefined;
    const next = (current.calls?.[payee] ?? 0) + 1;
    if (next > MAX_CALL_SEQUENCE) return "exhausted";
    const written = await store.update({ ...current, calls: { ...(current.calls ?? {}), [payee]: next }, version: current.version + 1 });
    if (written.ok) return next;
    if (written.code === "store_unavailable") return undefined;
  }
  return undefined;
}
