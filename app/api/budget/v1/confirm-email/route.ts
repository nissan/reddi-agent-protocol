import { PublicKey } from "@solana/web3.js";
import { contactProblem, defaultAlertSender } from "@/lib/budget/alerts";
import { createEmailCooldown, emailConfirmLink, emailConfirmRequired, emailConfirmText, emailProof } from "@/lib/budget/email-confirm";
import { BUDGET_NETWORK } from "@/lib/budget/page";
import { budgetLinkOrigin } from "@/lib/budget/watch";
import { rateLimited, readJsonBody, tryError, tryJson } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cooldown = createEmailCooldown();

/**
 * Emails the payer a link that proves they read their alert address. The
 * proof goes only to the inbox, never into this answer.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "start");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body) return tryError(400, "invalid_request", "Send JSON with payer and email.");
  if (!emailConfirmRequired(BUDGET_NETWORK)) return tryError(409, "not_required", "This server does not ask for a confirmed alert email.");
  let payer: string;
  try {
    if (typeof body.payer !== "string" || body.payer.length > 44) throw new Error("payer");
    payer = new PublicKey(body.payer).toBase58();
  } catch {
    return tryError(400, "invalid_payer", "Connect a wallet first.");
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const problem = contactProblem({ email });
  if (problem) return tryError(400, "contact_required", problem);
  const proof = emailProof({ network: BUDGET_NETWORK, payer, email });
  if (!proof) {
    console.error(JSON.stringify({ source: "budget-page", event: "email_confirm_not_configured" }));
    return tryError(503, "email_confirm_not_configured", "Alert confirmation is not set up on this server yet. Try again later.");
  }
  if (!cooldown.take(email)) return tryError(429, "rate_limited", "We sent a link to that address a moment ago. Check your inbox, or try again in a minute.", { "retry-after": "60" });
  const { subject, text } = emailConfirmText(emailConfirmLink(budgetLinkOrigin(), payer, email, proof), payer);
  const sent = await defaultAlertSender().email(email, subject, text);
  if (sent !== "sent") {
    console.error(JSON.stringify({ source: "budget-page", event: "email_confirm_send_failed", result: sent }));
    return tryError(503, "email_not_sent", "The confirmation email could not be sent. Try again in a moment.");
  }
  return tryJson({ sent: true });
}
