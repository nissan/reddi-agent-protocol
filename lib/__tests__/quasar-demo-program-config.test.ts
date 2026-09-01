describe("Quasar demo program target config", () => {
  const originalEnv = process.env;
  const QUASAR_PROGRAM_ID = "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW";
  const QUASAR_REGISTRY_PROGRAM_ID = "Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU";
  const QUASAR_REPUTATION_PROGRAM_ID = "nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6";
  const QUASAR_ATTESTATION_PROGRAM_ID = "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex";
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
    delete process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID;
    delete process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE;
    delete process.env.NEXT_PUBLIC_ALLOW_UNSAFE_ESCROW_OVERRIDE;
    delete process.env.NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE;
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
    expect(PROGRAM_SUBMISSION_READY).toBe(false);
    expect(PROGRAM_KNOWN_GAPS.length).toBeGreaterThan(0);
    expect(profile.programs.blocked?.target).toBe("quasar");
    expect(profile.programs.deploymentStatus).toBe("devnet-deployed");
  });

  it("refuses a Quasar surfpool request without four explicit valid local program IDs", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.target).toBe("legacy-anchor");
    expect(profile.programs.escrowProgramId).not.toBe(QUASAR_PROGRAM_ID);
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.deploymentStatus).toBe("local-only");
    expect(profile.programs.blocked?.target).toBe("quasar");
    expect(profile.programs.blocked?.cause).toBe("local-program-set");
    expect(profile.programs.knownGaps.join(" ")).toMatch(
      /four distinct valid local program IDs.*missing escrow, registry, reputation, attestation program ids/,
    );
  });

  it("tells a local-surfpool operator to supply the missing local ID rather than to run the lane they are on", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "http://127.0.0.1:39999";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = QUASAR_PROGRAM_ID;
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = QUASAR_REGISTRY_PROGRAM_ID;
    process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID = QUASAR_REPUTATION_PROGRAM_ID;

    const { describeBlockedProgramTarget, getNetworkProfile } = await import("@/lib/config/network");
    const refusal = describeBlockedProgramTarget(getNetworkProfile());

    expect(refusal).toContain("local program set supplied for this run is incomplete");
    expect(refusal).toContain("missing attestation program id");
    expect(refusal).toContain("NEXT_PUBLIC_ATTESTATION_PROGRAM_ID");
    expect(refusal).not.toContain("recorded deployment is not usable");
    expect(refusal).not.toContain("test:surfpool:quasar-critical");
  });

  it("keeps the recorded-deployment wording and lane pointer for the blocked devnet deployment", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { describeBlockedProgramTarget, getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();
    const refusal = describeBlockedProgramTarget(profile);

    expect(profile.programs.blocked?.cause).toBe("recorded-deployment");
    expect(refusal).toContain("recorded deployment is not usable");
    expect(refusal).toContain("test:surfpool:quasar-critical");
  });

  it("keeps local-surfpool Quasar explicit when all four local program IDs are valid", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "http://127.0.0.1:39999";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = QUASAR_PROGRAM_ID;
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = QUASAR_REGISTRY_PROGRAM_ID;
    process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID = QUASAR_REPUTATION_PROGRAM_ID;
    process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID = QUASAR_ATTESTATION_PROGRAM_ID;

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { ESCROW_PROGRAM_ID, REGISTRY_PROGRAM_ID, REPUTATION_PROGRAM_ID, ATTESTATION_PROGRAM_ID, PROGRAM_TARGET, PROGRAM_SUBMISSION_READY } = await import("@/lib/program");
    const profile = getNetworkProfile();

    expect(profile.programs.target).toBe("quasar");
    expect(profile.programs.blocked).toBeUndefined();
    expect(profile.programs.submissionReady).toBe(true);
    expect(profile.programs.escrowProgramId).toBe(QUASAR_PROGRAM_ID);
    expect(profile.programs.registryProgramId).toBe(QUASAR_REGISTRY_PROGRAM_ID);
    expect(profile.programs.reputationProgramId).toBe(QUASAR_REPUTATION_PROGRAM_ID);
    expect(profile.programs.attestationProgramId).toBe(QUASAR_ATTESTATION_PROGRAM_ID);
    expect(ESCROW_PROGRAM_ID.toBase58()).toBe(QUASAR_PROGRAM_ID);
    expect(REGISTRY_PROGRAM_ID.toBase58()).toBe(QUASAR_REGISTRY_PROGRAM_ID);
    expect(REPUTATION_PROGRAM_ID.toBase58()).toBe(QUASAR_REPUTATION_PROGRAM_ID);
    expect(ATTESTATION_PROGRAM_ID.toBase58()).toBe(QUASAR_ATTESTATION_PROGRAM_ID);
    expect(PROGRAM_TARGET).toBe("quasar");
    expect(PROGRAM_SUBMISSION_READY).toBe(true);
  });

  it("keeps the whole app loadable for the surfpool + quasar env the repo ships", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { PROGRAM_TARGET, PROGRAM_SUBMISSION_READY } = await import("@/lib/program");

    expect(PROGRAM_TARGET).toBe("legacy-anchor");
    expect(PROGRAM_SUBMISSION_READY).toBe(false);
  });

  it("surfaces the deployed-program limitations on the devnet Quasar target", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { PROGRAM_KNOWN_GAPS, PROGRAM_KNOWN_LIMITATIONS, PROGRAM_SUBMISSION_READY } = await import("@/lib/program");

    expect(PROGRAM_SUBMISSION_READY).toBe(false);
    expect(PROGRAM_KNOWN_GAPS.join(" ")).toMatch(/pre-binding layout/);
    expect(PROGRAM_KNOWN_LIMITATIONS.join(" ")).toMatch(/gated off/);
    expect(PROGRAM_KNOWN_LIMITATIONS.join(" ")).toMatch(/Quasar remains experimental/);
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

  it("aliases every program id to the single placeholder program on the blocked mainnet profile", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { ESCROW_PROGRAM_ID, REGISTRY_PROGRAM_ID, REPUTATION_PROGRAM_ID, ATTESTATION_PROGRAM_ID } = await import(
      "@/lib/program"
    );
    const profile = getNetworkProfile();

    expect(profile.programs.escrowProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(profile.programs.registryProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(profile.programs.reputationProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(profile.programs.attestationProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(REGISTRY_PROGRAM_ID.toBase58()).toBe(ESCROW_PROGRAM_ID.toBase58());
    expect(REPUTATION_PROGRAM_ID.toBase58()).toBe(ESCROW_PROGRAM_ID.toBase58());
    expect(ATTESTATION_PROGRAM_ID.toBase58()).toBe(ESCROW_PROGRAM_ID.toBase58());
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.knownGaps.join(" ")).toMatch(/the configured escrow id is still the placeholder devnet id/);
    expect(profile.programs.knownGaps.join(" ")).toMatch(
      /No distinct mainnet id is configured for registry, reputation and attestation, so they alias to the escrow program id/,
    );
  });

  it("stops claiming placeholder aliasing once mainnet program ids are supplied", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "EscrowMainnet1111111111111111111111111111111";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet1111111111111111111111111111";
    process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID = "ReputationMainnet11111111111111111111111111";
    process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID = "AttestationMainnet1111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const gaps = getNetworkProfile().programs.knownGaps.join(" ");

    expect(gaps).not.toMatch(/placeholder/);
    expect(gaps).not.toMatch(/alias/);
    expect(gaps).toMatch(/no audited mainnet deployment is registered for it/);
    expect(getNetworkProfile().programs.submissionReady).toBe(false);
  });

  it("still discloses aliasing when only the mainnet escrow id is supplied", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "EscrowMainnet1111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();
    const gaps = profile.programs.knownGaps.join(" ");

    expect(profile.programs.registryProgramId).toBe("EscrowMainnet1111111111111111111111111111111");
    expect(gaps).toMatch(/registry, reputation and attestation/);
    expect(gaps).toMatch(/they alias to the escrow program id on this profile/);
  });

  it("names only the programs that still alias when some mainnet ids are supplied", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet1111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const gaps = getNetworkProfile().programs.knownGaps.join(" ");

    expect(gaps).toMatch(/reputation and attestation/);
    expect(gaps).not.toMatch(/registry, reputation and attestation/);
    expect(gaps).toMatch(/placeholder devnet id/);
  });

  it("honours the documented per-program mainnet overrides instead of aliasing them to escrow", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "EscrowMainnet1111111111111111111111111111111";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet1111111111111111111111111111";
    process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID = "ReputationMainnet11111111111111111111111111";
    process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID = "AttestationMainnet1111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { ESCROW_PROGRAM_ID, REGISTRY_PROGRAM_ID, REPUTATION_PROGRAM_ID, ATTESTATION_PROGRAM_ID } = await import(
      "@/lib/program"
    );
    const profile = getNetworkProfile();

    expect(profile.programs.escrowProgramId).toBe("EscrowMainnet1111111111111111111111111111111");
    expect(profile.programs.registryProgramId).toBe("RegistryMainnet1111111111111111111111111111");
    expect(profile.programs.reputationProgramId).toBe("ReputationMainnet11111111111111111111111111");
    expect(profile.programs.attestationProgramId).toBe("AttestationMainnet1111111111111111111111111");
    expect(ESCROW_PROGRAM_ID.toBase58()).toBe("EscrowMainnet1111111111111111111111111111111");
    expect(REGISTRY_PROGRAM_ID.toBase58()).toBe("RegistryMainnet1111111111111111111111111111");
    expect(REPUTATION_PROGRAM_ID.toBase58()).toBe("ReputationMainnet11111111111111111111111111");
    expect(ATTESTATION_PROGRAM_ID.toBase58()).toBe("AttestationMainnet1111111111111111111111111");
  });

  it("rejects a malformed program id override instead of crashing lib/program at module scope", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet11111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { REGISTRY_PROGRAM_ID, PROGRAM_SUBMISSION_READY, PROGRAM_KNOWN_GAPS } = await import("@/lib/program");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(REGISTRY_PROGRAM_ID.toBase58()).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(PROGRAM_SUBMISSION_READY).toBe(false);
    expect(PROGRAM_KNOWN_GAPS.join(" ")).toMatch(
      /registry program id override is not a valid 32-byte base58 Solana address/,
    );
  });

  it("explains a rejected devnet override without contradicting the resolved program set", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryMainnet11111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe(QUASAR_REGISTRY_PROGRAM_ID);
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.submissionReadyReason).toMatch(
      /the registered program id is used instead, so the configured override is not in effect/,
    );
    expect(profile.programs.submissionReadyReason).not.toMatch(/resolved program set is not the configured one/);
    expect(profile.programs.knownGaps.join(" ")).toMatch(/it was ignored and the registered program id is used/);
  });

  it("rejects a non-base58 override on the local-surfpool profile and stays loadable", async () => {
    process.env.NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "EscrowLocal000000000000000000000000000000000";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { ESCROW_PROGRAM_ID, PROGRAM_SUBMISSION_READY } = await import("@/lib/program");
    const registered = getNetworkProfile().programs.escrowProgramId;

    expect(ESCROW_PROGRAM_ID.toBase58()).toBe(registered);
    expect(PROGRAM_SUBMISSION_READY).toBe(false);
  });

  it("keeps a valid devnet override applied on both sides via the immutable build unsafe flag", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";
    process.env.NEXT_PUBLIC_ALLOW_UNSAFE_ESCROW_OVERRIDE = "false";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const { REGISTRY_PROGRAM_ID } = await import("@/lib/program");

    expect(getNetworkProfile().programs.registryProgramId).toBe("RegistryLoca1111111111111111111111111111111");
    expect(REGISTRY_PROGRAM_ID.toBase58()).toBe("RegistryLoca1111111111111111111111111111111");
  });

  it("ignores per-program overrides on the devnet legacy-Anchor profile without the unsafe flag", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryHijack11111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.knownGaps.join(" ")).toMatch(/registry program id override does not match/);
  });

  it("discloses and blocks a discarded well-formed devnet override without exposing its value", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe(QUASAR_REGISTRY_PROGRAM_ID);
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.submissionReadyReason).toMatch(/program id override was supplied for registry/);
    expect(profile.programs.knownGaps.join(" ")).toMatch(
      /registry program id override does not match the registered devnet program set/,
    );
    expect(profile.programs.knownGaps.join(" ")).not.toContain("RegistryLoca1111111111111111111111111111111");
  });

  it("names every discarded override on the legacy-Anchor devnet profile", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryHijack11111111111111111111111111111";
    process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID = "ReputationHijack111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(profile.programs.reputationProgramId).toBe(LEGACY_ANCHOR_PROGRAM_ID);
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.submissionReadyReason).toMatch(/registry, reputation/);
    expect(profile.programs.knownGaps.join(" ")).toMatch(/registry, reputation program id overrides do not match/);
  });

  it("records no discarded-override gap when the unsafe flag lets the override through", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe("RegistryLoca1111111111111111111111111111111");
    expect(profile.programs.knownGaps.join(" ")).not.toMatch(/match the registered devnet program set/);
  });

  it("refuses to repoint the registered Quasar devnet program set via a stray override", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryHijack11111111111111111111111111111";
    process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID = "ReputationHijack111111111111111111111111111";
    process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID = "AttestationHijack11111111111111111111111111";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = "EscrowHijack11111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.escrowProgramId).toBe(QUASAR_PROGRAM_ID);
    expect(profile.programs.registryProgramId).toBe(QUASAR_REGISTRY_PROGRAM_ID);
    expect(profile.programs.reputationProgramId).toBe(QUASAR_REPUTATION_PROGRAM_ID);
    expect(profile.programs.attestationProgramId).toBe(QUASAR_ATTESTATION_PROGRAM_ID);
  });

  it("applies Quasar devnet overrides only when the unsafe flag is set", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe("RegistryLoca1111111111111111111111111111111");
    expect(profile.programs.escrowProgramId).toBe(QUASAR_PROGRAM_ID);
  });

  it("ignores a runtime public unsafe flag that was not mirrored at build time", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).not.toBe("RegistryLoca1111111111111111111111111111111");
  });

  it("applies per-program overrides on devnet when the non-Next tooling fallback flag is set", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.registryProgramId).toBe("RegistryLoca1111111111111111111111111111111");
  });

  it("surfaces the mainnet gate to the app instead of throwing at module scope", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const { PROGRAM_SUBMISSION_READY, PROGRAM_KNOWN_GAPS } = await import("@/lib/program");

    expect(PROGRAM_SUBMISSION_READY).toBe(false);
    expect(PROGRAM_KNOWN_GAPS.join(" ")).toMatch(/Quasar program target was requested for mainnet/);
  });
});
