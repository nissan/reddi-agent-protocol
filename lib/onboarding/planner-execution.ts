import "server-only";

import { createHash, randomUUID } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SwapClient } from "@redditech/x402-solana";
import { routePlannerPolicy, type PlannerPolicyInput } from "@/lib/onboarding/planner-router";
import { loadListingIndex } from "@/lib/listings/listing-index";
import { processX402Challenge } from "@/lib/onboarding/x402-settlement";
import { paymentNetworkForProfile, receiptHeaderForProvider } from "@/lib/payments/wallet-direct-payment";
import { getNetworkProfile, resolveNetworkProfileName } from "@/lib/config/network";
import { readOwnListing } from "@/lib/listings/listing-store";
import { verifyAndRecordPaidCall, type PaidCallOutcome } from "@/lib/jobs/paid-call";
import { verifyAndRecordMeteredCall, type MeteredCallOutcome } from "@/lib/jobs/metered-call";
import { ESCROW_PROGRAM_ID } from "@/lib/program";
import { checkAndStoreProviderReceipt, PROVIDER_RECEIPT_HEADER } from "@/lib/jobs/provider-receipt";
import { refreshProviderStats } from "@/lib/jobs/provider-stats";
import { emitTorqueEvent } from "@/lib/torque/client";
import { plannerChatPayload } from "@/lib/onboarding/planner-payload";
import { checkSessionAnswer, paidCallAuthRequestHeaders, sessionRequestHeaders, type PlannerPaidCallAuth, type PlannerSessionOutcome, type PlannerSessionRequest } from "@/lib/onboarding/planner-session";
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
  /** The signed-in buyer, from a checked session. Never taken from the request body. */
  buyerSession?: { userId: string; wallet: string };
  /**
   * Wallet mode with a metered receipt only: send the call as call `sequence`
   * of a session on that lock (#863), signed by the buyer's session key over
   * the exact request body (`plannerChatBody`).
   */
  session?: PlannerSessionRequest;
  /**
   * Wallet mode with a metered receipt, outside a session: the payer's
   * delegation and the key's `single` signature over the exact request body
   * (#866). Providers refuse an unsigned single metered call.
   */
  paidCallAuth?: PlannerPaidCallAuth;
};

/** Handed to the browser so the buyer's wallet can pay. Never contains a signature. */
export type PlannerPaymentRequired = {
  runId: string;
  /** Raw `x402-request` header from the provider, to be checked against the selected listing. */
  challenge: string;
  /** The provider the server routed to. The browser refuses if it is not the one the buyer selected. */
  selectedWallet: string;
  perCallUsd?: number;
  /**
   * The provider's per-token offer from its 402 body, when it takes a metered
   * escrow (#794). Unchecked here; the browser checks it against the listing.
   */
  metered?: Record<string, unknown>;
};

/** The provider's metered offer in a 402 body, or undefined when there is none. */
export function meteredOfferFromBody(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body) as { metered?: unknown };
    const offer = parsed?.metered;
    if (offer && typeof offer === "object" && !Array.isArray(offer) && (offer as { settlement?: unknown }).settlement === "metered-escrow") {
      return offer as Record<string, unknown>;
    }
  } catch {
    // Not JSON: no metered offer.
  }
  return undefined;
}

