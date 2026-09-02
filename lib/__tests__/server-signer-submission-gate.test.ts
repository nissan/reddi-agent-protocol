import { Connection, Keypair } from "@solana/web3.js";

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
    delete process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_ALLOW_UNSAFE_ESCROW_OVERRIDE;
    delete process.env.NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE;
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = operatorSecret;
    jest.restoreAllMocks();
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

  it("refuses a malformed/gapped devnet attestation profile before signer or RPC use", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet11111111111111111111111111111";
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = "not-json";
    const getLatestBlockhash = jest.spyOn(Connection.prototype, "getLatestBlockhash");

    const { submitOnchainOnboardingAttestation } = await import("@/lib/onboarding/onchain-attestation");

    await expect(
      submitOnchainOnboardingAttestation({ walletAddress: specialistWallet }),
    ).rejects.toThrow(/malformed program id override/);
    expect(getLatestBlockhash).not.toHaveBeenCalled();
  });

  it("refuses a malformed/gapped devnet reputation profile before signer use", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet11111111111111111111111111111";
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = "not-json";

    const { commitReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const result = await commitReputationRating("run-malformed-commit", 8, specialistWallet);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/malformed program id override/);
    expect(result.trace).toEqual(["reputation:submission_blocked"]);
  });

  it("refuses a well-formed devnet override rejected by the hijack guard before signer use", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryHijack11111111111111111111111111111";
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = "not-json";

    const { commitReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const result = await commitReputationRating("run-ignored-override-commit", 8, specialistWallet);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/program id override was supplied for registry/);
    expect(result.trace).toEqual(["reputation:submission_blocked"]);
  });

  it("refuses a Quasar local Surfpool operator send before signer use", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = "not-json";

    const { commitReputationRating } = await import("@/lib/onboarding/reputation-signal");
    const result = await commitReputationRating("run-refused-surfpool-commit", 8, specialistWallet);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/four distinct valid local program IDs/);
    expect(result.trace).toEqual(["reputation:submission_blocked"]);
  });

  it("refuses the armed live paid devnet lane on a blocked profile before signer or RPC use", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet11111111111111111111111111111";
    const getAccountInfo = jest.spyOn(Connection.prototype, "getAccountInfo");

    const { runEconomicDemoLivePaidDevnet, ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM } = await import(
      "@/lib/economic-demo/live-paid-devnet-run"
    );

    const run = await runEconomicDemoLivePaidDevnet({
      env: {
        ECONOMIC_DEMO_LIVE_PAID_DEVNET: "1",
        ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM,
        ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON: operatorSecret,
      },
    });

    expect(run.status).toBe("blocked");
    expect(run.orchestratorWallet).toBeNull();
    expect(run.spentUsdc).toBe("0");
    expect(run.timeline[0]?.error).toMatch(/malformed program id override/);
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(JSON.stringify(run)).not.toContain(operatorSecret);
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
