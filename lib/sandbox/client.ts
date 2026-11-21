/**
 * Browser-side helpers for the sandbox page. No keys, no signing: wallet
 * signatures happen in the visitor's own wallet, in the page component.
 */
import { SANDBOX_CURRENCY, SANDBOX_ENDPOINT_PATH, SANDBOX_NETWORK, type SandboxProvider } from "./catalog";
import { maxChargeLamports, triPriceFromLamports, triPriceFromMicroUsd, usageCostMicroUsd, type TriPrice } from "./pricing";
import { decodeReceiptHeader, PROVIDER_RECEIPT_HEADER, SANDBOX_SIMULATED_RECEIPT_HEADER, type SandboxChatMessage } from "./receipt";

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

export type SandboxCallResult = {
  status: number;
  body: Record<string, unknown>;
  /** The request body bytes that were sent, as text. */
  requestText: string;
  /** The response body bytes that came back, as text. */
  responseText: string;
  /** The decoded receipt header, if the response carried one. Unchecked. */
  receipt?: unknown;
  exchange: SandboxExchange;
};

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
  const requestText = JSON.stringify(requestBody);
  const response = await (input.fetchImpl ?? fetch)(SANDBOX_ENDPOINT_PATH, { method: "POST", headers, body: requestText, cache: "no-store" });
  let body: Record<string, unknown>;
  let responseText = "";
  try {
    responseText = await response.text();
    const parsed: unknown = JSON.parse(responseText);
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { error: { code: "bad_response", message: "The sandbox returned an unexpected reply." } };
  } catch {
    body = { error: { code: "bad_response", message: "The sandbox returned a reply that is not JSON." } };
  }
  const receiptHeader = response.headers?.get(PROVIDER_RECEIPT_HEADER) ?? response.headers?.get(SANDBOX_SIMULATED_RECEIPT_HEADER);
  const receipt = decodeReceiptHeader(receiptHeader);
  return {
    status: response.status,
    body,
    requestText,
    responseText,
    ...(receipt !== undefined ? { receipt } : {}),
    exchange: {
      label: input.label,
      request: { method: "POST", path: SANDBOX_ENDPOINT_PATH, headers, body: requestBody },
      response: { status: response.status, body: receipt !== undefined ? { ...body, "(receipt header, decoded)": receipt } : body },
    },
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

/** One amount in USDC, AUDD and SOL, in that order. */
export function triPriceLabel(price: TriPrice): string {
  return `${price.usdc} USDC · ${price.audd} AUDD · ${price.sol} SOL`;
}

export type ProviderPriceView = {
  /** Listed price per million input and output tokens. */
  inputPerMillion: TriPrice;
  outputPerMillion: TriPrice;
  /** The most this request can cost: its input plus the provider's full output limit. */
  maxPerCall: TriPrice;
  maxLamports: bigint;
};

/** What a provider card shows for the current request. */
export function providerPriceView(provider: SandboxProvider, inputTokens: number): ProviderPriceView {
  const maxLamports = maxChargeLamports(provider, inputTokens);
  return {
    inputPerMillion: triPriceFromMicroUsd(usageCostMicroUsd(provider, { inputTokens: 1_000_000, outputTokens: 0 })),
    outputPerMillion: triPriceFromMicroUsd(usageCostMicroUsd(provider, { inputTokens: 0, outputTokens: 1_000_000 })),
    maxPerCall: triPriceFromLamports(maxLamports),
    maxLamports,
  };
}

/**
 * Signup link on the marketing site, or undefined when no marketing origin is
 * configured. Only an https origin is accepted, so a mistyped or hostile value
 * cannot turn the button into a script or plain-http link.
 */
export function marketingSignupUrl(origin: string | undefined): string | undefined {
  const value = origin?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return `${url.origin}/#updates`;
  } catch {
    return undefined;
  }
}
