/**
 * The buyer's "Rate this job" choice in a pay flow (#842): whether the option
 * is offered at all, what is known about the provider's stance on rated jobs,
 * and the optional judge address. Pure, apart from the small browser store
 * that remembers providers that declined a rated job.
 */
import { PublicKey } from "@solana/web3.js";
import type { KeyValueStorage } from "@/lib/rating/rating-secrets";

/**
 * Rating needs an escrow program that has the rating instructions. The devnet
 * deployment predates them, so the option is offered only when the operator
 * says the configured program has them: NEXT_PUBLIC_RATED_ESCROWS=on at build.
 */
export function ratedEscrowsEnabled(value: string | undefined): boolean {
  return ["on", "true", "1"].includes((value ?? "").trim().toLowerCase());
}

/** What is known about whether a provider serves jobs opted in to rating. */
export type RatedJobStance = "accepts" | "declines" | "unknown";

const DECLINED_KEY = "reddi.rated-job-declines.v1";
const MAX_REMEMBERED = 200;

function readDeclines(storage: KeyValueStorage | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(DECLINED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers, in this browser, that a provider refused a rated job. */
export function rememberRatedDecline(storage: KeyValueStorage | undefined, providerWallet: string): void {
  if (!storage) return;
  const next = [providerWallet, ...readDeclines(storage).filter((wallet) => wallet !== providerWallet)].slice(0, MAX_REMEMBERED);
  try {
    storage.setItem(DECLINED_KEY, JSON.stringify(next));
  } catch {
    // A convenience only: the provider's refusal is still shown when it happens.
  }
}

export function forgetRatedDecline(storage: KeyValueStorage | undefined, providerWallet: string): void {
  if (!storage) return;
  try {
    storage.setItem(DECLINED_KEY, JSON.stringify(readDeclines(storage).filter((wallet) => wallet !== providerWallet)));
  } catch {
    // Nothing to do.
  }
}

/**
 * The provider's stance, from what it states (`acceptsRatedEscrows` in its
 * offer or listing) and from a refusal this browser has seen. A stated value
 * wins over a remembered refusal, because a provider can change its settings.
 */
export function ratedJobStance(input: { stated?: unknown; providerWallet: string; storage?: KeyValueStorage }): RatedJobStance {
  if (input.stated === true) return "accepts";
  if (input.stated === false) return "declines";
  return readDeclines(input.storage).includes(input.providerWallet) ? "declines" : "unknown";
}

/** True when a provider's reply says it refused the job because the escrow is rated. */
export function isRatedDecline(text: string | undefined | null): boolean {
  return typeof text === "string" && /rated_escrow_declined|rated escrow declined|opted in to rating/i.test(text);
}

export type JudgeChoice = { ok: true; judge?: PublicKey } | { ok: false; message: string };

/** Checks the optional judge address a buyer typed. Empty means no judge. */
export function parseJudgeAddress(text: string, parties: { payer: string; payee: string }): JudgeChoice {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true };
  let judge: PublicKey;
  try {
    judge = new PublicKey(trimmed);
  } catch {
    return { ok: false, message: "The judge address is not a valid wallet address." };
  }
  if (judge.toBase58() === parties.payer) return { ok: false, message: "The judge cannot be your own wallet." };
  if (judge.toBase58() === parties.payee) return { ok: false, message: "The judge cannot be the provider." };
  return { ok: true, judge };
}
