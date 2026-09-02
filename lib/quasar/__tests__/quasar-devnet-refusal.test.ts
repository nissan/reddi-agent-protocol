/**
 * The recorded Quasar devnet deployment is marked non-ready with ABI-mismatch known gaps in
 * config/quasar/deployments.json. These tests prove the web app consumes that canonical state:
 * profile resolution keeps disclosure without crashing at module scope, and every Quasar
 * instruction builder refuses before an instruction, signer, or RPC call exists.
 */
const LOCAL_QUASAR_IDS = {
  escrow: "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW",
  registry: "Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU",
  reputation: "nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6",
  attestation: "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex",
};

function configureLocalQuasarEnv() {
  process.env.NETWORK_PROFILE = "local-surfpool";
  process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";
  process.env.NEXT_PUBLIC_RPC_ENDPOINT = "http://127.0.0.1:8899";
  process.env.NEXT_PUBLIC_RPC_WS_ENDPOINT = "ws://[::1]:8900";
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID = LOCAL_QUASAR_IDS.escrow;
  process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID = LOCAL_QUASAR_IDS.registry;
  process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID = LOCAL_QUASAR_IDS.reputation;
  process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID = LOCAL_QUASAR_IDS.attestation;
}

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
    delete process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    delete process.env.NEXT_PUBLIC_RPC_WS_ENDPOINT;
    delete process.env.DEMO_DEVNET_RPC;
    delete process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID;
    delete process.env.DEMO_ESCROW_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID;
    delete process.env.DEMO_REGISTRY_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID;
    delete process.env.DEMO_REPUTATION_PROGRAM_ID;
    delete process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID;
    delete process.env.DEMO_ATTESTATION_PROGRAM_ID;
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
    const escrow = new PublicKey("11111111111111111111111111111114");
    const programId = new PublicKey("nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6");

    expect(() =>
      instructions.buildQuasarCommitRatingInstruction({
        programId, escrow, signer: someone, commitment: new Uint8Array(32), role: 0,
      }),
    ).toThrow(/refused/);
    expect(() =>
      instructions.buildQuasarRevealRatingInstruction({
        programId, escrow, signer: someone, score: 8, salt: new Uint8Array(32),
        specialistAgentPda: someone, consumerAgentPda: someone,
      }),
    ).toThrow(/refused/);
    expect(() =>
      instructions.buildQuasarAttestQualityInstruction({
        programId, escrow, judge: someone, scores: new Uint8Array([8, 8, 8, 8, 8]),
      }),
    ).toThrow(/refused/);
    expect(() =>
      instructions.buildQuasarConfirmAttestationInstruction({ programId, escrow, consumer: someone, judge: someone }),
    ).toThrow(/refused/);
    expect(() =>
      instructions.buildQuasarDisputeAttestationInstruction({ programId, escrow, consumer: someone, judge: someone }),
    ).toThrow(/refused/);
    expect(() =>
      instructions.buildQuasarExpireRatingInstruction({
        programId, escrow, caller: someone,
        specialistAgentPda: someone, consumerAgentPda: someone,
      }),
    ).toThrow(/refused/);
  });

  it("refuses Quasar builders unless the resolved target is explicit local-surfpool Quasar", async () => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "legacy-anchor";
    const instructions = await import("@/lib/quasar/instructions");
    const { PublicKey } = await import("@solana/web3.js");
    const owner = new PublicKey("11111111111111111111111111111112");
    const programId = new PublicKey(LOCAL_QUASAR_IDS.registry);

    expect(() =>
      instructions.buildQuasarRegisterAgentInstruction({
        programId, owner, agentType: 0, model: "qwen3:8b", rateLamports: 1_000_000n, minReputation: 3,
      }),
    ).toThrow(/explicit local-surfpool Quasar target/);
  });

  it("builds Quasar instructions only under the explicit local-surfpool Quasar target", async () => {
    configureLocalQuasarEnv();
    const instructions = await import("@/lib/quasar/instructions");
    const { PublicKey } = await import("@solana/web3.js");
    const owner = new PublicKey("11111111111111111111111111111112");
    const programId = new PublicKey(LOCAL_QUASAR_IDS.registry);

    const ix = instructions.buildQuasarRegisterAgentInstruction({
      programId, owner, agentType: 0, model: "qwen3:8b", rateLamports: 1_000_000n, minReputation: 3,
    });
    expect(ix.programId.toBase58()).toBe(programId.toBase58());
  });

  it("builds the current-source expire instruction under the explicit local-surfpool Quasar target", async () => {
    configureLocalQuasarEnv();
    const instructions = await import("@/lib/quasar/instructions");
    const { PublicKey } = await import("@solana/web3.js");
    const programId = new PublicKey(LOCAL_QUASAR_IDS.reputation);
    const escrow = new PublicKey("11111111111111111111111111111114");
    const caller = new PublicKey("11111111111111111111111111111112");
    const specialistAgentPda = new PublicKey("11111111111111111111111111111115");
    const consumerAgentPda = new PublicKey("11111111111111111111111111111116");

    const ix = instructions.buildQuasarExpireRatingInstruction({
      programId, escrow, caller, specialistAgentPda, consumerAgentPda,
    });

    // experiments/quasar-reputation/src/instructions/expire.rs:
    //   accounts [escrow (ro), rating (mut), caller (signer, ro), specialist_agent (mut), consumer_agent (mut)]
    expect([...ix.data]).toEqual([3]);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [escrow.toBase58(), false, false],
      [instructions.quasarRatingPda(escrow, programId).toBase58(), false, true],
      [caller.toBase58(), true, false],
      [specialistAgentPda.toBase58(), false, true],
      [consumerAgentPda.toBase58(), false, true],
    ]);
  });
});
