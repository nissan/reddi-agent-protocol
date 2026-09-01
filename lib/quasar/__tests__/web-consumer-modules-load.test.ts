/**
 * Every web module that reaches the Quasar instruction surface must actually parse and evaluate.
 * A malformed import or a broken transitive dependency here breaks `npm run build` and the register
 * and onboarding routes; importing each module for real is what proves that, not reading its text.
 */
const WEB_QUASAR_CONSUMERS = [
  "@/lib/quasar/instruction-builders",
  "@/lib/quasar/instructions",
  "@/lib/config/network",
  "@/lib/program",
  "@/lib/register/registration-instruction",
  "@/lib/onboarding/attestation-instruction",
  "@/lib/onboarding/reputation-signal",
] as const;

describe("web Quasar consumer modules", () => {
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

  it.each(WEB_QUASAR_CONSUMERS)("%s parses and evaluates on the default profile", async (specifier) => {
    const mod = await import(specifier);
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it.each(WEB_QUASAR_CONSUMERS)("%s parses and evaluates on the blocked devnet Quasar route", async (specifier) => {
    process.env.NETWORK_PROFILE = "devnet";
    process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET = "quasar";

    const mod = await import(specifier);
    expect(mod).toBeDefined();
  });

  it("exposes the Quasar instruction builders the register and onboarding routes call", async () => {
    const instructions = await import("@/lib/quasar/instructions");

    for (const name of [
      "buildQuasarRegisterAgentInstruction",
      "buildQuasarUpdateAgentInstruction",
      "buildQuasarDeregisterAgentInstruction",
      "buildQuasarCommitRatingInstruction",
      "buildQuasarRevealRatingInstruction",
      "buildQuasarAttestQualityInstruction",
      "buildQuasarConfirmAttestationInstruction",
      "buildQuasarDisputeAttestationInstruction",
    ]) {
      expect(typeof (instructions as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
