jest.mock("dotenv");

import { PublicKey } from "@solana/web3.js";

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
    process.env.DEMO_ESCROW_PROGRAM_ID = "EK9Q7JS2xaCqM5us7EE1GXbE54haVqchUjdFgtvZKUQN";
    process.env.DEMO_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";

    await expect(import("../config")).rejects.toThrow(/missing: reputation, attestation/);
  });

  it("refuses malformed supplied Quasar ids outside devnet", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.DEMO_ESCROW_PROGRAM_ID = "EscrowLocal000000000000000000000000000000000";
    process.env.DEMO_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";
    process.env.DEMO_REPUTATION_PROGRAM_ID = "ReputationLoca11111111111111111111111111111";
    process.env.DEMO_ATTESTATION_PROGRAM_ID = "AttestationLoca11111111111111111111111111111";

    await expect(import("../config")).rejects.toThrow(/malformed: escrow must be valid 32-byte Solana public keys/);
  });

  it("refuses a malformed supplied id on the default legacy-anchor lane", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.DEMO_ESCROW_PROGRAM_ID = "EscrowLocal000000000000000000000000000000000";

    await expect(import("../config")).rejects.toThrow(/malformed: escrow must be valid 32-byte Solana public keys/);
  });

  it("refuses a malformed supplied id on the devnet Quasar lane", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.DEMO_REGISTRY_PROGRAM_ID = "RegistryLocal11111111111111111111111111111";

    await expect(import("../config")).rejects.toThrow(/malformed: registry must be valid 32-byte Solana public keys/);
  });

  it("runs the Quasar target outside devnet when all four deployed ids are supplied", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    process.env.DEMO_ESCROW_PROGRAM_ID = "EK9Q7JS2xaCqM5us7EE1GXbE54haVqchUjdFgtvZKUQN";
    process.env.DEMO_REGISTRY_PROGRAM_ID = "RegistryLoca1111111111111111111111111111111";
    process.env.DEMO_REPUTATION_PROGRAM_ID = "ReputationLoca11111111111111111111111111111";
    process.env.DEMO_ATTESTATION_PROGRAM_ID = "AttestationLoca11111111111111111111111111111";

    const config = await import("../config");

    expect(config.PROGRAM_TARGET).toBe("quasar");
    expect(config.ESCROW_PROGRAM_ID).toBe("EK9Q7JS2xaCqM5us7EE1GXbE54haVqchUjdFgtvZKUQN");
    expect(config.REGISTRY_PROGRAM_ID).toBe("RegistryLoca1111111111111111111111111111111");
    expect(config.REPUTATION_PROGRAM_ID).toBe("ReputationLoca11111111111111111111111111111");
    expect(config.ATTESTATION_PROGRAM_ID).toBe("AttestationLoca11111111111111111111111111111");
    expect(new PublicKey(config.ESCROW_PROGRAM_ID).toBase58()).toBe(config.ESCROW_PROGRAM_ID);
    expect(new PublicKey(config.REGISTRY_PROGRAM_ID).toBase58()).toBe(config.REGISTRY_PROGRAM_ID);
    expect(new PublicKey(config.REPUTATION_PROGRAM_ID).toBase58()).toBe(config.REPUTATION_PROGRAM_ID);
    expect(new PublicKey(config.ATTESTATION_PROGRAM_ID).toBase58()).toBe(config.ATTESTATION_PROGRAM_ID);
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
