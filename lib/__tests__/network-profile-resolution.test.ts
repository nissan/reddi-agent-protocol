/**
 * Profile resolution is the boundary that decides whether the web app talks to a loopback Surfnet or
 * to live devnet RPC. Every documented spelling of the local profile — including the canonical name
 * the lane and the demo-agent refusal message both instruct operators to use — must resolve locally.
 */
const LOCAL_PROFILE_SPELLINGS = ["local-surfpool", "local", "localnet", "surfpool"] as const;

describe("network profile resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET;
    delete process.env.HACKATHON_DEMO_TARGET;
    delete process.env.DEMO_PROGRAM_TARGET;
    delete process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    delete process.env.DEMO_DEVNET_RPC;
    // The demo-agent config loads a gitignored .env.devnet at module scope; disable it so this
    // suite exercises the resolver rather than whatever the developer's env file happens to set.
    process.env.DEMO_DISABLE_DOTENV = "true";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each(LOCAL_PROFILE_SPELLINGS)("resolves %s to the local profile, never devnet", async (spelling) => {
    process.env.NETWORK_PROFILE = spelling;
    const { getNetworkProfile, resolveNetworkProfileName } = await import("@/lib/config/network");

    expect(resolveNetworkProfileName()).toBe("local-surfpool");

    const profile = getNetworkProfile();
    expect(profile.name).toBe("local-surfpool");
    expect(profile.solana.cluster).not.toBe("devnet");
    expect(profile.solana.rpcHttp).not.toMatch(/api\.devnet\.solana\.com/);
    expect(profile.solana.rpcHttp).not.toMatch(/api\.mainnet-beta\.solana\.com/);
    expect(new URL(profile.solana.rpcHttp).hostname).toMatch(/^(127\.\d+\.\d+\.\d+|localhost)$/);
  });

  it.each(LOCAL_PROFILE_SPELLINGS)("resolves %s the same way through NEXT_PUBLIC_NETWORK_PROFILE", async (spelling) => {
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = spelling;
    const { resolveNetworkProfileName } = await import("@/lib/config/network");
    expect(resolveNetworkProfileName()).toBe("local-surfpool");
  });

  it("is case-insensitive for the canonical local profile name", async () => {
    process.env.NETWORK_PROFILE = "Local-Surfpool";
    const { resolveNetworkProfileName } = await import("@/lib/config/network");
    expect(resolveNetworkProfileName()).toBe("local-surfpool");
  });

  it("still resolves the explicit remote profiles", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    let mod = await import("@/lib/config/network");
    expect(mod.resolveNetworkProfileName()).toBe("devnet");

    jest.resetModules();
    process.env.NETWORK_PROFILE = "mainnet-beta";
    mod = await import("@/lib/config/network");
    expect(mod.resolveNetworkProfileName()).toBe("mainnet");
  });

  it("resolves every local spelling identically in the demo-agent resolver", async () => {
    for (const spelling of LOCAL_PROFILE_SPELLINGS) {
      jest.resetModules();
      process.env.NETWORK_PROFILE = spelling;
      const config = await import("../../packages/demo-agents/src/config");
      expect(config.DEMO_NETWORK_PROFILE).toBe("local-surfpool");
      expect(new URL(config.DEVNET_RPC).hostname).toMatch(/^(127\.\d+\.\d+\.\d+|localhost)$/);
    }
  });
});

describe("demo-agent config env isolation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("honours DEMO_DISABLE_DOTENV so a gitignored .env.devnet cannot supply endpoints", async () => {
    process.env.DEMO_DISABLE_DOTENV = "true";
    process.env.NETWORK_PROFILE = "local-surfpool";
    const config = await import("../../packages/demo-agents/src/config");

    expect(config.DOTENV_DISABLED).toBe(true);
    expect(new URL(config.DEVNET_RPC).hostname).toMatch(/^(127\.\d+\.\d+\.\d+|localhost)$/);
  });

  it("loads dotenv by default so ordinary demo runs keep their env file", async () => {
    delete process.env.DEMO_DISABLE_DOTENV;
    // dotenv never overrides an already-set key, so pinning the target here keeps a developer's
    // gitignored .env.devnet from selecting quasar and making the module-scope gate throw.
    process.env.DEMO_PROGRAM_TARGET = "legacy-anchor";
    process.env.HACKATHON_DEMO_TARGET = "legacy-anchor";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "legacy-anchor";

    const config = await import("../../packages/demo-agents/src/config");

    expect(config.DOTENV_DISABLED).toBe(false);
    expect(config.PROGRAM_TARGET).toBe("legacy-anchor");
  });
});
