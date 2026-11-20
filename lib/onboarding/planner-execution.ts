import "server-only";

import { createHash, randomUUID } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SwapClient } from "@reddi/x402-solana";
import { routePlannerPolicy, type PlannerPolicyInput } from "@/lib/onboarding/planner-router";
import { processX402Challenge } from "@/lib/onboarding/x402-settlement";
import { receiptHeaderForProvider } from "@/lib/payments/wallet-direct-payment";
import { emitTorqueEvent } from "@/lib/torque/client";
import { TORQUE_EVENTS } from "@/lib/torque/events";

export type PlannerExecuteInput = {
  prompt: string;
  policy?: PlannerPolicyInput;
  swapClient?: SwapClient;
  slippageBps?: number;
  /** Consumer wallet address — used for Torque event attribution */
  consumerWallet?: string;
  /** Preferred specialist wallet selected by the consumer UI or MCP caller. */
  preferredWallet?: string;
  /**
   * "wallet": the buyer's own wallet pays. On a 402 the challenge is handed back
   * for the browser to check and sign, and nothing is paid or simulated here.
   */
  paymentMode?: "wallet";
  /** Wallet mode only: the receipt for a transaction the buyer's wallet signed and sent. */
  paymentReceipt?: unknown;
};

/** Handed to the browser so the buyer's wallet can pay. Never contains a signature. */
export type PlannerPaymentRequired = {
  runId: string;
  /** Raw `x402-request` header from the provider, to be checked against the selected listing. */
  challenge: string;
  /** The provider the server routed to. The browser refuses if it is not the one the buyer selected. */
  selectedWallet: string;
  perCallUsd?: number;
};

export type PlannerRunRecord = {
  runId: string;
  createdAt: string;
  selectedWallet?: string;
  endpointUrl?: string;
  policy: PlannerPolicyInput;
  promptSha256: string;
  status: "completed" | "failed" | "payment_required";
  /** "wallet" when the buyer's wallet paid or was asked to; absent for the simulated path. */
  paymentMode?: "wallet";
  challengeSeen: boolean;
  paymentAttempted: boolean;
  paymentSatisfied: boolean;
  x402TxSignature?: string;
  x402ReceiptNonce?: string;
  reputationCommitTx?: string;
  responseStatus?: number;
  responsePreview?: string;
  error?: string;
  trace: string[];
};

const RUNS_PATH = join(process.cwd(), "data", "onboarding", "planner-runs.json");

function readRuns(): PlannerRunRecord[] {
  try {
    return JSON.parse(readFileSync(RUNS_PATH, "utf8")) as PlannerRunRecord[];
  } catch {
    return [];
  }
}

function writeRuns(records: PlannerRunRecord[]) {
  mkdirSync(join(process.cwd(), "data", "onboarding"), { recursive: true });
  writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2));
}

function appendRun(run: PlannerRunRecord) {
  const records = readRuns();
  records.push(run);
  writeRuns(records);
}

function endpointPath(endpointUrl: string, path: string) {
  return `${endpointUrl.replace(/\/$/, "")}${path}`;
}

function previewText(body: unknown) {
  if (typeof body === "string") return body.slice(0, 300);
  try {
    return JSON.stringify(body).slice(0, 300);
  } catch {
    return "";
  }
}

