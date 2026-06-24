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
