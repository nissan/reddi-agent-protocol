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
});
