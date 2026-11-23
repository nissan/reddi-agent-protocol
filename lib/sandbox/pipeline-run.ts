/**
 * The sandbox "Make a video" scenario: a director agent hires five independent
 * studios in turn (animation, music, guide voice, voice pass, final stitch).
 * Each step is its own paid call through the sandbox gateway: an unpaid request
 * gets a 402 challenge with the most the call can cost, a simulated payment
 * meets it, and the studio answers with a signed receipt that the director
 * checks against what it sent and got back before it moves on. Isomorphic, so
 * the tests drive it against the gateway with the same code the browser runs.
 *
 * Every studio is `simulatedOnly`: nothing moves on devnet.
 */

import { findSandboxProviderById, STUDIO_PIPELINE, studioStepPrompt, type SandboxProvider, type SandboxSpotCheck } from "./catalog";
import { callSandbox, challengeFrom, errorMessageOf, simulatedPaymentHeader, type SandboxExchange } from "./client";
import { countTokens, maxChargeLamports, requestInputTokens, sandboxFeeBps, settleSandboxCall, usageCostMicroUsd, type TokenUsage } from "./pricing";
import { isSandboxReceipt, verifySandboxReceipt, type SandboxReceipt } from "./receipt";

/**
 * Our estimate of the tokens each step of a real 30-second video uses, so the
 * page can show what the job would cost at these listings. The sandbox
 * answers are a few dozen tokens; these are not measurements.
 */
export const TYPICAL_STUDIO_USAGE: Record<string, TokenUsage> = {
  "frame-foundry": { inputTokens: 3_000, outputTokens: 40_000 },
  "tidepool-audio": { inputTokens: 1_500, outputTokens: 20_000 },
  "kettle-voice": { inputTokens: 2_000, outputTokens: 15_000 },
  "booth-match": { inputTokens: 2_000, outputTokens: 10_000 },
  "splice-line": { inputTokens: 4_000, outputTokens: 2_000 },
};

export type PipelineStepRow = {
  step: number;
  provider: SandboxProvider;
  ask: string;
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
  spotCheck?: SandboxSpotCheck;
  /** Every check of the receipt against what the director sent and got back passed. */
  checked: boolean;
  problem?: string;
};

export type PipelineRunResult =
  | { ok: true; rows: PipelineStepRow[]; totalLamports: bigint; feeLamports: bigint; receipts: SandboxReceipt[]; exchanges: SandboxExchange[] }
  | { ok: false; message: string; rows: PipelineStepRow[]; exchanges: SandboxExchange[] };

/** The studios in pipeline order. */
export function studioProviders(): SandboxProvider[] {
  return STUDIO_PIPELINE.map((step) => {
    const provider = findSandboxProviderById(step.providerId);
    if (!provider) throw new Error(`Unknown studio ${step.providerId}`);
    return provider;
  });
}

/** What a typical real video would cost at these listings, in micro-dollars. */
export function typicalVideoCostMicroUsd(): bigint {
  return studioProviders().reduce((total, provider) => total + usageCostMicroUsd(provider, TYPICAL_STUDIO_USAGE[provider.id] ?? { inputTokens: 0, outputTokens: 0 }), BigInt(0));
}

export async function runSandboxPipeline(input: {
  fetchImpl?: typeof fetch;
  /** Receipt provider addresses from the models listing, by provider id. */
  providerReceiptIds?: Record<string, string>;
  onStep?: (row: PipelineStepRow) => void;
}): Promise<PipelineRunResult> {
  const rows: PipelineStepRow[] = [];
  const exchanges: SandboxExchange[] = [];
  const receipts: SandboxReceipt[] = [];
  const fail = (message: string): PipelineRunResult => ({ ok: false, message, rows, exchanges });
  let total = BigInt(0);
  let fees = BigInt(0);

  for (const [index, step] of STUDIO_PIPELINE.entries()) {
    const provider = findSandboxProviderById(step.providerId);
    if (!provider) return fail(`Step ${index + 1} names a studio that is not listed.`);
    const messages = [{ role: "user", content: studioStepPrompt(step.ask) }];

    const asked = await callSandbox({ label: `${provider.studio?.role ?? provider.name}: ask ${provider.name} for terms`, model: provider.model, messages, fetchImpl: input.fetchImpl });
    exchanges.push(asked.exchange);
    const challenge = challengeFrom(asked.body);
    if (asked.status !== 402 || !challenge) return fail(`${provider.name} did not quote a price: ${errorMessageOf(asked.body)}`);
    const inputTokens = requestInputTokens(messages);
    const maxLamports = maxChargeLamports(provider, inputTokens);
    // The director pays only the quote it expects from the listing, to the listed address.
    if (challenge.payTo !== provider.payTo) return fail(`${provider.name} asked to be paid at an address that is not on its listing. Nothing was paid.`);

    const paymentHeader = simulatedPaymentHeader(challenge);
    const paid = await callSandbox({ label: `${provider.studio?.role ?? provider.name}: pay ${provider.name} (simulated)`, model: provider.model, messages, paymentHeader, fetchImpl: input.fetchImpl });
    exchanges.push(paid.exchange);
    if (paid.status !== 200) return fail(`${provider.name} refused the payment: ${errorMessageOf(paid.body)}`);
    const answer = String((paid.body.choices as Array<{ message: { content: string } }> | undefined)?.[0]?.message?.content ?? "");
    const spotCheck = (paid.body.rap_sandbox as { spotCheck?: SandboxSpotCheck } | undefined)?.spotCheck;

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
    }
    const row: PipelineStepRow = {
      step: index + 1,
      provider,
      ask: step.ask,
      answer,
      ...usage,
      maxLamports,
      costLamports: settled.amount,
      feeLamports: settled.fee,
      refundedLamports: settled.refunded,
      ...(isSandboxReceipt(paid.receipt) ? { receipt: paid.receipt } : {}),
      ...(spotCheck ? { spotCheck } : {}),
      checked: problem === undefined,
      ...(problem ? { problem } : {}),
    };
    rows.push(row);
    input.onStep?.(row);
    // The director stops the pipeline at the first receipt it cannot check, so nothing downstream is bought on top of it.
    if (problem || !row.receipt) return fail(`${provider.name}: ${problem}`);
    receipts.push(row.receipt);
    total += settled.amount;
    fees += settled.fee;
  }
  return { ok: true, rows, totalLamports: total, feeLamports: fees, receipts, exchanges };
}

/** The fee rate the receipts use now, in percent, for display. */
export function pipelineFeePercent(): number {
  return Number(sandboxFeeBps()) / 100;
}
