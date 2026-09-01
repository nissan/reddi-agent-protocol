jest.mock("dotenv");

describe("demo-agents network profile refusals", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET;
    delete process.env.HACKATHON_DEMO_TARGET;
    delete process.env.DEMO_PROGRAM_TARGET;
    delete process.env.DEMO_DEVNET_RPC;
    delete process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    delete process.env.DEMO_ESCROW_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
    delete process.env.DEMO_REGISTRY_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID;
    delete process.env.DEMO_REPUTATION_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID;
    delete process.env.DEMO_ATTESTATION_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("loads on the default devnet profile", async () => {
    const config = await import("../config");

    expect(config.PROGRAM_TARGET).toBe("legacy-anchor");
    expect(config.DEVNET_RPC).toBe("https://api.devnet.solana.com");
  });

  it("refuses to run against mainnet", async () => {
    process.env.NETWORK_PROFILE = "mainnet";

    await expect(import("../config")).rejects.toThrow(
      /devnet\/local evidence runner only; mainnet execution requires a separate audited deployment/,
    );
  });

  it("refuses the mainnet-beta alias too", async () => {
    process.env.NETWORK_PROFILE = "mainnet-beta";

    await expect(import("../config")).rejects.toThrow(/devnet\/local evidence runner only/);
  });

  it("refuses a Quasar target outside devnet when no program ids are supplied", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    await expect(import("../config")).rejects.toThrow(
      /no registered program inventory for local-surfpool .*missing: escrow, registry, reputation, attestation/s,
    );
  });

  it("names only the program ids still missing outside devnet", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.DEMO_ESCROW_PROGRAM_ID = "EscrowLocal1111111111111111111111111111111";
    process.env.DEMO_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    await expect(import("../config")).rejects.toThrow(/missing: reputation, attestation/);
  });

  it("runs the Quasar target outside devnet when all four deployed ids are supplied", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.DEMO_ESCROW_PROGRAM_ID = "EscrowLocal1111111111111111111111111111111";
    process.env.DEMO_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";
    process.env.DEMO_REPUTATION_PROGRAM_ID = "ReputationLoca11111111111111111111111111111";
    process.env.DEMO_ATTESTATION_PROGRAM_ID = "AttestationLoca11111111111111111111111111111";

    const config = await import("../config");

    expect(config.PROGRAM_TARGET).toBe("quasar");
    expect(config.ESCROW_PROGRAM_ID).toBe("EscrowLocal1111111111111111111111111111111");
    expect(config.REGISTRY_PROGRAM_ID).toBe("RegistryLoca1111111111111111111111111111111");
    expect(config.REPUTATION_PROGRAM_ID).toBe("ReputationLoca11111111111111111111111111111");
    expect(config.ATTESTATION_PROGRAM_ID).toBe("AttestationLoca11111111111111111111111111111");
    expect(config.DEVNET_RPC).toBe("http://127.0.0.1:18999");
  });

  it("allows the Quasar target on devnet", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const config = await import("../config");

    expect(config.PROGRAM_TARGET).toBe("quasar");
    expect(config.REGISTRY_PROGRAM_ID).toBe("Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU");
  });
});
