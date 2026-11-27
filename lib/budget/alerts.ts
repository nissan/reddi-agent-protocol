/**
 * Server only. Alerts about pooled Budgets (audit round 4, S7-claude-03:
 * "a watcher that alerts the payer on every reserve and post").
 *
 * Two audiences:
 * - the payer, on every new or raised slice, every post and re-post, every
 *   dispute and every payout of their Budget, with how long they have to
 *   dispute and a link that builds the dispute transaction for them;
 * - the operator, on anything that looks like a compromised spender: a slice
 *   for a provider the payer did not expect, a key used too often, a sign
 *   request the relay refused, and every incident step.
 *
 * Channels: email through Resend (`RESEND_API_KEY` and `BUDGET_ALERT_FROM`),
 * and an https webhook (the payer's own, or `BUDGET_OPS_WEBHOOK` for the
 * operator; `BUDGET_OPS_EMAIL` for operator email). Every alert is logged with
 * what each channel answered, so an alert that reached nobody is visible.
 * Channels are tried at once, each with a hard timeout, so one slow receiver
 * cannot hold up other Budgets' alerts. Webhook bodies are signed (see
 * `signWebhookBody`) so a receiver can tell RAP's alerts from forged ones.
 */

import { createHmac } from "crypto";
import { fetchOutbound } from "@/lib/http/outbound";
import type { BudgetAlertRow, BudgetContact, BudgetCustodyStore, PendingOperatorAlert } from "./store";

export type BudgetAlert = {
  audience: "payer" | "operator";
  kind:
    | "slice_reserved"
    | "slice_raised"
    | "slice_posted"
    | "slice_reposted"
    | "slice_disputed"
    | "slice_paid"
    | "slice_settled"
    | "budget_settled"
    | "budget_found"
    | "do_not_open"
    | "unexpected_payee"
    | "key_overuse"
    | "sign_refused"
    | "budget_frozen"
    | "alerts_undelivered"
    | "budget_unreadable"
    | "key_rotated"
    | "watcher_stalled"
    | "judge_not_registered"
    | "payout_sweep_failed"
    | "release_failed"
    | "incident";
  /** One line a person can act on. */
  subject: string;
  /** Plain text, a few lines. */
  text: string;
  detail: Record<string, unknown>;
  spenderId?: string;
  /**
   * An operator alert no channel took is kept and sent again by the watcher
   * (audit round 5b). False for an alert the caller repeats itself until it is
   * delivered, so it is not sent twice.
   */
  retry?: boolean;
};

export type AlertChannelResult = "sent" | "not_configured" | "failed";

export interface AlertSender {
  email(to: string, subject: string, text: string): Promise<AlertChannelResult>;
  /** `secret`, when given, signs the body (`x-rap-signature`). */
  webhook(url: string, body: Record<string, unknown>, secret?: string): Promise<AlertChannelResult>;
}

/** How long one channel may take before it counts as failed. */
export const ALERT_CHANNEL_TIMEOUT_MS = 5_000;

/**
 * The `x-rap-signature` header for a webhook body: `t=<unix seconds>,v1=<hex
 * HMAC-SHA256(secret, "<t>.<body>")>`. A receiver recomputes it with its
 * secret and refuses a stale `t`.
 */
export function signWebhookBody(body: string, secret: string, nowMs: number = Date.now()): string {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** Why alerts could not reach this contact with the server's configuration, if they could not. */
export function alertConfigProblem(contact: BudgetContact, env: Record<string, string | undefined>): string | undefined {
  const emailReady = Boolean(env.RESEND_API_KEY?.trim() && env.BUDGET_ALERT_FROM?.trim());
  if (!env.BUDGET_OPS_EMAIL?.trim() && !env.BUDGET_OPS_WEBHOOK?.trim()) return "Budget keys are not made while no operator alert channel (BUDGET_OPS_EMAIL or BUDGET_OPS_WEBHOOK) is set.";
  if (env.BUDGET_OPS_WEBHOOK?.trim() && !env.BUDGET_OPS_WEBHOOK_SECRET?.trim()) return "Operator webhook alerts must be signed: set BUDGET_OPS_WEBHOOK_SECRET with BUDGET_OPS_WEBHOOK.";
  if (!contact.webhook && contact.email && !emailReady) return "Alert email is not set up on this server (RESEND_API_KEY and BUDGET_ALERT_FROM): give a webhook for Budget alerts.";
  if (env.BUDGET_OPS_EMAIL?.trim() && !env.BUDGET_OPS_WEBHOOK?.trim() && !emailReady) return "Operator alerts go by email, but alert email is not set up (RESEND_API_KEY and BUDGET_ALERT_FROM).";
  return undefined;
}

function withTimeout(work: Promise<AlertChannelResult>, ms: number): Promise<AlertChannelResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AlertChannelResult>((resolve) => {
    timer = setTimeout(() => resolve("failed"), ms);
  });
  return Promise.race([work.catch(() => "failed" as const), timeout]).finally(() => clearTimeout(timer));
}

/** Control, format (bidi and zero-width included), line and paragraph separator, and private-use characters. */
export const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/u;

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,253}\.[A-Za-z]{2,}$/;

