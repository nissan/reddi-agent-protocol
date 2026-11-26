/**
 * The payer's alert address, confirmed by a link before a Budget can open
 * (#1208, RAP-MB6-S4). Alerts are the payer's only notice of a reserve or a
 * post inside the dispute window, so on mainnet an address nobody proved they
 * read is refused.
 *
 * Nothing is stored. The link carries a proof: an HMAC, under
 * `BUDGET_EMAIL_CONFIRM_SECRET`, of the network, the payer's wallet, the
 * address (lower-cased) and an expiry. Only the inbox gets it, the page keeps
 * it in the browser, and prepare and start check it. A proof is good for one
 * wallet and one address for 30 days.
 *
 * Required on mainnet always; elsewhere when
 * `BUDGET_REQUIRE_CONFIRMED_EMAIL=true`. Required without the secret is a
 * refusal, never a pass.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { BudgetNetwork } from "./store";

export const EMAIL_PROOF_TTL_SECONDS = 30 * 24 * 60 * 60;
/** One confirmation email per address per minute from one server instance. */
export const EMAIL_CONFIRM_COOLDOWN_MS = 60_000;
const MIN_SECRET_LENGTH = 32;
const PROOF = /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

type Env = Record<string, string | undefined>;

export function emailConfirmRequired(network: BudgetNetwork, env: Env = process.env): boolean {
  return network === "solana-mainnet-beta" || env.BUDGET_REQUIRE_CONFIRMED_EMAIL?.trim() === "true";
}

function secretOf(env: Env): string | undefined {
  const secret = env.BUDGET_EMAIL_CONFIRM_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : undefined;
}

export function emailConfirmConfigured(env: Env = process.env): boolean {
  return secretOf(env) !== undefined;
}

function mac(secret: string, network: BudgetNetwork, payer: string, email: string, expiry: number): Buffer {
  return createHmac("sha256", secret).update(["rap-budget-email/1", network, payer, email.trim().toLowerCase(), String(expiry)].join("\n")).digest();
}

/** The proof the confirmation link carries. Undefined when the secret is not set. */
export function emailProof(input: { network: BudgetNetwork; payer: string; email: string; nowMs?: number; env?: Env }): string | undefined {
  const secret = secretOf(input.env ?? process.env);
  if (!secret) return undefined;
  const expiry = Math.floor((input.nowMs ?? Date.now()) / 1000) + EMAIL_PROOF_TTL_SECONDS;
  return `v1.${expiry}.${mac(secret, input.network, input.payer, input.email, expiry).toString("base64url")}`;
}

export type EmailProofProblem = "not_configured" | "unconfirmed";

/** Why this Budget may not open with this alert address, or undefined when it may. */
export function emailProofProblem(input: { network: BudgetNetwork; payer: string; email: string; proof: unknown; nowMs?: number; env?: Env }): EmailProofProblem | undefined {
  const env = input.env ?? process.env;
  if (!emailConfirmRequired(input.network, env)) return undefined;
  const secret = secretOf(env);
  if (!secret) return "not_configured";
  const match = typeof input.proof === "string" ? PROOF.exec(input.proof) : null;
  if (!match) return "unconfirmed";
  const expiry = Number(match[1]);
  if (expiry <= Math.floor((input.nowMs ?? Date.now()) / 1000)) return "unconfirmed";
  const given = Buffer.from(match[2], "base64url");
  // One spelling per proof: the last character's spare bits must be zero.
  if (given.toString("base64url") !== match[2]) return "unconfirmed";
  const want = mac(secret, input.network, input.payer, input.email, expiry);
  return given.length === want.length && timingSafeEqual(given, want) ? undefined : "unconfirmed";
}

/**
 * The link the payer opens. The proof rides in the fragment, which browsers
 * do not send to servers, so it stays out of request logs and analytics.
 */
export function emailConfirmLink(origin: string, payer: string, email: string, proof: string): string {
  return `${origin}/budget#confirm=${encodeURIComponent(proof)}&payer=${encodeURIComponent(payer)}&email=${encodeURIComponent(email)}`;
}

export function emailConfirmText(link: string, payer: string): { subject: string; text: string } {
  return {
    subject: "Confirm your Budget alert address",
    text: [
      "Someone asked Reddi Agent Protocol to send Budget alerts to this address.",
      `Wallet: ${payer}`,
      "",
      "If that was you, open this link in the same browser to confirm it. It is good for 30 days:",
      link,
      "",
      "Every time a provider takes a share of your Budget or posts what it is owed, we email you here with a link to dispute it. That is why we check the address first.",
      "",
      "If this was not you, ignore this email. Nothing opens without the link.",
    ].join("\n"),
  };
}

/** In-memory cooldown per address: best effort on serverless, next to the per-client rate limit. */
export function createEmailCooldown(windowMs: number = EMAIL_CONFIRM_COOLDOWN_MS) {
  const last = new Map<string, number>();
  return {
    take(email: string, nowMs: number = Date.now()): boolean {
      const key = email.trim().toLowerCase();
      const at = last.get(key);
      if (at !== undefined && nowMs - at < windowMs) return false;
      if (last.size > 5000) last.clear();
      last.set(key, nowMs);
      return true;
    },
  };
}
