import { PublicKey } from "@solana/web3.js";

import { IX } from "@/lib/program";
import { buildAgentRegistrationInstruction } from "@/lib/register/registration-instruction";

/**
 * Quasar instruction builders only construct under a validated local-surfpool Quasar target, so the
 * Quasar branch of this router is exercised with that ambient configuration. The devnet refusal
 * itself is covered by lib/quasar/__tests__/quasar-devnet-refusal.test.ts.
 */
const localQuasarEnv = {
  NETWORK_PROFILE: "local-surfpool",
  NEXT_PUBLIC_DEMO_PROGRAM_TARGET: "quasar",
  NEXT_PUBLIC_RPC_ENDPOINT: "http://127.0.0.1:8899",
  NEXT_PUBLIC_RPC_WS_ENDPOINT: "ws://[::1]:8900",
  NEXT_PUBLIC_ESCROW_PROGRAM_ID: "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW",
  NEXT_PUBLIC_REGISTRY_PROGRAM_ID: "Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU",
  NEXT_PUBLIC_REPUTATION_PROGRAM_ID: "nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6",
  NEXT_PUBLIC_ATTESTATION_PROGRAM_ID: "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex",
};

describe("target-aware agent registration instruction", () => {
  const originalEnv = process.env;
  const owner = new PublicKey("11111111111111111111111111111112");
  const anchorProgramId = new PublicKey("794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD");
  const quasarProgramId = new PublicKey("VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW");

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses Anchor registration data for the legacy target", () => {
    const ix = buildAgentRegistrationInstruction({
      target: "legacy-anchor",
      programId: anchorProgramId,
      owner,
      agentType: 0,
      model: "qwen3:8b",
      rateLamports: 1_000_000n,
      minReputation: 3,
    });

    expect(ix.programId.toBase58()).toBe(anchorProgramId.toBase58());
    expect(ix.data.subarray(0, 8).equals(IX.register_agent)).toBe(true);
  });

  it("uses Quasar one-byte registration data for the Quasar target", () => {
    process.env = { ...originalEnv, ...localQuasarEnv };

    const ix = buildAgentRegistrationInstruction({
      target: "quasar",
      programId: quasarProgramId,
      owner,
      agentType: 0,
      model: "qwen3:8b",
      rateLamports: 1_000_000n,
      minReputation: 3,
    });

    expect(ix.programId.toBase58()).toBe(quasarProgramId.toBase58());
    expect(ix.data[0]).toBe(0);
    expect(ix.data.length).toBe(76);
    expect(ix.data.subarray(0, 8).equals(IX.register_agent)).toBe(false);
  });
});
