/**
 * This provider's Agent Definition Language (ADL v0.3) document, made from
 * its config. The listing the app shows and the document the provider serves
 * at /.well-known/adl.yaml come from the same config, so they cannot say
 * different things, and the app refuses a listing whose ADL does not pass
 * Level 3 or does not match it.
 */
import { ADL_V03_LAUNCH_RATE, ADL_V03_PROTOCOL_FEE_BPS, buildProviderAdl, checkAdlConformance, formatAdlDocument, type AdlConformanceReport, type AdlDocument } from "@redditech/agent-protocol/adl";
import { baseUnitsToDecimal, directPaymentCurrency, estimateInputTokens, LAUNCH_PROTOCOL_FEE_BPS, LAUNCH_RATE_ENDS_AT_MS, PROTOCOL_FEE_BPS, tokenCostBaseUnits } from "@redditech/x402-solana";
import { MAX_BODY_BYTES, type ProviderConfig } from "./config.js";

/** Where the provider serves its ADL document. */
export const ADL_PATH = "/.well-known/adl.yaml";

// The ADL fee rules and the payment library must name the same rates.
if (ADL_V03_PROTOCOL_FEE_BPS !== PROTOCOL_FEE_BPS || ADL_V03_LAUNCH_RATE.bps !== LAUNCH_PROTOCOL_FEE_BPS || Date.parse(ADL_V03_LAUNCH_RATE.endsAt) !== LAUNCH_RATE_ENDS_AT_MS) {
  throw new Error("The ADL protocol fee and @redditech/x402-solana disagree; update both packages together.");
}

/**
 * The most one call can cost: every input token a request body can hold (the
 * provider prices about four characters a token, plus its system prompt) and
 * the full output limit, at the listed price. A buyer never needs to
 * authorise more for a single call.
 */
export function maxPerCall(config: ProviderConfig): string {
  const { terms } = config;
  const inputTokens = estimateInputTokens([{ content: "x".repeat(MAX_BODY_BYTES) }]) + (config.systemPrompt ? estimateInputTokens([{ content: config.systemPrompt }]) : 0);
  const units = tokenCostBaseUnits(terms.price, { inputTokens, outputTokens: terms.maxOutputTokens });
  return baseUnitsToDecimal(units, directPaymentCurrency(terms.price.currency)!.decimals);
}

/** The provider's ADL v0.3 document. */
export function providerAdl(config: ProviderConfig): AdlDocument {
  const { terms } = config;
  return buildProviderAdl({
    name: config.name,
    ...(config.description ? { description: config.description } : {}),
    model: config.model,
    network: config.network,
    currency: terms.price.currency,
    mint: terms.mint.toBase58(),
    payTo: config.wallet,
    price: { per: "token", inputPerMillion: terms.price.inputPerMillion, outputPerMillion: terms.price.outputPerMillion, maxPerCall: maxPerCall(config) },
    endpointUrl: config.publicUrl,
  });
}

/** The document as YAML, with its Level 3 check. */
export function providerAdlText(config: ProviderConfig): { text: string; report: AdlConformanceReport } {
  const document = providerAdl(config);
  return { text: formatAdlDocument(document), report: checkAdlConformance(document, { requestedLevel: 3 }) };
}
