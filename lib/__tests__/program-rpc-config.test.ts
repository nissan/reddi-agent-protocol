describe("program/network configuration regression guards", () => {
  const originalEnv = process.env;
  const DEVNET_ESCROW_PROGRAM_ID = "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu";
  const OVERRIDE_PROGRAM_ID = "11111111111111111111111111111111";

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("uses NEXT_PUBLIC_RPC_ENDPOINT override when provided", async () => {
    process.env.NEXT_PUBLIC_RPC_ENDPOINT = "http://127.0.0.1:8899";
    const { DEVNET_RPC } = await import("@/lib/program");
    expect(DEVNET_RPC).toBe("http://127.0.0.1:8899");
  });

  it("accepts NEXT_PUBLIC_RPC_URL alias when NEXT_PUBLIC_RPC_ENDPOINT is unset", async () => {
    delete process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    process.env.NEXT_PUBLIC_RPC_URL = "https://rpc.example.com";

    const { DEVNET_RPC } = await import("@/lib/program");
    expect(DEVNET_RPC).toBe("https://rpc.example.com");
  });

  it("falls back to Solana devnet RPC when no env override is set", async () => {
    delete process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    const { DEVNET_RPC } = await import("@/lib/program");
    expect(DEVNET_RPC).toBe("https://api.devnet.solana.com");
  });

  it("ignores unsafe devnet escrow override by default", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = OVERRIDE_PROGRAM_ID;
    delete process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE;

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.escrowProgramId).toBe(DEVNET_ESCROW_PROGRAM_ID);
  });

  it("allows explicit devnet escrow override only when ALLOW_UNSAFE_ESCROW_OVERRIDE=true", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = OVERRIDE_PROGRAM_ID;
    process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE = "true";

    const { getNetworkProfile } = await import("@/lib/config/network");
    const profile = getNetworkProfile();

    expect(profile.programs.escrowProgramId).toBe(OVERRIDE_PROGRAM_ID);
  });
});
