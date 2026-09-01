/**
 * The recorded Quasar devnet deployment is marked non-ready with ABI-mismatch known gaps in
 * config/quasar/deployments.json. These tests prove the web app consumes that canonical state:
 * profile resolution keeps disclosure without crashing at module scope, and every Quasar
 * instruction builder refuses before an instruction, signer, or RPC call exists.
 */
describe("web Quasar devnet refusal", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET;
    delete process.env.HACKATHON_DEMO_TARGET;
    delete process.env.DEMO_PROGRAM_TARGET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  async function quasarDevnetModules() {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    const network = await import("@/lib/config/network");
    const instructions = await import("@/lib/quasar/instructions");
    const { PublicKey } = await import("@solana/web3.js");
    return { network, instructions, PublicKey };
  }

  it("resolves the profile without throwing and reports the blocked target", async () => {
    const { network } = await quasarDevnetModules();
    const profile = network.getNetworkProfile();

    expect(profile.programs.target).toBe("quasar");
    expect(profile.programs.submissionReady).toBe(false);
    expect(profile.programs.blocked?.target).toBe("quasar");
    expect(profile.programs.blocked!.knownGaps.length).toBeGreaterThan(0);
    expect(network.describeBlockedProgramTarget(profile)).toContain("refused");
  });

  it("importing the program module does not crash at module scope", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
    const program = await import("@/lib/program");

    expect(program.PROGRAM_TARGET).toBe("quasar");
    expect(program.PROGRAM_SUBMISSION_READY).toBe(false);
    expect(program.PROGRAM_KNOWN_GAPS.length).toBeGreaterThan(0);
  });

  it("refuses to build a Quasar registration instruction on the blocked devnet route", async () => {
    const { instructions, PublicKey } = await quasarDevnetModules();
    const owner = new PublicKey("11111111111111111111111111111112");
    const programId = new PublicKey("Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU");

    expect(() =>
      instructions.buildQuasarRegisterAgentInstruction({
        programId,
        owner,
        agentType: 0,
        model: "qwen3:8b",
        rateLamports: 1_000_000n,
        minReputation: 3,
      }),
    ).toThrow(/refused/);
  });

  it("refuses every Quasar reputation and attestation builder on the blocked route", async () => {
    const { instructions, PublicKey } = await quasarDevnetModules();
    const someone = new PublicKey("11111111111111111111111111111112");
    const programId = new PublicKey("nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6");
    const jobId = new Uint8Array(16);

    expect(() =>
      instructions.buildQuasarCommitRatingInstruction({
        programId, jobId, signer: someone, commitment: new Uint8Array(32), role: 0,
        consumer: someone, specialist: someone,
      }),
    ).toThrow(/refused/);
    expect(() =>
      instructions.buildQuasarRevealRatingInstruction({
        programId, jobId, signer: someone, score: 8, salt: new Uint8Array(32),
        specialistAgentPda: someone, consumerAgentPda: someone,
      }),
    ).toThrow(/refused/);
    expect(() =>
      instructions.buildQuasarAttestQualityInstruction({
        programId, jobId, judge: someone, scores: new Uint8Array([8, 8, 8, 8, 8]), consumer: someone,
      }),
    ).toThrow(/refused/);
  });

  it("still builds Quasar instructions when the target is not the blocked devnet route", async () => {
    process.env.NETWORK_PROFILE = "surfpool";
    const instructions = await import("@/lib/quasar/instructions");
    const { PublicKey } = await import("@solana/web3.js");
    const owner = new PublicKey("11111111111111111111111111111112");
    const programId = new PublicKey("Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU");

    const ix = instructions.buildQuasarRegisterAgentInstruction({
      programId, owner, agentType: 0, model: "qwen3:8b", rateLamports: 1_000_000n, minReputation: 3,
    });
    expect(ix.programId.toBase58()).toBe(programId.toBase58());
  });
});