export async function executePlannerSpecialistCall(input: PlannerExecuteInput) {
  if (!input.prompt || input.prompt.trim().length < 3) {
    throw new Error("Prompt is required.");
  }

  const policy: PlannerPolicyInput = {
    requiresHealthPass: true,
    ...input.policy,
    preferredWallet: input.preferredWallet ?? input.policy?.preferredWallet,
  };

  const runId = `run_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const promptSha256 = createHash("sha256").update(input.prompt).digest("hex");
  const trace: string[] = [];

  const routed = routePlannerPolicy(policy);
  if (!routed.selected || !routed.selected.endpointUrl) {
    const failed: PlannerRunRecord = {
      runId,
      createdAt,
      policy,
      promptSha256,
      status: "failed",
      challengeSeen: false,
      paymentAttempted: false,
      paymentSatisfied: false,
      error: "No eligible specialist candidate found.",
      trace: ["planner: no eligible candidate"],
    };
    appendRun(failed);
    return {
      ok: false,
      result: failed,
      candidates: routed.candidates,
      rejected: routed.rejected,
    };
  }

  const endpointUrl = routed.selected.endpointUrl;
  const payload = {
    model: "ollama-local",
    messages: [{ role: "user", content: input.prompt }],
    stream: false,
  };

  trace.push(`planner:selected:${routed.selected.walletAddress}`);

  if (input.paymentMode === "wallet") {
    return executeWithWalletPayment(input, {
      runId,
      createdAt,
      policy,
      promptSha256,
      trace,
      endpointUrl,
      selectedWallet: routed.selected.walletAddress,
      perCallUsd: routed.selected.perCallUsd,
      payload,
      candidates: routed.candidates,
    });
  }

  trace.push(`request:start:${endpointPath(endpointUrl, "/v1/chat/completions")}`);

  try {
    const first = await fetch(endpointPath(endpointUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });

    const firstBody = await first.text();

    if (first.status === 402) {
      trace.push("x402:challenge_received");

      // Collect response headers from the 402 challenge
      const challengeHeaders: Record<string, string> = {};
      first.headers.forEach((v, k) => { challengeHeaders[k] = v; });

      // Process the x402 challenge — parse header, build payment receipt
      const settlement = await processX402Challenge(
        challengeHeaders,
        routed.selected.walletAddress,
        {
          swapClient: input.swapClient,
          slippageBps: input.slippageBps,
        }
      );

      if (!settlement.ok) {
        const run: PlannerRunRecord = {
          runId, createdAt,
          selectedWallet: routed.selected.walletAddress,
          endpointUrl, policy, promptSha256,
          status: "failed",
          challengeSeen: true,
          paymentAttempted: false,
          paymentSatisfied: false,
          error: settlement.error,
          trace: [...trace, ...settlement.trace, "planner:failed"],
        };
        appendRun(run);
        return { ok: false, result: run, candidates: routed.candidates };
      }

      trace.push(...settlement.trace);

      // Retry with the real x402-payment receipt header
      const second = await fetch(endpointPath(endpointUrl, "/v1/chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x402-payment": settlement.receiptHeader,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });

      const secondText = await second.text();
      const run: PlannerRunRecord = {
        runId,
        createdAt,
        selectedWallet: routed.selected.walletAddress,
        endpointUrl,
        policy,
        promptSha256,
        status: second.ok ? "completed" : "failed",
        challengeSeen: true,
        paymentAttempted: true,
        paymentSatisfied: second.ok,
        x402TxSignature: settlement.receipt.txSignature,
        x402ReceiptNonce: settlement.receipt.nonce,
        responseStatus: second.status,
        responsePreview: previewText(secondText),
        error: second.ok ? undefined : `Specialist call failed after x402 payment (${second.status}).`,
        trace: [
          ...trace,
          `retry:status:${second.status}`,
          second.ok ? "planner:completed" : "planner:failed",
        ],
      };
      appendRun(run);

      if (second.ok) {
        void emitTorqueEvent({
          userPubkey: input.consumerWallet ?? "unknown",
          eventName: TORQUE_EVENTS.CONSUMER_QUERY_RUN,
          fields: {
            taskType: "planner_query",
            specialistWallet: routed.selected.walletAddress,
            success: true,
          },
        });
      }

      return {
        ok: second.ok,
        result: run,
        response: secondText,
        candidates: routed.candidates,
      };
    }

    const run: PlannerRunRecord = {
      runId,
      createdAt,
      selectedWallet: routed.selected.walletAddress,
      endpointUrl,
      policy,
      promptSha256,
      status: "failed",
      challengeSeen: false,
      paymentAttempted: false,
      paymentSatisfied: false,
      responseStatus: first.status,
      responsePreview: previewText(firstBody),
      error: first.ok
        ? "Specialist endpoint returned a completion without an x402 challenge. Refusing unpaid response."
        : `Specialist call failed before x402 challenge (${first.status}).`,
      trace: [
        ...trace,
        `response:status:${first.status}`,
        first.ok ? "x402:missing_challenge_unpaid_response_blocked" : "x402:missing_challenge",
        "planner:failed",
      ],
    };

    appendRun(run);

    return {
      ok: false,
      result: run,
      candidates: routed.candidates,
    };
  } catch (error) {
    const run: PlannerRunRecord = {
      runId,
      createdAt,
      selectedWallet: routed.selected.walletAddress,
      endpointUrl,
      policy,
      promptSha256,
      status: "failed",
      challengeSeen: false,
      paymentAttempted: false,
      paymentSatisfied: false,
      error: error instanceof Error ? error.message : "Planner execution failed",
      trace: [...trace, "planner:exception"],
    };
    appendRun(run);
    return {
      ok: false,
      result: run,
      candidates: routed.candidates,
    };
  }
}

type WalletRunContext = {
  runId: string;
  createdAt: string;
  policy: PlannerPolicyInput;
  promptSha256: string;
  trace: string[];
  endpointUrl: string;
  selectedWallet: string;
  perCallUsd?: number;
  payload: unknown;
  candidates: unknown[];
};

/**
 * Wallet-paid call. Without a receipt it asks the provider for its terms and
 * hands them back. With a receipt it forwards that receipt once; the provider's
 * verifier decides whether it was paid. No signature is ever made up here.
 */
async function executeWithWalletPayment(input: PlannerExecuteInput, ctx: WalletRunContext) {
  const base = {
    runId: ctx.runId,
    createdAt: ctx.createdAt,
    selectedWallet: ctx.selectedWallet,
    endpointUrl: ctx.endpointUrl,
    policy: ctx.policy,
    promptSha256: ctx.promptSha256,
    paymentMode: "wallet" as const,
  };
  const url = endpointPath(ctx.endpointUrl, "/v1/chat/completions");
  const fail = (fields: Partial<PlannerRunRecord> & { error: string; trace: string[] }) => {
    const run: PlannerRunRecord = {
      ...base,
      status: "failed",
      challengeSeen: false,
      paymentAttempted: false,
      paymentSatisfied: false,
      ...fields,
    };
    appendRun(run);
    return { ok: false as const, result: run, candidates: ctx.candidates };
  };

  // In wallet mode the buyer picked one listing and will be shown its price.
  // Routing to any other provider would have them pay someone they did not choose.
  if (input.preferredWallet && input.preferredWallet !== ctx.selectedWallet) {
    return fail({
      error: "The selected specialist is not eligible for this call, so no payment was requested.",
      trace: [...ctx.trace, "planner:selected_listing_not_eligible", "planner:failed"],
    });
  }

  if (input.paymentReceipt === undefined) {
    ctx.trace.push(`request:start:${url}`);
    try {
      const first = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ctx.payload),
        signal: AbortSignal.timeout(12000),
      });
      const firstBody = await first.text();
      if (first.status !== 402) {
        return fail({
          responseStatus: first.status,
          responsePreview: previewText(firstBody),
          error: first.ok
            ? "Specialist endpoint returned a completion without an x402 challenge. Refusing unpaid response."
            : `Specialist call failed before x402 challenge (${first.status}).`,
          trace: [
            ...ctx.trace,
            `response:status:${first.status}`,
            first.ok ? "x402:missing_challenge_unpaid_response_blocked" : "x402:missing_challenge",
            "planner:failed",
          ],
        });
      }
      const challenge = first.headers.get("x402-request") ?? first.headers.get("X-402-Request");
      if (!challenge) {
        return fail({
          challengeSeen: true,
          responseStatus: 402,
          error: "Specialist returned 402 but no x402-request header found.",
          trace: [...ctx.trace, "x402:challenge_header_missing", "planner:failed"],
        });
      }
      const run: PlannerRunRecord = {
        ...base,
        status: "payment_required",
        challengeSeen: true,
        paymentAttempted: false,
        paymentSatisfied: false,
        responseStatus: 402,
        trace: [...ctx.trace, "x402:challenge_received", "x402:wallet_payment_required"],
      };
      appendRun(run);
      const paymentRequired: PlannerPaymentRequired = {
        runId: ctx.runId,
        challenge,
        selectedWallet: ctx.selectedWallet,
        perCallUsd: ctx.perCallUsd,
      };
      return { ok: false as const, result: run, paymentRequired, candidates: ctx.candidates };
    } catch (error) {
      return fail({
        error: error instanceof Error ? error.message : "Planner execution failed",
        trace: [...ctx.trace, "planner:exception"],
      });
    }
  }

  const receipt = receiptHeaderForProvider(input.paymentReceipt);
  if (!receipt.ok) {
    return fail({
      challengeSeen: true,
      error: receipt.message,
      trace: [...ctx.trace, `x402:wallet_receipt_refused:${receipt.reason}`, "planner:failed"],
    });
  }
  // The receipt names who was paid. It is only ever forwarded to that provider.
  const paidTo = (input.paymentReceipt as { payTo?: unknown }).payTo;
  if (paidTo !== ctx.selectedWallet) {
    return fail({
      challengeSeen: true,
      error: "The payment receipt is for a different provider from the one selected for this call.",
      trace: [...ctx.trace, "x402:wallet_receipt_refused:wrong_provider", "planner:failed"],
    });
  }

  ctx.trace.push(`request:paid:${url}`);
  try {
    const paid = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x402-payment": receipt.header },
      body: JSON.stringify(ctx.payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await paid.text();
    const run: PlannerRunRecord = {
      ...base,
      status: paid.ok ? "completed" : "failed",
      challengeSeen: true,
      paymentAttempted: true,
      paymentSatisfied: paid.ok,
      x402TxSignature: receipt.signature,
      x402ReceiptNonce: receipt.nonce,
      responseStatus: paid.status,
      responsePreview: previewText(text),
      error: paid.ok
        ? undefined
        : paid.status === 402
          ? "The provider did not accept the payment receipt. Your transaction may still have been sent; check it before paying again."
          : `Specialist call failed after wallet payment (${paid.status}).`,
      trace: [...ctx.trace, `retry:status:${paid.status}`, paid.ok ? "planner:completed" : "planner:failed"],
    };
    appendRun(run);
    if (paid.ok) {
      void emitTorqueEvent({
        userPubkey: input.consumerWallet ?? "unknown",
        eventName: TORQUE_EVENTS.CONSUMER_QUERY_RUN,
        fields: { taskType: "planner_query", specialistWallet: ctx.selectedWallet, success: true },
      });
    }
    return { ok: paid.ok, result: run, response: text, candidates: ctx.candidates };
  } catch (error) {
    const run: PlannerRunRecord = {
      ...base,
      status: "failed",
      challengeSeen: true,
      paymentAttempted: true,
      paymentSatisfied: false,
      x402TxSignature: receipt.signature,
      x402ReceiptNonce: receipt.nonce,
      error: `The provider could not be reached after payment: ${error instanceof Error ? error.message : "request failed"}. Present the same receipt again; do not pay twice.`,
      trace: [...ctx.trace, "planner:exception_after_payment"],
    };
    appendRun(run);
    return { ok: false as const, result: run, candidates: ctx.candidates };
  }
}

export function listPlannerRuns() {
  return {
    ok: true,
    results: readRuns(),
    storagePath: RUNS_PATH,
  };
}
