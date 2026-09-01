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
    expect(profile.programs.deploymentStatus).toBe("devnet-deployed");
  });

  it("labels the local Surfpool profile as local-only", async () => {
    process.env.NETWORK_PROFILE = "surfpool";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.target).toBe("legacy-anchor");
    expect(profile.programs.deploymentStatus).toBe("local-only");
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
    expect(profile.programs.deploymentStatus).toBe("devnet-deployed");
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

  it("refuses a Quasar mainnet request by staying blocked instead of crashing module init", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.target).toBe("legacy-anchor");
    expect(profile.programs.escrowProgramId).not.toBe(QUASAR_PROGRAM_ID);
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.deploymentStatus).toBe("mainnet-not-deployed");
    expect(profile.programs.activationGate).toBe("external_audit_and_mainnet_deployment_required");
    expect(profile.programs.knownGaps).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Quasar program target was requested for mainnet.*request is refused/),
      ]),
    );
  });

  it("surfaces the mainnet gate to the app instead of throwing at module scope", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { PROGRAM_SUBMISSION_READY, PROGRAM_KNOWN_GAPS } = await import("@/lib/program");

    expect(PROGRAM_SUBMISSION_READY).toBe(false);
    expect(PROGRAM_KNOWN_GAPS.join(" ")).toMatch(/Quasar program target was requested for mainnet/);
  });
});
