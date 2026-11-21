/**
 * Per-token (metered) payment for a specialist call (#794).
 *
 * The seller flow itself lives in `@redditech/x402-solana` (`./provider`): the
 * offer, the on-chain lock check, usage counting and the settle. This module
 * only maps a specialist profile and the runtime configuration onto it.
 *
 * The settle is signed by the operator, through `RuntimeDeps.settleMeteredEscrow`.
 * This runtime builds the instruction and never reads a key. Metered payment
 * is offered only when the operator configures a per-token price, the escrow
 * program and that signer.
 */
import { directPaymentCurrency, providerMeteredTerms, type MeteredTerms } from "@redditech/x402-solana";
import type { RuntimeConfig, SpecialistProfile } from "./types.js";

export {
  DEFAULT_MAX_OUTPUT_TOKENS,
  estimateInputTokens,
  meteredOffer,
  meteredSettlement,
  outputLimit,
  readMeteredPaymentHeader,
  usageFrom,
  verifyMeteredLock,
  verifyPaidCallRequest,
  type AccountReader,
  type MeteredPaymentHeader,
  type MeteredSettleSigner,
  type MeteredTerms,
  type SlotReader,
  type VerifiedLock,
} from "@redditech/x402-solana";

export interface MeteredPriceConfig {
  /** Price per million input and output tokens, in the profile's currency. */
  inputPerMillion: string;
  outputPerMillion: string;
  /** The most output tokens one call may use. */
  maxOutputTokens?: number;
}

/** The provider's metered terms, or undefined when the operator has not configured them. */
export function meteredTerms(profile: SpecialistProfile, config: RuntimeConfig): MeteredTerms | undefined {
  const priced = config.meteredPrice;
  if (!priced || !config.escrowProgramId) return undefined;
  if (!directPaymentCurrency(profile.price.currency)?.tokenProgram) return undefined; // SOL settles through the SOL escrow, which this runtime does not offer.
  const mint = config.paymentMints?.[profile.price.currency] ?? (profile.price.currency === "USDC" ? config.usdcDevnetMint : undefined);
  if (!mint) return undefined;
  try {
    return providerMeteredTerms({
      currency: profile.price.currency,
      inputPerMillion: priced.inputPerMillion,
      outputPerMillion: priced.outputPerMillion,
      ...(priced.maxOutputTokens && priced.maxOutputTokens > 0 ? { maxOutputTokens: priced.maxOutputTokens } : {}),
      programId: config.escrowProgramId,
      mint,
      payee: profile.walletAddress,
    });
  } catch {
    return undefined;
  }
}
