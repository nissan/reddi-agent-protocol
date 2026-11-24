/**
 * Server only. Alerts about pooled Budgets (audit round 4, S7-claude-03:
 * "a watcher that alerts the payer on every reserve and post").
 *
 * Two audiences:
 * - the payer, on every new or raised slice, every post and re-post, every
 *   dispute and every payout of their Budget, with how long they have to
 *   dispute and a link that builds the dispute transaction for them;
 * - the operator, on anything that looks like a stolen spender key: a slice
 *   for a provider the payer did not expect, a key used too often, a sign
 *   request the relay refused, and every incident step.
 *
 * Channels: email through Resend (`RESEND_API_KEY` and `BUDGET_ALERT_FROM`),
 * and an https webhook (the payer's own, or `BUDGET_OPS_WEBHOOK` for the
 * operator; `BUDGET_OPS_EMAIL` for operator email). Every alert is logged with
 * what each channel answered, so an alert that reached nobody is visible.
 */

import { fetchOutbound } from "@/lib/http/outbound";
import type { BudgetAlertRow, BudgetContact, BudgetCustodyStore } from "./store";

export type BudgetAlert = {
  audience: "payer" | "operator";
  kind:
    | "slice_reserved"
    | "slice_raised"
    | "slice_posted"
    | "slice_reposted"
    | "slice_disputed"
    | "slice_paid"
    | "unexpected_payee"
    | "key_overuse"
    | "sign_refused"
    | "budget_frozen"
    | "incident";
  /** One line a person can act on. */
  subject: string;
  /** Plain text, a few lines. */
  text: string;
  detail: Record<string, unknown>;
  spenderId?: string;
};

export type AlertChannelResult = "sent" | "not_configured" | "failed";

export interface AlertSender {
  email(to: string, subject: string, text: string): Promise<AlertChannelResult>;
  webhook(url: string, body: Record<string, unknown>): Promise<AlertChannelResult>;
}

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,253}\.[A-Za-z]{2,}$/;

/** Is this a contact the relay can use: an email address and/or an https webhook. */
export function contactProblem(contact: BudgetContact): string | undefined {
  if (!contact.email && !contact.webhook) return "Give an email address or a webhook for Budget alerts: the payer must hear about every reserve and post.";
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
        });
        return response.ok ? "sent" : "failed";
      } catch {
        return "failed";
      }
    },
    async webhook(url, body) {
      try {
        const response = await fetchOutbound(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, fetchImpl ? { fetchImpl } : {});
        return response.ok ? "sent" : "failed";
      } catch {
        return "failed";
      }
    },
  };
}

export type AlertDeps = { store: BudgetCustodyStore; sender: AlertSender; env?: Record<string, string | undefined>; nowMs?: number };

/**
 * Sends one alert on every channel its audience has and logs it. Returns
 * whether at least one channel took it. An operator alert with no operator
 * channel configured is still logged, and reported as not delivered.
 */
export async function sendBudgetAlert(alert: BudgetAlert, contact: BudgetContact | undefined, deps: AlertDeps): Promise<boolean> {
  const env = deps.env ?? process.env;
  const delivered: Record<string, AlertChannelResult> = {};
  const body = { type: `rap.budget.${alert.kind}`, subject: alert.subject, text: alert.text, ...alert.detail };
  if (alert.audience === "payer") {
    if (contact?.email) delivered.email = await deps.sender.email(contact.email, alert.subject, alert.text);
    if (contact?.webhook) delivered.webhook = await deps.sender.webhook(contact.webhook, body);
  } else {
    const opsEmail = env.BUDGET_OPS_EMAIL?.trim();
    const opsWebhook = env.BUDGET_OPS_WEBHOOK?.trim();
    if (opsEmail) delivered.email = await deps.sender.email(opsEmail, `[RAP Budget ops] ${alert.subject}`, alert.text);
    if (opsWebhook) delivered.webhook = await deps.sender.webhook(opsWebhook, body);
    if (!opsEmail && !opsWebhook) delivered.none = "not_configured";
  }
  const row: BudgetAlertRow = {
    ...(alert.spenderId ? { spenderId: alert.spenderId } : {}),
    audience: alert.audience,
    kind: alert.kind,
    detail: { subject: alert.subject, ...alert.detail },
    delivered,
    at: new Date(deps.nowMs ?? Date.now()).toISOString(),
  };
  await deps.store.logAlert(row);
  return Object.values(delivered).includes("sent");
}
