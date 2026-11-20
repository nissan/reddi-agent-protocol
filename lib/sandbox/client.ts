/**
 * Browser-side helpers for the sandbox page. No keys, no signing: wallet
 * signatures happen in the visitor's own wallet, in the page component.
 */
import { SANDBOX_CURRENCY, SANDBOX_ENDPOINT_PATH, SANDBOX_NETWORK, type SandboxProvider } from "./catalog";
import type { SandboxChatMessage } from "./receipt";

export type SandboxChallenge = {
  version: string;
  network: string;
  payTo: string;
  amount: string | number;
  currency: string;
  endpoint: string;
  nonce: string;
  memo?: string;
};

export type SandboxExchange = {
  label: string;
  request: { method: "POST"; path: string; headers: Record<string, string>; body: unknown };
  response: { status: number; body: unknown };
};

export type SandboxCallResult = { status: number; body: Record<string, unknown>; exchange: SandboxExchange };

export async function callSandbox(input: {
  label: string;
  model: string;
  messages: readonly SandboxChatMessage[];
  paymentHeader?: string;
  fetchImpl?: typeof fetch;
}): Promise<SandboxCallResult> {
  const requestBody = { model: input.model, messages: input.messages };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (input.paymentHeader) headers["x402-payment"] = input.paymentHeader;
  const response = await (input.fetchImpl ?? fetch)(SANDBOX_ENDPOINT_PATH, { method: "POST", headers, body: JSON.stringify(requestBody), cache: "no-store" });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await response.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { error: { code: "bad_response", message: "The sandbox returned an unexpected reply." } };
  } catch {
    body = { error: { code: "bad_response", message: "The sandbox returned a reply that is not JSON." } };
  }
  return {
    status: response.status,
    body,
    exchange: { label: input.label, request: { method: "POST", path: SANDBOX_ENDPOINT_PATH, headers, body: requestBody }, response: { status: response.status, body } },
  };
}

export function challengeFrom(body: Record<string, unknown>): SandboxChallenge | undefined {
  const value = body.x402 as Partial<SandboxChallenge> | undefined;
  return value && typeof value.nonce === "string" && typeof value.payTo === "string" && value.amount !== undefined ? (value as SandboxChallenge) : undefined;
}

export function simulatedPaymentHeader(challenge: SandboxChallenge, overrides: { amount?: string; payTo?: string } = {}): string {
  return JSON.stringify({
    simulated: true,
    network: challenge.network,
    payTo: overrides.payTo ?? challenge.payTo,
    amount: overrides.amount ?? String(challenge.amount),
    currency: challenge.currency,
    nonce: challenge.nonce,
  });
}

export function devnetPaymentHeader(challenge: SandboxChallenge, txSignature: string, payer: string): string {
  return JSON.stringify({
    network: SANDBOX_NETWORK,
    payTo: challenge.payTo,
    amount: String(challenge.amount),
    currency: SANDBOX_CURRENCY,
    nonce: challenge.nonce,
    txSignature,
    payer,
  });
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A copyable curl command that repeats an exchange against the given origin. */
export function curlFor(origin: string, exchange: SandboxExchange): string {
  const lines = [`curl -i -X POST ${shellQuote(`${origin}${exchange.request.path}`)}`];
  for (const [name, value] of Object.entries(exchange.request.headers)) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  lines.push(`  -d ${shellQuote(JSON.stringify(exchange.request.body))}`);
  return lines.join(" \\\n");
}

export function errorMessageOf(body: Record<string, unknown>): string {
  const error = body.error as { message?: unknown } | undefined;
  return typeof error?.message === "string" ? error.message : "The sandbox refused the call.";
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function priceLabel(provider: SandboxProvider): string {
  return `${provider.priceSol} devnet SOL`;
}
