import type { Plugin } from "@elizaos/core";
import { x402PayAction } from "./actions/pay";
import { x402EarnAction } from "./actions/earn";

export const x402Plugin: Plugin = {
  name: "x402",
  description: "Pay and earn via x402 escrow on Solana",
  actions: [x402PayAction, x402EarnAction],
};

export default x402Plugin;

export { x402PayAction } from "./actions/pay";
export { x402EarnAction } from "./actions/earn";
export { loadKeypairFromEnv } from "./utils/wallet";
export { lockEscrow, releaseEscrow, verifyEscrowProof } from "./utils/escrow";
