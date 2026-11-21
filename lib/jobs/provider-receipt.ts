import "server-only";

/**
 * Checks a provider's signed receipt for a paid call and saves it next to the
 * job (#739, #740).
 *
 * A provider may return a signed receipt in the `x-reddi-provider-receipt`
 * response header. It is kept only if the signature verifies against the wallet
 * of the listing that was paid, and the receipt names the bytes this server sent
 * and received and the transaction this server already checked on chain. The
 * receipt records the model the provider declares; it is not proof of which
 * model ran.
 */

import { hashReddiReceiptV2Body, verifyReddiReceiptV2, type ReddiReceiptV2Network, type SignedReddiReceiptV2 } from "@reddi/agent-protocol/receipt-v2";

import { supabaseOrigin } from "@/lib/supabase/config";

export const PROVIDER_RECEIPT_HEADER = "x-reddi-provider-receipt";
const MAX_HEADER_CHARS = 4096;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProviderReceiptOutcome = { stored: true; declaredModel: string } | { stored: false; reason: string };

export interface ProviderReceiptInput {
  /** Raw header value from the provider's paid response, or null when none was sent. */
  headerValue: string | null | undefined;
  /** The job this server recorded for the call. */
  jobId: string;
  /** Wallet of the listing that was paid, from the database. */
  providerWallet: string;
  /** Exact request body this server sent. */
  requestBody: string;
  /** Exact response body this server received. */
  responseBody: string;
  network: ReddiReceiptV2Network;
  /** The payment transaction this server verified on chain. */
  txSignature: string;
  /** What this server verified was paid. The receipt must state the same currency, mint, amount and fee. */
  paid: { currency: string; mint?: string; amountBaseUnits: string; payer: string; fee: { amount: string; treasury?: string } };
  /** How the call was paid. A metered call's receipt must also state the maximum this server saw locked. Defaults to direct. */
  settlement?: { kind: "direct" } | { kind: "metered-escrow"; maxAmountBaseUnits: string };
}

type StoreResponse = { ok: boolean; status: number };
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<StoreResponse>;

export interface ProviderReceiptDeps {
  url?: string;
  serviceKey?: string;
  fetchImpl?: FetchLike;
}

/** Decodes the header: base64url of the signed receipt as JSON. Undefined when it is not that. */
export function parseProviderReceiptHeader(value: string): unknown {
  if (value.length === 0 || value.length > MAX_HEADER_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export async function checkAndStoreProviderReceipt(input: ProviderReceiptInput, deps: ProviderReceiptDeps = {}): Promise<ProviderReceiptOutcome> {
  if (!input.headerValue) return { stored: false, reason: "none" };
  if (!JOB_ID.test(input.jobId)) return { stored: false, reason: "invalid_job" };
  const parsed = parseProviderReceiptHeader(input.headerValue);
  if (parsed === undefined) return { stored: false, reason: "unreadable" };

  const verified = verifyReddiReceiptV2(parsed, {
    providerId: input.providerWallet,
    requestHash: hashReddiReceiptV2Body(input.requestBody),
    responseHash: hashReddiReceiptV2Body(input.responseBody),
    payment: { network: input.network, txSignature: input.txSignature, amount: input.paid.amountBaseUnits, fee: input.paid.fee, settlement: input.settlement?.kind ?? "direct" },
  });
  if (!verified.ok) return { stored: false, reason: verified.errors[0]?.code ?? "invalid" };
  // Currency and mint are compared here: a missing mint must mean SOL on both sides.
  // A session's open receipts carry no payment; this route stores paid receipts only.
  const stated = verified.receipt.payment;
  if (!stated) return { stored: false, reason: "payment_mismatch" };
  if (stated.currency !== input.paid.currency || stated.mint !== input.paid.mint) return { stored: false, reason: "payment_mismatch" };
  if (stated.fee.treasury !== input.paid.fee.treasury) return { stored: false, reason: "payment_mismatch" };
  // The payer is optional in a receipt. When the provider states one, it must be the wallet that paid.
  if (stated.payer !== undefined && stated.payer !== input.paid.payer) return { stored: false, reason: "payment_mismatch" };
  if (input.settlement?.kind === "metered-escrow" && stated.metered?.maxAmount !== input.settlement.maxAmountBaseUnits) {
    return { stored: false, reason: "payment_mismatch" };
  }
  if (verified.receipt.jobId !== undefined && verified.receipt.jobId !== input.jobId) return { stored: false, reason: "job_mismatch" };

  const origin = supabaseOrigin(deps.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = (deps.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!origin || !serviceKey) return { stored: false, reason: "store_unavailable" };
  const signed = parsed as SignedReddiReceiptV2;
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(`${origin}/rest/v1/receipts`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: serviceKey, authorization: `Bearer ${serviceKey}`, prefer: "return=minimal" },
      body: JSON.stringify({
        job_id: input.jobId,
        receipt: verified.receipt,
        provider_signature: signed.proof.signature,
        schema_version: verified.receipt.schemaVersion,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 409) return { stored: false, reason: "already_stored" };
    if (!response.ok) return { stored: false, reason: "store_unavailable" };
    return { stored: true, declaredModel: verified.receipt.declaredModel };
  } catch {
    return { stored: false, reason: "store_unavailable" };
  }
}