/** Is this a contact the relay can use: an email address and/or an https webhook. */
export function contactProblem(contact: BudgetContact): string | undefined {
  if (!contact || (!contact.email && !contact.webhook)) return "Give an email address or a webhook for Budget alerts: the payer must hear about every reserve and post.";
  // Both are shown in the text the payer's wallet signs: a line break or other control or format character could
  // fake a line of it (audit round 5b). `new URL` would silently drop tabs and newlines, so check the raw value.
  for (const value of [contact.email, contact.webhook]) {
    if (value !== undefined && (typeof value !== "string" || UNPRINTABLE.test(value) || value.length > 512)) return "The alert contact has characters that are not allowed.";
  }
  if (contact.email !== undefined && !EMAIL.test(contact.email)) return "The alert email address is not valid.";
  if (contact.webhook !== undefined) {
    try {
      if (new URL(contact.webhook).protocol !== "https:") return "The alert webhook must be an https URL.";
    } catch {
      return "The alert webhook is not a valid URL.";
    }
  }
  return undefined;
}

/** Sends through Resend and `fetchOutbound` (which refuses private and local addresses). */
export function defaultAlertSender(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): AlertSender {
  return {
    async email(to, subject, text) {
      const key = env.RESEND_API_KEY?.trim();
      const from = env.BUDGET_ALERT_FROM?.trim();
      if (!key || !from) return "not_configured";
      try {
        const response = await (fetchImpl ?? fetch)("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(ALERT_CHANNEL_TIMEOUT_MS),
        });
        return response.ok ? "sent" : "failed";
      } catch {
        return "failed";
      }
    },
    async webhook(url, body, secret) {
      try {
        const text = JSON.stringify(body);
        const headers: Record<string, string> = { "content-type": "application/json", ...(secret ? { "x-rap-signature": signWebhookBody(text, secret) } : {}) };
        const response = await fetchOutbound(url, { method: "POST", headers, body: text, signal: AbortSignal.timeout(ALERT_CHANNEL_TIMEOUT_MS) }, fetchImpl ? { fetchImpl } : {});
        return response.ok ? "sent" : "failed";
      } catch {
        return "failed";
      }
    },
  };
}

export type AlertDeps = { store: BudgetCustodyStore; sender: AlertSender; env?: Record<string, string | undefined>; nowMs?: number; alertTimeoutMs?: number };

/**
 * Sends one alert on every channel its audience has and logs it. Returns
 * whether at least one channel took it. An operator alert with no operator
 * channel configured is still logged, and reported as not delivered. An
 * operator alert no channel took is kept for the watcher to send again,
 * unless `alert.retry` is false.
 */
export async function sendBudgetAlert(alert: BudgetAlert, contact: BudgetContact | undefined, deps: AlertDeps): Promise<boolean> {
  const env = deps.env ?? process.env;
  const ms = deps.alertTimeoutMs ?? ALERT_CHANNEL_TIMEOUT_MS + 1_000;
  const delivered: Record<string, AlertChannelResult> = {};
  const body = { type: `rap.budget.${alert.kind}`, subject: alert.subject, text: alert.text, ...alert.detail };
  const channels: [string, () => Promise<AlertChannelResult>][] = [];
  if (alert.audience === "payer") {
    if (contact?.email) channels.push(["email", () => deps.sender.email(contact.email!, alert.subject, alert.text)]);
    if (contact?.webhook) channels.push(["webhook", () => deps.sender.webhook(contact.webhook!, body, contact.webhookSecret)]);
  } else {
    const opsEmail = env.BUDGET_OPS_EMAIL?.trim();
    const opsWebhook = env.BUDGET_OPS_WEBHOOK?.trim();
    const opsSecret = env.BUDGET_OPS_WEBHOOK_SECRET?.trim() || undefined;
    if (opsEmail) channels.push(["email", () => deps.sender.email(opsEmail, `[RAP Budget ops] ${alert.subject}`, alert.text)]);
    // Never unsigned (audit round 5, S6-claude-04): without its secret the operator webhook counts as not set up.
    if (opsWebhook) channels.push(["webhook", () => (opsSecret ? deps.sender.webhook(opsWebhook, body, opsSecret) : Promise.resolve("not_configured" as const))]);
  }
  if (channels.length === 0) delivered.none = "not_configured";
  const answers = await Promise.all(channels.map(([, send]) => withTimeout(Promise.resolve().then(send), ms)));
  channels.forEach(([name], i) => {
    delivered[name] = answers[i];
  });
  const row: BudgetAlertRow = {
    ...(alert.spenderId ? { spenderId: alert.spenderId } : {}),
    audience: alert.audience,
    kind: alert.kind,
    detail: { subject: alert.subject, ...alert.detail },
    delivered,
    at: new Date(deps.nowMs ?? Date.now()).toISOString(),
  };
  await deps.store.logAlert(row).catch(() => false);
  const sent = Object.values(delivered).includes("sent");
  if (!sent && alert.audience === "operator" && alert.retry !== false) {
    const kept: PendingOperatorAlert = { kind: alert.kind, subject: alert.subject, text: alert.text, detail: alert.detail, ...(alert.spenderId ? { spenderId: alert.spenderId } : {}), firstAt: row.at, tries: 1 };
    await deps.store.queueOperatorAlert(kept).catch(() => false);
  }
  return sent;
}

/**
 * Sends every kept operator alert again (the watcher does this each pass).
 * Returns how many are still undelivered; those are kept again.
 */
export async function resendOperatorAlerts(deps: AlertDeps): Promise<number> {
  const kept = await deps.store.takeOperatorAlerts();
  let left = 0;
  for (const alert of kept) {
    const ok = await sendBudgetAlert({ audience: "operator", kind: alert.kind as BudgetAlert["kind"], subject: alert.subject, text: alert.text, detail: { ...alert.detail, firstAt: alert.firstAt, tries: alert.tries + 1 }, ...(alert.spenderId ? { spenderId: alert.spenderId } : {}), retry: false }, undefined, deps);
    if (!ok) {
      left += 1;
      await deps.store.queueOperatorAlert({ ...alert, tries: alert.tries + 1 }).catch(() => false);
    }
  }
  return left;
}
