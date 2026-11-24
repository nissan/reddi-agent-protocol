import { readPaymentStop } from "@/lib/payments/stop-switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the app may ask a wallet to sign a new payment, per currency (incident runbook stop switch). */
export async function GET() {
  return Response.json(readPaymentStop(process.env), { headers: { "cache-control": "no-store" } });
}
