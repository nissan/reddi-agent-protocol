/**
 * The sandbox "Help us write better" scenario, run end to end: the visitor's
 * agent asks Reddi Writing Style to build a skill from their settings, then
 * asks Reddi Humaniser to try it on a sample and add its own rules. Each step
 * is its own paid call through the sandbox gateway: an unpaid request gets a
 * 402 challenge with the most the call can cost, a simulated payment meets it,
 * and the provider answers with a signed receipt the agent checks against what
 * it sent and got back before it uses the answer. Isomorphic, so the tests
 * drive it against the gateway with the same code the browser runs.
 *
 * Both providers are `simulatedOnly`: nothing moves on devnet.
 */

import { findSandboxProviderById, type SandboxProvider } from "./catalog";
import { callSandbox, challengeFrom, errorMessageOf, simulatedPaymentHeader, type SandboxExchange } from "./client";
import { countTokens, maxChargeLamports, requestInputTokens, settleSandboxCall } from "./pricing";
import { isSandboxReceipt, verifySandboxReceipt, type SandboxReceipt } from "./receipt";
import { finishedSkill, splitHumaniserAnswer, WRITING_PIPELINE, writingStepPrompt, type WritingSettings } from "./writing-skill";

export type WritingStepRow = {
  step: number;
  provider: SandboxProvider;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  /** The most the call could cost, quoted in the challenge, in lamports. */
  maxLamports: bigint;
  /** What the call cost at its actual tokens, in lamports. */
  costLamports: bigint;
  /** The protocol fee on that cost, in lamports. */
  feeLamports: bigint;
  /** Returned from the maximum, in lamports. */
  refundedLamports: bigint;
  receipt?: SandboxReceipt;
  /** Every check of the receipt against what the agent sent and got back passed. */
  checked: boolean;
  problem?: string;
};

export type WritingRunResult =
  | { ok: true; rows: WritingStepRow[]; skill: string; rewrite: string; totalLamports: bigint; feeLamports: bigint; receipts: SandboxReceipt[]; exchanges: SandboxExchange[] }
  | { ok: false; message: string; rows: WritingStepRow[]; exchanges: SandboxExchange[] };

/** The two writing providers in pipeline order. */
export function writingProviders(): SandboxProvider[] {
  return WRITING_PIPELINE.map((step) => {
    const provider = findSandboxProviderById(step.providerId);
    if (!provider) throw new Error(`Unknown writing provider ${step.providerId}`);
    return provider;
  });
}

export async function runSandboxWriting(input: {
  settings: WritingSettings;
  fetchImpl?: typeof fetch;
  /** Receipt provider addresses from the models listing, by provider id. */
  providerReceiptIds?: Record<string, string>;
  onStep?: (row: WritingStepRow) => void;
}): Promise<WritingRunResult> {
  const rows: WritingStepRow[] = [];
  const exchanges: SandboxExchange[] = [];
  const receipts: SandboxReceipt[] = [];
  const fail = (message: string): WritingRunResult => ({ ok: false, message, rows, exchanges });
  let total = BigInt(0);
  let fees = BigInt(0);
  let skill = "";

  for (const [index, step] of WRITING_PIPELINE.entries()) {
    const provider = findSandboxProviderById(step.providerId);
    if (!provider) return fail(`Step ${index + 1} names a provider that is not listed.`);
    const messages = [{ role: "user", content: writingStepPrompt(index, input.settings, skill) }];
    const role = provider.writing?.role ?? provider.name;

    const asked = await callSandbox({ label: `${role}: ask ${provider.name} for terms`, model: provider.model, messages, fetchImpl: input.fetchImpl });
    exchanges.push(asked.exchange);
    const challenge = challengeFrom(asked.body);
    if (asked.status !== 402 || !challenge) return fail(`${provider.name} did not quote a price: ${errorMessageOf(asked.body)}`);
    const inputTokens = requestInputTokens(messages);
    const maxLamports = maxChargeLamports(provider, inputTokens);
    // The agent pays only to the address on the listing.
    if (challenge.payTo !== provider.payTo) return fail(`${provider.name} asked to be paid at an address that is not on its listing. Nothing was paid.`);

    const paid = await callSandbox({ label: `${role}: pay ${provider.name} (simulated)`, model: provider.model, messages, paymentHeader: simulatedPaymentHeader(challenge), fetchImpl: input.fetchImpl });
    exchanges.push(paid.exchange);
    if (paid.status !== 200) return fail(`${provider.name} refused the payment: ${errorMessageOf(paid.body)}`);
    const answer = String((paid.body.choices as Array<{ message: { content: string } }> | undefined)?.[0]?.message?.content ?? "");

    const usage = { inputTokens, outputTokens: countTokens(answer) };
    const settled = settleSandboxCall(provider, usage, maxLamports);
    let problem: string | undefined;
    if (!isSandboxReceipt(paid.receipt)) problem = "The answer came without a receipt.";
    else {
      const verification = await verifySandboxReceipt({
        receipt: paid.receipt,
        model: provider.model,
        requestBody: paid.requestText,
        responseBody: paid.responseText,
        expectedProviderId: input.providerReceiptIds?.[provider.id],
        expectedPayment: { amount: maxLamports.toString() },
      });
      const payment = paid.receipt.receipt.payment;
      if (!verification.ok) problem = verification.checks.find((check) => !check.passed)?.detail ?? "The receipt did not verify.";
      else if (payment?.amount !== settled.amount.toString()) problem = "The receipt charges a different amount from the tokens you counted.";
      else if (payment.fee.amount !== settled.fee.toString()) problem = "The receipt states a different fee from the protocol fee on the cost.";
      else if (payment.metered?.outputTokens !== String(usage.outputTokens)) problem = "The receipt bills a different number of output tokens from the answer you received.";
    }
    const row: WritingStepRow = {
      step: index + 1,
      provider,
      answer,
      ...usage,
      maxLamports,
      costLamports: settled.amount,
      feeLamports: settled.fee,
      refundedLamports: settled.refunded,
      ...(isSandboxReceipt(paid.receipt) ? { receipt: paid.receipt } : {}),
      checked: problem === undefined,
      ...(problem ? { problem } : {}),
    };
    rows.push(row);
    input.onStep?.(row);
    // An answer whose receipt does not check is not used, and nothing is bought on top of it.
    if (problem || !row.receipt) return fail(`${provider.name}: ${problem}`);
    receipts.push(row.receipt);
    total += settled.amount;
    fees += settled.fee;
    if (index === 0) skill = answer;
  }

  const { rewrite, rules } = splitHumaniserAnswer(rows[1].answer);
  return { ok: true, rows, skill: finishedSkill(skill, rules), rewrite, totalLamports: total, feeLamports: fees, receipts, exchanges };
}
