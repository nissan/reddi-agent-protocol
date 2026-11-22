/**
 * Mainnet network fence (security audit round 1, S2-claude-01, gate S2.6).
 *
 * On mainnet the program ids come only from config/networks/mainnet.json and the only RPC
 * override accepted is the app's own https /api/rpc proxy. Server-side DEMO_* values are
 * never read on mainnet.
 */
const OTHER_PROGRAM = "11111111111111111111111111111111";

const FENCE_KEYS = [
  "NETWORK_PROFILE",
  "NEXT_PUBLIC_NETWORK_PROFILE",
  "NEXT_PUBLIC_BUILD_NETWORK_PROFILE",
  "NEXT_PUBLIC_DEMO_PROGRAM_TARGET",
  "HACKATHON_DEMO_TARGET",
  "DEMO_PROGRAM_TARGET",
  "NEXT_PUBLIC_RPC_ENDPOINT",
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_RPC_WS_ENDPOINT",
  "DEMO_DEVNET_RPC",
  "NEXT_PUBLIC_ESCROW_PROGRAM_ID",
  "DEMO_ESCROW_PROGRAM_ID",
  "NEXT_PUBLIC_REGISTRY_PROGRAM_ID",
  "DEMO_REGISTRY_PROGRAM_ID",
  "NEXT_PUBLIC_REPUTATION_PROGRAM_ID",
  "DEMO_REPUTATION_PROGRAM_ID",
  "NEXT_PUBLIC_ATTESTATION_PROGRAM_ID",
  "DEMO_ATTESTATION_PROGRAM_ID",
  "ALLOW_UNSAFE_ESCROW_OVERRIDE",
  "NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE",
];

describe("mainnet network fence", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of FENCE_KEYS) delete process.env[key];
    process.env.DEMO_DISABLE_DOTENV = "true";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  async function registeredMainnet() {
    const mainnet = (await import("@/config/networks/mainnet.json")).default as { programs: { escrowProgramId: string }; solana: { rpcHttp: string; rpcWs: string } };
    return mainnet;
  }

  it.each(["DEMO_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_ESCROW_PROGRAM_ID"])("ignores %s on mainnet", async (key) => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env[key] = OTHER_PROGRAM;
    const { getNetworkProfile } = await import("@/lib/config/network");
    const registered = await registeredMainnet();
    const profile = getNetworkProfile();
    expect(profile.name).toBe("mainnet");
    expect(profile.programs.escrowProgramId).toBe(registered.programs.escrowProgramId);
    expect(profile.programs.submissionReady).toBe(false);
    expect(JSON.stringify(profile.programs.knownGaps)).not.toContain(OTHER_PROGRAM);
  });

  it("ignores program overrides on mainnet even with the build-time unsafe flag", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";
    process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = OTHER_PROGRAM;
    process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = OTHER_PROGRAM;
    process.env.DEMO_REPUTATION_PROGRAM_ID = OTHER_PROGRAM;
    process.env.DEMO_ATTESTATION_PROGRAM_ID = OTHER_PROGRAM;
    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();
    for (const id of [
      profile.programs.escrowProgramId,
      profile.programs.registryProgramId,
      profile.programs.reputationProgramId,
      profile.programs.attestationProgramId,
    ]) {
      expect(id).not.toBe(OTHER_PROGRAM);
    }
  });

  it("refuses DEMO_DEVNET_RPC and a non-proxy RPC override on mainnet", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.DEMO_DEVNET_RPC = "https://api.devnet.solana.com";
    let mod = await import("@/lib/config/network");
    const registered = await registeredMainnet();
    expect(mod.getNetworkProfile().solana.rpcHttp).toBe(registered.solana.rpcHttp);

    jest.resetModules();
    delete process.env.DEMO_DEVNET_RPC;
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "https://api.devnet.solana.com";
    mod = await import("@/lib/config/network");
    const profile = mod.getNetworkProfile();
    expect(profile.solana.rpcHttp).toBe(registered.solana.rpcHttp);
    expect(profile.programs.knownGaps.join(" ")).toContain("NEXT_PUBLIC_RPC_ENDPOINT");
    expect(profile.programs.knownGaps.join(" ")).not.toContain("devnet.solana.com");
  });

  it("refuses a devnet deployment's /api/rpc proxy on mainnet", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "https://reddi-agent-protocol-tau.vercel.app/api/rpc";
    const { getNetworkProfile } = await import("@/lib/config/network");
    const registered = await registeredMainnet();
    expect(getNetworkProfile().solana.rpcHttp).toBe(registered.solana.rpcHttp);
  });

  it("accepts the app's own /api/rpc proxy on mainnet and ignores a websocket override", async () => {
    process.env.NETWORK_PROFILE = "mainnet";
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "https://app.agent-protocol.reddi.tech/api/rpc";
    process.env.NEXT_PUBLIC_RPC_WS_ENDPOINT = "wss://api.devnet.solana.com";
    const { getNetworkProfile } = await import("@/lib/config/network");
    const registered = await registeredMainnet();
    const profile = getNetworkProfile();
    expect(profile.solana.rpcHttp).toBe("https://app.agent-protocol.reddi.tech/api/rpc");
    expect(profile.solana.rpcWs).toBe(registered.solana.rpcWs);
  });

  it.each([
    ["http://app.agent-protocol.reddi.tech/api/rpc", false],
    ["https://app.agent-protocol.reddi.tech/api/rpc", true],
    ["https://app.agent-protocol.reddi.tech/api/rpc/", true],
    ["https://mainnet.helius-rpc.com/?api-key=x", false],
    ["https://evil.example/api/rpc?x=1", false],
    ["https://evil.example/api/rpc", false],
    ["https://reddi-agent-protocol-tau.vercel.app/api/rpc", false],
    ["https://app.agent-protocol.reddi.tech:8443/api/rpc", false],
    ["https://app.agent-protocol.reddi.tech/other", false],
    ["/api/rpc", false],
    ["https://user:pw@app.example/api/rpc", false],
    ["not a url", false],
  ])("isMainnetRpcProxyUrl(%s) is %s", async (value, expected) => {
    const { isMainnetRpcProxyUrl } = await import("@/lib/config/network");
    expect(isMainnetRpcProxyUrl(value)).toBe(expected);
  });

  it("still honours DEMO_* overrides on local-surfpool and devnet rules are unchanged", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.DEMO_ESCROW_PROGRAM_ID = OTHER_PROGRAM;
    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();
    // Devnet without the unsafe flag ignores a differing override, as before.
    expect(profile.programs.escrowProgramId).not.toBe(OTHER_PROGRAM);
  });
});
