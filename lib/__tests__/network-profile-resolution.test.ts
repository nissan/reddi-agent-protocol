import fs from "fs";
import os from "os";
import path from "path";

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
    delete process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE;
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

  it("skips a blank selector so the next key still decides the profile", async () => {
    delete process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE;
    process.env.NETWORK_PROFILE = "   ";
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "surfpool";
    const { resolveNetworkProfileName } = await import("@/lib/config/network");
    const { resolveNetworkProfileNameFromEnv } = await import("@/lib/config/network-profile-name");

    expect(resolveNetworkProfileName()).toBe("local-surfpool");
    expect(resolveNetworkProfileNameFromEnv(process.env)).toBe("local-surfpool");
  });

  it("lets the build-emitted profile outrank the bundled selector", async () => {
    delete process.env.NETWORK_PROFILE;
    process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE = "local-surfpool";
    process.env.NEXT_PUBLIC_NETWORK_PROFILE = "mainnet";
    const { resolveNetworkProfileName } = await import("@/lib/config/network");
    const { resolveNetworkProfileNameFromEnv } = await import("@/lib/config/network-profile-name");

    expect(resolveNetworkProfileName()).toBe("local-surfpool");
    expect(resolveNetworkProfileNameFromEnv(process.env)).toBe("local-surfpool");
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
  // Every variable the demo-agent config reads at module scope. Cleared before each case so the
  // outcome describes the resolver and the fixture, never a developer's gitignored .env.devnet.
  const CONFIG_ENV_KEYS = [
    "DEMO_DISABLE_DOTENV",
    "DEMO_DOTENV_PATH",
    "NETWORK_PROFILE",
    "NEXT_PUBLIC_NETWORK_PROFILE",
    "NEXT_PUBLIC_DEMO_PROGRAM_TARGET",
    "HACKATHON_DEMO_TARGET",
    "DEMO_PROGRAM_TARGET",
    "DEMO_ESCROW_PROGRAM_ID",
    "NEXT_PUBLIC_ESCROW_PROGRAM_ID",
    "DEMO_REGISTRY_PROGRAM_ID",
    "NEXT_PUBLIC_REGISTRY_PROGRAM_ID",
    "DEMO_REPUTATION_PROGRAM_ID",
    "NEXT_PUBLIC_REPUTATION_PROGRAM_ID",
    "DEMO_ATTESTATION_PROGRAM_ID",
    "NEXT_PUBLIC_ATTESTATION_PROGRAM_ID",
    "DEMO_DEVNET_RPC",
    "NEXT_PUBLIC_RPC_ENDPOINT",
    "DEMO_DEVNET_RPC_WS",
    "NEXT_PUBLIC_RPC_WS_ENDPOINT",
    "DEMO_PER_RPC",
    "NEXT_PUBLIC_PER_RPC",
  ];

  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "rap-demo-dotenv-"));
  });

  afterAll(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of CONFIG_ENV_KEYS) delete process.env[key];
  });

  function writeDotenvFixture(name: string, body: string): string {
    const fixturePath = path.join(fixtureDir, name);
    fs.writeFileSync(fixturePath, body);
    return fixturePath;
  }

  it("honours DEMO_DISABLE_DOTENV so an env file cannot supply endpoints", async () => {
    process.env.DEMO_DISABLE_DOTENV = "true";
    process.env.DEMO_DOTENV_PATH = writeDotenvFixture(
      "disabled.env",
      "DEMO_DEVNET_RPC=https://api.devnet.solana.com\n",
    );
    process.env.NETWORK_PROFILE = "local-surfpool";
    const config = await import("../../packages/demo-agents/src/config");

    expect(config.DOTENV_DISABLED).toBe(true);
    expect(config.DEVNET_RPC).not.toMatch(/api\.devnet\.solana\.com/);
    expect(new URL(config.DEVNET_RPC).hostname).toMatch(/^(127\.\d+\.\d+\.\d+|localhost)$/);
  });

  it("loads dotenv by default so ordinary demo runs keep their env file", async () => {
    process.env.DEMO_DOTENV_PATH = writeDotenvFixture(
      "enabled.env",
      "NETWORK_PROFILE=local-surfpool\nDEMO_DEVNET_RPC=http://127.0.0.1:41337\n",
    );

    const config = await import("../../packages/demo-agents/src/config");

    expect(config.DOTENV_DISABLED).toBe(false);
    expect(config.DEMO_NETWORK_PROFILE).toBe("local-surfpool");
    expect(config.DEVNET_RPC).toBe("http://127.0.0.1:41337");
    expect(config.PROGRAM_TARGET).toBe("legacy-anchor");
  });

  it("never lets a loaded env file override a variable the caller already pinned", async () => {
    process.env.DEMO_DEVNET_RPC = "http://127.0.0.1:19999";
    process.env.DEMO_DOTENV_PATH = writeDotenvFixture(
      "precedence.env",
      "DEMO_DEVNET_RPC=https://api.devnet.solana.com\n",
    );

    const config = await import("../../packages/demo-agents/src/config");

    expect(config.DOTENV_DISABLED).toBe(false);
    expect(config.DEVNET_RPC).toBe("http://127.0.0.1:19999");
  });
});
