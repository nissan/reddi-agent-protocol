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

    const { WALLET_SUBMISSION_BLOCKED, WALLET_SUBMISSION_BLOCKED_REASON, PROGRAM_DEPLOYMENT_STATUS } =
      await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(WALLET_SUBMISSION_BLOCKED).toBe(true);
    expect(WALLET_SUBMISSION_BLOCKED_REASON).toMatch(/real mainnet fees/);
  });

  it("keeps wallet submission enabled on devnet even when mainnet ids are supplied", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "EscrowMainnet1111111111111111111111111111111";

    const { WALLET_SUBMISSION_BLOCKED } = await import("@/lib/program");

    expect(WALLET_SUBMISSION_BLOCKED).toBe(false);
  });

  it("resolves the mainnet profile from the client-visible NEXT_PUBLIC selector", async () => {
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "mainnet";

    const { WALLET_SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(WALLET_SUBMISSION_BLOCKED).toBe(true);
  });

  it("prefers the build-time mirror over a stale NEXT_PUBLIC_NETWORK_PROFILE", async () => {
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "devnet";

    const { WALLET_SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(WALLET_SUBMISSION_BLOCKED).toBe(true);
  });

  it("lets the server-only NETWORK_PROFILE selector outrank both public keys", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "devnet";

    const { WALLET_SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(WALLET_SUBMISSION_BLOCKED).toBe(true);
  });

  it("falls back to the build-time mirror when no runtime selector is set", async () => {
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "mainnet";

    const { WALLET_SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("mainnet-not-deployed");
    expect(WALLET_SUBMISSION_BLOCKED).toBe(true);
  });

  it("keeps wallet submission enabled on the local Surfpool profile", async () => {
    process.env.NETWORK_PROFILE = "surfpool";

    const { WALLET_SUBMISSION_BLOCKED, PROGRAM_DEPLOYMENT_STATUS } = await import("@/lib/program");

    expect(PROGRAM_DEPLOYMENT_STATUS).toBe("local-only");
    expect(WALLET_SUBMISSION_BLOCKED).toBe(false);
  });
});
