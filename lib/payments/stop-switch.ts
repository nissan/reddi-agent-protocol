/**
 * The app's stop switch for new payments (incident runbook, audit condition C15).
 *
 * The escrow program has no pause, so stopping new money is off-chain: each
 * provider refuses paid calls in a currency (`RAP_PROVIDER_PAUSED_CURRENCIES`),
 * and this app stops offering to sign new payments.
 *
 * - `RAP_STOP_NEW_PAYMENTS`: "true" or "1" stops every new payment and lock the
 *   app would ask a wallet to sign.
 * - `RAP_PAUSED_CURRENCIES`: comma-separated symbols (SOL, USDC, AUDD, PYUSD,
 *   USDG) to stop on their own.
 *
 * Both are server-side variables, read at request time by
 * `GET /api/payments/status`; on Vercel a change takes effect on the next
 * deployment (redeploy the current one). Anything the switch cannot read stops
 * everything: an unknown symbol or value is a stop, not an ignore.
 * Refunds, cancels and settles of existing escrows are never blocked by it.
 */
export const STOPPABLE_CURRENCIES = ["SOL", "USDC", "AUDD", "PYUSD", "USDG"] as const;

export interface PaymentStop {
  /** True: no new payment or lock in any currency. */
  stopAll: boolean;
  /** Currencies stopped on their own (empty when stopAll). */
  pausedCurrencies: string[];
  /** Plain reason for the page, never naming a variable's raw value. */
  reason?: string;
}

const STOPPED_MESSAGE = "New payments are paused while we look into an issue. Open escrows can still be refunded or settled.";

export function readPaymentStop(env: Record<string, string | undefined>): PaymentStop {
  const all = (env.RAP_STOP_NEW_PAYMENTS ?? "").trim().toLowerCase();
  if (all !== "" && all !== "false" && all !== "0") {
    // "true"/"1" stop; anything else is unreadable, which also stops.
    return { stopAll: true, pausedCurrencies: [], reason: STOPPED_MESSAGE };
  }
  const paused: string[] = [];
  for (const entry of (env.RAP_PAUSED_CURRENCIES ?? "").split(",")) {
    const symbol = entry.trim().toUpperCase();
    if (!symbol) continue;
    if (!(STOPPABLE_CURRENCIES as readonly string[]).includes(symbol)) {
      return { stopAll: true, pausedCurrencies: [], reason: STOPPED_MESSAGE };
    }
    if (!paused.includes(symbol)) paused.push(symbol);
  }
  return paused.length > 0
    ? { stopAll: false, pausedCurrencies: paused, reason: `New payments in ${paused.join(", ")} are paused while we look into an issue. Open escrows can still be refunded or settled.` }
    : { stopAll: false, pausedCurrencies: [] };
}

/** True when a new payment or lock in `currency` must not be offered. */
export function paymentStopped(stop: PaymentStop, currency: string): boolean {
  return stop.stopAll || stop.pausedCurrencies.includes(currency.trim().toUpperCase());
}

/**
 * The page's check before it asks a wallet to sign. A status it cannot read is
 * a stop on mainnet; elsewhere (devnet demos) it is not.
 */
export async function fetchPaymentStop(fetcher: typeof fetch, failClosed: boolean): Promise<PaymentStop> {
  try {
    const response = await fetcher("/api/payments/status", { cache: "no-store" });
    if (!response.ok) throw new Error("status");
    const body = (await response.json()) as Partial<PaymentStop>;
    if (typeof body.stopAll !== "boolean" || !Array.isArray(body.pausedCurrencies)) throw new Error("shape");
    return { stopAll: body.stopAll, pausedCurrencies: body.pausedCurrencies.map(String), ...(typeof body.reason === "string" ? { reason: body.reason } : {}) };
  } catch {
    return failClosed
      ? { stopAll: true, pausedCurrencies: [], reason: "Whether payments are open could not be checked, so nothing will be signed. Try again shortly." }
      : { stopAll: false, pausedCurrencies: [] };
  }
}
