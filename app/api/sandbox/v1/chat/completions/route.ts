import { handleSandboxChatCompletion, SESSION_CLOSE_HEADER, SESSION_PREVIOUS_RECEIPT_HEADER, SESSION_SEQUENCE_HEADER, SETTLE_SIGNATURE_HEADER } from "@/lib/sandbox/gateway";
import { sandboxGatewayDeps } from "@/lib/sandbox/runtime";
import { BUDGET_PAYMENT_HEADER, BUDGET_RESERVE_HEADER, BUDGET_SIGNATURE_HEADER } from "@/lib/sandbox/budget-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_768;

export async function POST(request: Request) {
  let body: unknown;
  let text: string;
  try {
    text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return Response.json({ error: { code: "invalid_request", message: "Request body is too large for the sandbox." } }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: { code: "invalid_request", message: "Request body must be JSON." } }, { status: 400 });
  }

  try {
    const result = await handleSandboxChatCompletion(
      {
        body,
        rawBody: text,
        paymentHeader: request.headers.get("x402-payment") ?? request.headers.get("x-payment"),
        origin: new URL(request.url).origin,
        session: {
          sequence: request.headers.get(SESSION_SEQUENCE_HEADER),
          close: request.headers.get(SESSION_CLOSE_HEADER),
          previousReceipt: request.headers.get(SESSION_PREVIOUS_RECEIPT_HEADER),
          delegation: request.headers.get("x402-session-delegation"),
          signature: request.headers.get("x402-session-signature"),
        },
        paymentProof: {
          proof: request.headers.get("x402-payment-proof"),
          delegation: request.headers.get("x402-payment-delegation"),
        },
        settleSignature: request.headers.get(SETTLE_SIGNATURE_HEADER),
        budget: {
          budget: request.headers.get(BUDGET_PAYMENT_HEADER),
          signature: request.headers.get(BUDGET_SIGNATURE_HEADER),
          reserve: request.headers.get(BUDGET_RESERVE_HEADER),
        },
      },
      sandboxGatewayDeps(),
    );
    return new Response(result.bodyText, { status: result.status, headers: result.headers });
  } catch {
    return Response.json({ error: { code: "sandbox_error", message: "The sandbox could not complete the call." } }, { status: 500 });
  }
}
