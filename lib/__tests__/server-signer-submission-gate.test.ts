import { Keypair } from "@solana/web3.js";

describe("server-side operator signers honour the profile submission gate", () => {
  const originalEnv = process.env;
  const operatorSecret = JSON.stringify(Array.from(Keypair.generate().secretKey));
  const specialistWallet = Keypair.generate().publicKey.toBase58();

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET;
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = operatorSecret;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("refuses the onboarding attestation submit on a blocked profile without signing", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { submitOnchainOnboardingAttestation } = await import("@/lib/onboarding/onchain-attestation");

    await expect(
      submitOnchainOnboardingAttestation({ walletAddress: specialistWallet }),
    ).rejects.toThrow(/no audited mainnet deployment is registered/);
  });

  it("refuses a reputation commit on a blocked profile without signing", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { commitReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const result = await commitReputationRating("run-blocked-commit", 8, specialistWallet);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/real mainnet fees/);
    expect(result.trace).toContain("reputation:submission_blocked");
  });

  it("refuses a reputation reveal on a blocked profile without signing", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { revealReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const result = await revealReputationRating("run-blocked-reveal");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/real mainnet fees/);
    expect(result.trace).toContain("reputation:submission_blocked");
  });

  it("lets the same calls past the gate on the devnet profile", async () => {
    process.env.NETWORK_PROFILE = "devnet";

    const { SUBMISSION_BLOCKED } = await import("@/lib/program");
    const { revealReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const result = await revealReputationRating("run-with-no-commit-recorded");

    expect(SUBMISSION_BLOCKED).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/No unrevealed commit found/);
    expect(result.trace).not.toContain("reputation:submission_blocked");
  });
});
