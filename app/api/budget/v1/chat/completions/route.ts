import { PublicKey } from "@solana/web3.js";
import { decodeReservation, reservationAddress } from "@redditech/x402-solana/budget";
import { parseBudgetKey, relayBudgetCall, PROVIDER_MAX_ANSWER_BYTES, RELAY_MAX_BODY_BYTES, type ProviderAnswer } from "@/lib/budget/relay";
import type { BudgetProvider } from "@/lib/budget/providers";
import { BUDGET_PROGRAM_ID, budgetConnection, budgetGate } from "@/lib/budget/runtime";
import { approveViaSigner, signCallViaSigner } from "@/lib/budget/signer-client";
import { judgeStore } from "@/lib/budget/judge/store";
import { budgetCustodyStore } from "@/lib/budget/store";
import { handleSandboxChatCompletion } from "@/lib/sandbox/gateway";
import { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER } from "@/lib/sandbox/budget-desk";
import { sandboxGatewayDeps } from "@/lib/sandbox/runtime";
import { rateLimited, tryError } from "@/lib/try/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The agent's end of a Budget: an OpenAI-style chat completion paid from the
 * Budget its key names (`Authorization: Bearer <Budget key>`). `model` picks
 * one of the providers the payer named. See `lib/budget/relay.ts`.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "call");
  if (limited) return limited;
  const gated = await budgetGate(request, "chat", { key: parseBudgetKey(request.headers.get("authorization"))?.id });
  if (gated) return gated;
  const store = budgetCustodyStore();
  if (!store) return tryError(503, "custody_not_configured", "Budgets are not switched on for this server yet.");
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return tryError(400, "invalid_request", "Send a JSON body.");
  }
  if (Buffer.byteLength(bodyText, "utf8") > RELAY_MAX_BODY_BYTES) return tryError(413, "invalid_request", "The request body is too large.");
  const origin = new URL(request.url).origin;
  const receipts = judgeStore();
  const result = await relayBudgetCall(
    { key: request.headers.get("authorization"), bodyText, caller: `relay:${request.headers.get("user-agent")?.slice(0, 80) ?? "agent"}` },
    {
      store,
      programId: BUDGET_PROGRAM_ID,
      callProvider: (provider, text, headers, timeoutMs) => callProvider(provider, text, headers, origin, timeoutMs),
      reservedOnChain: async (budget, createdSlot, payee) => {
        const account = await budgetConnection().getAccountInfo(reservationAddress(new PublicKey(budget), new PublicKey(payee), BUDGET_PROGRAM_ID), "confirmed");
        if (!account || !account.owner.equals(BUDGET_PROGRAM_ID)) return BigInt(0);
        const slice = decodeReservation(account.data);
        return slice.budgetCreatedSlot === createdSlot ? slice.reserved : BigInt(0);
      },
      signCall: (input) => signCallViaSigner(input),
      approve: (input) => approveViaSigner(input, { programId: BUDGET_PROGRAM_ID }),
      blockhash: async () => (await budgetConnection().getLatestBlockhash("confirmed")).blockhash,
      ...(receipts ? { saveReceipt: ({ budget, createdSlot, payee, receipt }) => receipts.addReceipt({ budget, createdSlot, payee }, "relay", receipt) } : {}),
    },
  );
  return new Response(result.bodyText, { status: result.status, headers: result.headers });
}

async function callProvider(provider: BudgetProvider, bodyText: string, headers: Record<string, string>, origin: string, timeoutMs: number): Promise<ProviderAnswer> {
  if (provider.endpoint.kind === "sandbox") {
    const answer = await handleSandboxChatCompletion(
      {
        body: JSON.parse(bodyText),
        rawBody: bodyText,
        origin,
        budget: { budget: headers[BUDGET_PAYMENT_HEADER], signature: headers[BUDGET_SIGNATURE_HEADER], reserve: headers[BUDGET_RESERVE_HEADER] ?? null },
      },
      sandboxGatewayDeps(),
    );
    return { status: answer.status, headers: answer.headers, bodyText: answer.bodyText };
  }
  const response = await fetch(provider.endpoint.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: bodyText,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const out: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    out[name] = value;
  });
  return { status: response.status, headers: out, bodyText: await readCapped(response) };
}

/** The answer's text, read no further than the relay passes on (one byte over, so the relay can tell). */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size <= PROVIDER_MAX_ANSWER_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size > PROVIDER_MAX_ANSWER_BYTES) await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString("utf8");
}
