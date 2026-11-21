import { Keypair } from "@solana/web3.js";

describe("operator key rotation verification (E2.2)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("reports missing operator key clearly", async () => {
    delete process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY;
    const { checkOperatorKeyStatus } = await import("@/lib/onboarding/operator-key");

    expect(checkOperatorKeyStatus()).toMatchObject({
      present: false,
      valid: false,
      state: "missing",
      error: "ONBOARDING_ATTEST_OPERATOR_SECRET_KEY not set",
    });
  });

  it("reports invalid operator key format", async () => {
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = "[1,2,3]";
    const { checkOperatorKeyStatus } = await import("@/lib/onboarding/operator-key");

    expect(checkOperatorKeyStatus()).toMatchObject({
      present: true,
      valid: false,
      state: "invalid",
    });
  });

  it("accepts a valid 64-byte key and exposes pubkey suffix", async () => {
    const kp = Keypair.generate();
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = JSON.stringify(Array.from(kp.secretKey));

    const { checkOperatorKeyStatus } = await import("@/lib/onboarding/operator-key");
    const status = checkOperatorKeyStatus();

    expect(status.present).toBe(true);
    expect(status.valid).toBe(true);
    expect(status.state).toBe("ready");
    expect(status.publicKey_suffix).toBe(kp.publicKey.toBase58().slice(-8));
    expect(status.checkedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("attestation operator status helper reports not available, even with a valid key: ratings are not made by this server", async () => {
    const kp = Keypair.generate();
    const secret = JSON.stringify(Array.from(kp.secretKey));

    const { getOnchainAttestationOperatorStatus } = await import("@/lib/onboarding/onchain-attestation");
    const status = getOnchainAttestationOperatorStatus(secret);

    expect(status.ready).toBe(false);
    expect(status.operatorPubkey).toBe(kp.publicKey.toBase58());
    expect(status.note).toMatch(/not made by this server \(app rating flow, #842\)/);
  });
});
