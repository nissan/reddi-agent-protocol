/**
 * "Preview without a wallet" for the try page. The same request goes to the
 * same sandbox provider through the gateway, paid with a simulated payment, so
 * the visitor sees the price, the answer and a signed receipt with the same
 * metered arithmetic, and nothing touches a wallet or the chain. Browser-safe.
 */
import { callSandbox, challengeFrom, errorMessageOf, simulatedPaymentHeader, type SandboxCallResult, type SandboxChallenge } from "@/lib/sandbox/client";
import { maxChargeLamports, requestInputTokens } from "@/lib/sandbox/pricing";
import { verifySandboxReceipt, type SandboxVerification } from "@/lib/sandbox/receipt";
import { tryTaskProvider, type TryTask } from "./tasks";

/**
 * The Solana network fees a devnet try pays, shown as typical figures in a
 * preview: 5,000 lamports per signature, plus the lock's priority fee at the
 * try page's own compute budget (80,000 units at 1,000 micro-lamports, 80
 * lamports; see `TRY_LOCK_COMPUTE_UNITS` in `flow.ts`). The settle has no
 * compute budget, so it pays the base fee.
 */
export const PREVIEW_LOCK_NETWORK_FEE_LAMPORTS = BigInt(5_080);
export const PREVIEW_SETTLE_NETWORK_FEE_LAMPORTS = BigInt(5_000);

function messagesFor(task: TryTask) {
  return [{ role: "user" as const, content: task.prompt }];
}

/** The most this task can cost at the provider's listed per-token price, in lamports: what the visitor authorises. */
export function previewMaxLamports(task: TryTask): bigint {
  return maxChargeLamports(tryTaskProvider(task), requestInputTokens(messagesFor(task)));
}

export type TryPreviewQuote = { ok: true; challenge: SandboxChallenge; maxLamports: bigint } | { ok: false; message: string };

/** Asks the provider for its price: the gateway answers 402 with the most this call can cost. */
export async function previewQuote(task: TryTask, fetchImpl?: typeof fetch): Promise<TryPreviewQuote> {
  const provider = tryTaskProvider(task);
  const result = await callSandbox({ label: "Price", model: provider.model, messages: messagesFor(task), fetchImpl });
  const challenge = result.status === 402 ? challengeFrom(result.body) : undefined;
  return challenge ? { ok: true, challenge, maxLamports: previewMaxLamports(task) } : { ok: false, message: errorMessageOf(result.body) };
}

export type TryPreviewAnswer =
  | { ok: true; result: SandboxCallResult; verification: SandboxVerification }
  | { ok: false; message: string };

/** Sends the request again with a simulated payment for the quoted maximum, then checks the receipt. */
export async function previewAnswer(task: TryTask, challenge: SandboxChallenge, fetchImpl?: typeof fetch): Promise<TryPreviewAnswer> {
  const provider = tryTaskProvider(task);
  const result = await callSandbox({ label: "Answer", model: provider.model, messages: messagesFor(task), paymentHeader: simulatedPaymentHeader(challenge), fetchImpl });
  if (result.status !== 200) return { ok: false, message: errorMessageOf(result.body) };
  const verification = await verifySandboxReceipt({
    receipt: result.receipt,
    requestBody: result.requestText,
    responseBody: result.responseText,
    model: provider.model,
    // Checked against what the visitor saw quoted, not against anything the provider sent.
    expectedPayment: { amount: previewMaxLamports(task).toString() },
  });
  return { ok: true, result, verification };
}
