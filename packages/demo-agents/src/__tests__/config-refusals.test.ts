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
    delete process.env.DEMO_REGISTRY_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID;
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

  it("refuses a Quasar target outside devnet", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    await expect(import("../config")).rejects.toThrow(
      /Quasar demo target is only registered for devnet; local-surfpool has no Quasar program inventory/,
    );
  });

  it("allows the Quasar target on devnet", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const config = await import("../config");

    expect(config.PROGRAM_TARGET).toBe("quasar");
    expect(config.REGISTRY_PROGRAM_ID).toBe("Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU");
  });
});
