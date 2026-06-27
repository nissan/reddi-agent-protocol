import "server-only";

import {
  generateSellerWrapperConfigExamples,
  validateSellerWrapperConfigExamples,
} from "../../packages/agent-protocol/dist/seller-wrapper-config.js";

export const ONBOARDING_SELLER_WRAPPER_CONFIG_SCHEMA_VERSION =
  "reddi.onboarding-seller-wrapper-config.v1" as const;

export function getOnboardingSellerWrapperConfig() {
  const config = generateSellerWrapperConfigExamples();
  const validation = validateSellerWrapperConfigExamples(config);

  if (!validation.valid) {
    throw new Error(`Seller wrapper config validation failed: ${validation.reasonCodes.join(",")}`);
  }

  return {
    schemaVersion: ONBOARDING_SELLER_WRAPPER_CONFIG_SCHEMA_VERSION,
    mode: "no-spend-config-preview",
    config,
    buyerAuthorityPolicy: {
      ...config.buyerAuthorityPolicy,
      onboardingCopy: {
        preflight:
          "Buyer authority is checked before seller-wrapper invocation using spend caps, allowed rails/currencies, seller allowlists, expiry, receipt/evidence requirements, refund/failure policy, and operator approval.",
        denial:
          "Denied, expired, unsupported, over-cap, missing-receipt/evidence, refund/failure mismatch, and approval-required states remain local fixture states until separate live-payment approval exists.",
        boundary:
          "Seller-wrapper config does not carry private keys, provider credentials, signing instructions, wallet/RPC/provider calls, custody claims, or settlement-finality claims.",
      },
    },
    validation,
    boundaries: {
      networkCalls: false,
      livePayment: false,
      walletSigning: false,
      rpcCalls: false,
      providerInvocation: false,
      hostedWrites: false,
      custodyExpansion: false,
      settlementFinalityClaim: false,
    },
  };
}
