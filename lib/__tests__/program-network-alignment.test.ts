describe("program/network alignment", () => {
  const QUASAR_ESCROW_PROGRAM_ID = "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW";

  beforeEach(() => {
    jest.resetModules();
    delete process.env.NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET;
    delete process.env.HACKATHON_DEMO_TARGET;
    delete process.env.DEMO_PROGRAM_TARGET;
    delete process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE;
    delete process.env.NEXT_PUBLIC_ALLOW_UNSAFE_ESCROW_OVERRIDE;
    delete process.env.NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE;
    delete process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE;
  });

  it("uses the network profile escrow program by default", async () => {
    process.env.NETWORK_PROFILE = "devnet";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { ESCROW_PROGRAM_ID } = await import("@/lib/program");

    expect(ESCROW_PROGRAM_ID.toBase58()).toBe(getNetworkProfile().programs.escrowProgramId);
  });

  it("uses Quasar escrow id on devnet only when hackathon demo target is explicit", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { ESCROW_PROGRAM_ID, PROGRAM_COMPATIBILITY } = await import("@/lib/program");

    expect(ESCROW_PROGRAM_ID.toBase58()).toBe(QUASAR_ESCROW_PROGRAM_ID);
    expect(PROGRAM_COMPATIBILITY).toBe("quasar-layout-unverified");
  });

  it("ignores unsafe devnet override unless explicitly allowed", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = QUASAR_ESCROW_PROGRAM_ID;

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { ESCROW_PROGRAM_ID } = await import("@/lib/program");

    expect(getNetworkProfile().programs.escrowProgramId).not.toBe(QUASAR_ESCROW_PROGRAM_ID);
    expect(ESCROW_PROGRAM_ID.toBase58()).not.toBe(QUASAR_ESCROW_PROGRAM_ID);
  });

  it("exports mainnet placeholder metadata as blocked rather than ready", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { PROGRAM_SUBMISSION_READY, PROGRAM_KNOWN_GAPS } = await import("@/lib/program");

    expect(PROGRAM_SUBMISSION_READY).toBe(false);
    expect(PROGRAM_KNOWN_GAPS.join(" ")).toMatch(/no audited mainnet program deployment/i);
  });

  it("blocks wallet submission on the undeployed mainnet profile", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON, PROGRAM_DEPLOYMENT_STATUS } =
      await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(SUBMISSION_BLOCKED).toBe(true);
    expect(SUBMISSION_BLOCKED_REASON).toMatch(/real mainnet fees/);
  });

  it("blocks wallet submission on devnet when a well-formed override is rejected by the hijack guard", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "EscrowMainnet1111111111111111111111111111111";

    const { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON, PROGRAM_KNOWN_GAPS } = await import("@/lib/program");

    expect(SUBMISSION_BLOCKED).toBe(true);
    expect(SUBMISSION_BLOCKED_REASON).toMatch(/program id override was supplied for escrow/);
    expect(PROGRAM_KNOWN_GAPS.join(" ")).toMatch(/escrow program id override does not match/);
  });

  it("resolves the mainnet profile from the client-visible NEXT_PUBLIC selector", async () => {
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "mainnet";

    const { SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(SUBMISSION_BLOCKED).toBe(true);
  });

  it("prefers the build-time mirror over a stale NEXT_PUBLIC_NETWORK_PROFILE", async () => {
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "devnet";

    const { SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(SUBMISSION_BLOCKED).toBe(true);
  });

  it("lets the server-only NETWORK_PROFILE selector outrank both public keys", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "devnet";

    const { SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(SUBMISSION_BLOCKED).toBe(true);
  });

  it("falls back to the build-time mirror when no runtime selector is set", async () => {
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "mainnet";

    const { SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(SUBMISSION_BLOCKED).toBe(true);
  });

  it("keeps wallet submission enabled on the local Surfpool profile", async () => {
    process.env.NETWORK_PROFILE = "surfpool";

    const { SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("local-only");
    expect(SUBMISSION_BLOCKED).toBe(false);
  });

  it("blocks wallet submission for a refused Quasar local Surfpool profile", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("local-only");
    expect(SUBMISSION_BLOCKED).toBe(true);
    expect(SUBMISSION_BLOCKED_REASON).toMatch(/four distinct valid local program IDs/);
  });

  it("blocks wallet submission for a malformed program-id override on devnet", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet11111111111111111111111111111";

    const { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_REASON, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("devnet-deployed");
    expect(SUBMISSION_BLOCKED).toBe(true);
    expect(SUBMISSION_BLOCKED_REASON).toMatch(/malformed program id override/);
  });

  it("labels the block by its mainnet cause only on the undeployed mainnet profile", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_LABEL } = await import("@/lib/program");

    expect(SUBMISSION_BLOCKED).toBe(true);
    expect(SUBMISSION_BLOCKED_LABEL).toBe("Blocked: no audited mainnet deployment");
  });

  it("does not claim a mainnet cause when devnet is blocked by a malformed override", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet11111111111111111111111111111";

    const { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_LABEL } = await import("@/lib/program");

    expect(SUBMISSION_BLOCKED).toBe(true);
    expect(SUBMISSION_BLOCKED_LABEL).not.toMatch(/mainnet/i);
    expect(SUBMISSION_BLOCKED_LABEL).toBe("Blocked: profile not submission-ready");
  });

  it("does not claim a mainnet cause when a refused Quasar Surfpool profile is blocked", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { SUBMISSION_BLOCKED, SUBMISSION_BLOCKED_LABEL } = await import("@/lib/program");

    expect(SUBMISSION_BLOCKED).toBe(true);
    expect(SUBMISSION_BLOCKED_LABEL).not.toMatch(/mainnet/i);
  });
});
