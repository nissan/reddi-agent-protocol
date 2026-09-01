describe("Quasar demo program target config", () => {
  const originalEnv = process.env;
  const QUASAR_PROGRAM_ID = "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW";
  const LEGACY_ANCHOR_PROGRAM_ID = "794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD";

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET;
    delete process.env.HACKATHON_DEMO_TARGET;
    delete process.env.DEMO_PROGRAM_TARGET;
    delete process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
    delete process.env.DEMO_ESCROW_PROGRAM_ID;
    delete process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("keeps the legacy Anchor program as the default until Quasar target is explicit", async () => {
    process.env.NETWORK_PROFILE = "devnet";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.target).toBe("legacy-anchor");
    expect(profile.programs.framework).toBe("anchor");
    expect(profile.programs.escrowProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
  });

  it("uses the Quasar deployment inventory in hackathon demo mode", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { ESCROW_PROGRAM_ID, PROGRAM_TARGET, PROGRAM_FRAMEWORK, PROGRAM_COMPATIBILITY, PROGRAM_SUBMISSION_READY, PROGRAM_KNOWN_GAPS } = await import("@/lib/program");
    const profile = getNetworkProfile();

    expect(profile.programs.target).toBe("quasar");
    expect(profile.programs.framework).toBe("quasar");
    expect(profile.programs.escrowProgramId).toBe(QUASAR_PROGRAM_ID);
    expect(profile.programs.escrowProgramId).not.toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(ESCROW_PROGRAM_ID.toBase58()).toBe(QUASAR_PROGRAM_ID);
    expect(PROGRAM_TARGET).toBe("quasar");
    expect(PROGRAM_FRAMEWORK).toBe("quasar");
    expect(PROGRAM_COMPATIBILITY).toBe("quasar-layout-unverified");
    expect(PROGRAM_SUBMISSION_READY).toBe(true);
    expect(PROGRAM_KNOWN_GAPS).toHaveLength(0);
  });

  it("refuses Quasar target for non-devnet profiles instead of silently falling back", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { getNetworkProfile } = await import("@/lib/config/network");

    expect(() => getNetworkProfile()).toThrow(/Quasar program target is only configured for devnet/);
  });

  it("marks the mainnet placeholder as not submission-ready", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.target).toBe("legacy-anchor");
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.deploymentStatus).toBe("mainnet-not-deployed");
    expect(profile.programs.activationGate).toBe("external_audit_and_mainnet_deployment_required");
    expect(profile.programs.knownGaps).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/No audited mainnet program deployment is registered/),
      ]),
    );
  });

  it("refuses Quasar target on mainnet until audited per-program ids are registered", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { getNetworkProfile } = await import("@/lib/config/network");

    expect(() => getNetworkProfile()).toThrow(/mainnet has no registered Quasar deployment/);
  });
});
