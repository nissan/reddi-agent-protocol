/**
 * Pricing on the provider registration page.
 *
 * Providers are priced per token: US dollars (settled in USDC) per million input tokens
 * and per million output tokens. That price lives in the provider's listing and ADL
 * document, not on chain. The registry record's `rate_lamports` stays zero for a
 * provider priced per token, as `rap-provider register` writes it; a judge's fee per
 * job is the one SOL rate the record still carries.
 */
import { usdToUsdcBaseUnits } from "@/lib/listings/listing-client";

export type RegisterPricingForm = {
  agentType: string;
  inputPerMillionUsd: string;
  outputPerMillionUsd: string;
  attestationRate: string;
};

/** True when the form sells answers, so it needs a price per token. */
export function sellsAnswers(agentType: string): boolean {
  return agentType === "primary" || agentType === "both";
}

/** The `rate_lamports` the registry record carries: zero for a per-token provider, else the judging fee. */
export function registryRateLamports(form: RegisterPricingForm): bigint {
  if (form.agentType === "primary") return BigInt(0);
  const sol = Number.parseFloat(form.attestationRate || "0.0005");
  if (!Number.isFinite(sol) || sol < 0) return BigInt(0);
  return BigInt(Math.round(sol * 1_000_000_000));
}

/** Why the per-token price cannot be used, or null when it can. */
export function perTokenPriceProblem(form: RegisterPricingForm): string | null {
  if (!sellsAnswers(form.agentType)) return null;
  const input = usdToUsdcBaseUnits(form.inputPerMillionUsd);
  const output = usdToUsdcBaseUnits(form.outputPerMillionUsd);
  if (input === undefined || output === undefined) {
    return "Write each price in US dollars, with at most six decimal places.";
  }
  if (input === "0" && output === "0") return "Set a price per million input or output tokens.";
  return null;
}