/** The settle transaction a provider names in a paid metered answer. */
export function settleSignatureFromBody(body: string): string | undefined {
  try {
    const signature = (JSON.parse(body) as { reddi?: { metered?: { settleSignature?: unknown } } })?.reddi?.metered?.settleSignature;
    return typeof signature === "string" ? signature : undefined;
  } catch {
    return undefined;
  }
}

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
  /** A metered call: the provider's settle transaction (x402TxSignature is then the buyer's lock). */
  settleTxSignature?: string;
  /** Set when the server verified the payment on chain and stored a job record. */
  jobId?: string;
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

  // With a database configured it is the only source of listings; files are the local development path.
  const index = await loadListingIndex();
  const routed = routePlannerPolicy(policy, index.source === "database" ? index.entries : undefined);
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
  const payload = plannerChatPayload(input.prompt);

  trace.push(`planner:selected:${routed.selected.walletAddress}`);

  if (input.paymentMode === "wallet") {
    return executeWithWalletPayment(input, {
      listingSource: index.source,
      model: payload.model,
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
  listingSource: "files" | "database";
  model: string;
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

function buyerMints() {
  return {
    USDC: process.env.NEXT_PUBLIC_X402_USDC_MINT,
    AUDD: process.env.NEXT_PUBLIC_X402_AUDD_MINT,
    PYUSD: process.env.NEXT_PUBLIC_X402_PYUSD_MINT,
    USDG: process.env.NEXT_PUBLIC_X402_USDG_MINT,
  };
}

/**
 * Checks a wallet-paid call on chain and stores a job record for it. Any
 * failure here leaves no record; it never changes what the buyer is told
 * about the provider's answer.
 */
async function recordWalletPaidJob(
  input: PlannerExecuteInput,
  ctx: WalletRunContext,
  outcome: { delivered: boolean; responseText?: string },
): Promise<PaidCallOutcome | MeteredCallOutcome> {
  try {
    const listing = await readOwnListing(ctx.selectedWallet);
    if (!listing.ok || !listing.listing) return { recorded: false, reason: "listing_not_found" };
    const responseHash = outcome.responseText === undefined ? undefined : createHash("sha256").update(outcome.responseText).digest("hex");
    if ((input.paymentReceipt as { settlement?: unknown } | undefined)?.settlement === "metered-escrow") {
      // Nothing is charged until the provider settles; without a settle there is no job to record.
      if (outcome.responseText === undefined) return { recorded: false, reason: "not_settled" };
      return await verifyAndRecordMeteredCall(
        {
          receipt: input.paymentReceipt,
          settleSignature: settleSignatureFromBody(outcome.responseText),
          listing: listing.listing,
          profile: resolveNetworkProfileName(),
          requestHash: ctx.promptSha256,
          responseHash,
          declaredModel: ctx.model,
          delivered: outcome.delivered,
          session: input.buyerSession,
        },
        { rpcUrl: getNetworkProfile().solana.rpcHttp, mints: buyerMints(), programId: ESCROW_PROGRAM_ID },
      );
    }
    return await verifyAndRecordPaidCall(
      {
        receipt: input.paymentReceipt,
        listing: listing.listing,
        profile: resolveNetworkProfileName(),
        requestHash: ctx.promptSha256,
        responseHash,
        declaredModel: ctx.model,
        delivered: outcome.delivered,
        session: input.buyerSession,
      },
      {
        rpcUrl: getNetworkProfile().solana.rpcHttp,
        mints: buyerMints(),
        feeTreasury: process.env.X402_PROTOCOL_FEE_TREASURY?.trim() || undefined,
      },
    );
  } catch {
    return { recorded: false, reason: "job_check_failed" };
  }
}

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
      const metered = meteredOfferFromBody(firstBody);
      if (metered) paymentRequired.metered = metered;
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

  const metered = (input.paymentReceipt as { settlement?: unknown }).settlement === "metered-escrow";
  const session = input.session;
  if (session && !metered) {
    return fail({
      challengeSeen: true,
      error: "Only a metered escrow lock can pay for a session.",
      trace: [...ctx.trace, "x402:wallet_receipt_refused:session_needs_metered_lock", "planner:failed"],
    });
  }
  const escrow = (input.paymentReceipt as { escrow?: unknown }).escrow;

  ctx.trace.push(session ? `request:session:${session.sequence}${session.close ? ":close" : ""}:${url}` : `request:paid:${url}`);
  const requestBody = JSON.stringify(ctx.payload);
  try {
    const paid = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x402-payment": receipt.header,
        ...(session ? sessionRequestHeaders(session) : metered && input.paidCallAuth ? paidCallAuthRequestHeaders(input.paidCallAuth) : {}),
      },
      body: requestBody,
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
    if (session) {
      // A session call is billed through the provider's receipt chain and settled once, so nothing is recorded per call.
      const sessionOutcome = checkSessionAnswer({
        status: paid.status,
        headers: paid.headers,
        responseText: text,
        requestBody,
        providerWallet: ctx.selectedWallet,
        escrow: typeof escrow === "string" ? escrow : "",
        sequence: session.sequence,
      });
      const settledBy = sessionOutcome.closing?.receipt.payment?.txSignature;
      if (settledBy) run.settleTxSignature = settledBy;
      if (!paid.ok) {
        run.error = sessionOutcome.refusal
          ? `The provider refused session call ${session.sequence} (${sessionOutcome.refusal}). Nothing was charged for it; anything it served before is settled from the lock.`
          : `Session call ${session.sequence} failed (${paid.status}). Nothing was charged for it; send it again or start a new lock.`;
      }
      run.trace.push(
        sessionOutcome.call ? "session:receipt_checked" : `session:receipt_not_checked:${sessionOutcome.problem ?? sessionOutcome.refusal ?? "none"}`,
        ...(sessionOutcome.closing ? ["session:closing_receipt_checked"] : []),
        ...(sessionOutcome.state ? [`session:state:${sessionOutcome.state}`] : []),
        "job:not_recorded:session_call",
      );
      appendRun(run);
      return { ok: paid.ok, result: run, response: text, candidates: ctx.candidates, session: sessionOutcome as PlannerSessionOutcome };
    }
    const settleSignature = metered && paid.ok ? settleSignatureFromBody(text) : undefined;
    if (settleSignature) run.settleTxSignature = settleSignature;
    if (metered && !paid.ok) {
      run.error = /rated_escrow_declined|opted in to rating/i.test(text)
        ? "This provider does not take jobs opted in to rating, and served nothing. Nothing was charged; your maximum stays in escrow and can be cancelled for a refund, with the rating rent, once the cancel window opens. To use this provider, pay again without rating."
        : paid.status === 401 && /session_auth_/.test(text)
          ? "The provider needs your wallet's signature to know this call is yours, and served nothing. Nothing was charged; present the lock again from the same tab, or cancel it for a refund once the cancel window opens."
          : `Specialist call failed after the lock (${paid.status}). Nothing is charged until the provider settles; your maximum stays in escrow and can be cancelled for a refund once the cancel window opens.`;
    }
    // With a database configured, the server checks the payment on chain itself and only then keeps a job record.
    if (ctx.listingSource === "database") {
      const recorded = await recordWalletPaidJob(input, ctx, { delivered: paid.ok, responseText: paid.ok ? text : undefined });
      run.trace.push(recorded.recorded ? "job:recorded" : `job:not_recorded:${recorded.reason}`);
      if (recorded.recorded) {
        run.jobId = recorded.jobId;
        // The provider's public counts are recounted from the jobs table, delivered or not.
        const stats = await refreshProviderStats(ctx.selectedWallet).catch(() => ({ updated: false as const, reason: "refresh_failed" }));
        run.trace.push(stats.updated ? "provider_stats:updated" : `provider_stats:not_updated:${stats.reason}`);
      }
      // A provider's signed receipt is kept only for a recorded, delivered job, and only if it checks out.
      const receiptNetwork = paymentNetworkForProfile(resolveNetworkProfileName());
      if (recorded.recorded && paid.ok && (receiptNetwork === "solana-devnet" || receiptNetwork === "solana-mainnet-beta")) {
        const kept = await checkAndStoreProviderReceipt({
          headerValue: paid.headers.get(PROVIDER_RECEIPT_HEADER),
          jobId: recorded.jobId,
          providerWallet: ctx.selectedWallet,
          requestBody,
          responseBody: text,
          network: receiptNetwork,
          txSignature: settleSignature ?? receipt.signature,
          paid: recorded.paid,
          settlement: "maxAmountBaseUnits" in recorded.paid ? { kind: "metered-escrow", maxAmountBaseUnits: recorded.paid.maxAmountBaseUnits } : { kind: "direct" },
        }).catch(() => ({ stored: false as const, reason: "check_failed" }));
        run.trace.push(kept.stored ? "provider_receipt:stored" : `provider_receipt:not_stored:${kept.reason}`);
      }
    }
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
